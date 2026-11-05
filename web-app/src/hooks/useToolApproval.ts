import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import i18n from '@/i18n/setup'
import { notifyUnlessWatching } from '@/lib/notifications'
import type { ToolPermissionTarget } from '@/lib/tool-permission-targets'

export type ShowApprovalModalOptions = {
  /**
   * Prompt even while the global "Allow all MCP permissions" switch is on.
   * Used when the thread's approval mode was explicitly set to manual — the
   * composer select outranks the global switch there.
   */
  bypassGlobalAutoApprove?: boolean
  /** A stored native proposal is one action, never a remembered tool grant.
   * An explicit exact-action persistentTarget is the only scoped exception. */
  requireFreshApproval?: boolean
  persistentTarget?: ToolPermissionTarget
}

export type ToolApprovalModalProps = {
  toolName: string
  threadId: string
  toolParameters?: object
  onApprove: (allowOnce: boolean) => void
  onDeny: () => void
  onAlwaysAllow?: () => void
  requireFreshApproval?: boolean
  permissionSource?: string
  storedActionPermission?: boolean
}

type ToolApprovalState = {
  // Track approved tools per thread
  approvedTools: Record<string, string[]> // threadId -> toolNames[]
  persistentTools: Record<string, ToolPermissionTarget & { enabled: boolean }>
  setPersistentTool: (target: ToolPermissionTarget, enabled: boolean) => void
  removePersistentTool: (key: string) => void
  // Global MCP permission toggle
  allowAllMCPPermissions: boolean
  // Modal state
  isModalOpen: boolean
  modalProps: ToolApprovalModalProps | null

  // Actions
  approveToolForThread: (threadId: string, toolName: string) => void
  isToolApproved: (threadId: string, toolName: string) => boolean
  showApprovalModal: (
    toolName: string,
    threadId: string,
    toolParameters?: object,
    options?: ShowApprovalModalOptions
  ) => Promise<boolean>
  closeModal: () => void
  setModalOpen: (open: boolean) => void
  setAllowAllMCPPermissions: (allow: boolean) => void
}

export const useToolApproval = create<ToolApprovalState>()(
  persist(
    (set, get) => ({
      approvedTools: {},
      persistentTools: {},
      setPersistentTool: (target, enabled) => set(state => ({ persistentTools: {
        ...state.persistentTools, [target.key]: { ...target, enabled },
      }, ...(enabled ? {} : { approvedTools: Object.fromEntries(Object.entries(state.approvedTools)
        .map(([id, names]) => [id, names.filter(name => name !== target.toolName)])) }) })),
      removePersistentTool: key => set(state => {
        const { [key]: removed, ...remaining } = state.persistentTools
        return { persistentTools: remaining, ...(removed ? { approvedTools: Object.fromEntries(Object.entries(state.approvedTools)
          .map(([id, names]) => [id, names.filter(name => name !== removed.toolName)])) } : {}) }
      }),
      allowAllMCPPermissions: true,
      isModalOpen: false,
      modalProps: null,

      approveToolForThread: (threadId: string, toolName: string) => {
        set((state) => ({
          approvedTools: {
            ...state.approvedTools,
            [threadId]: [
              ...(state.approvedTools[threadId] || []),
              toolName,
            ].filter((tool, index, arr) => arr.indexOf(tool) === index), // Remove duplicates
          },
        }))
      },

      isToolApproved: (threadId: string, toolName: string) => {
        const state = get()
        return state.approvedTools[threadId]?.includes(toolName) || false
      },

      showApprovalModal: (
        toolName: string,
        threadId: string,
        toolParameters?: object,
        options?: ShowApprovalModalOptions
      ) => {
        return new Promise<boolean>((resolve) => {
          const state = get()

          // Auto-approve if the user has enabled auto-approval setting
          if (
            state.allowAllMCPPermissions &&
            !options?.bypassGlobalAutoApprove && !options?.requireFreshApproval
          ) {
            resolve(true)
            return
          }

          // A stored native proposal still needs its own decision. A tool grant
          // never substitutes for reviewing that immutable pending action. Only an
          // explicitly remembered exact-action target can reuse its decision.
          const target = options?.persistentTarget
          if (target && (!options?.requireFreshApproval || target.storedAction) && state.persistentTools[target.key]?.enabled) {
            resolve(true)
            return
          }

          // Check if tool is already approved for this thread
          if (!options?.requireFreshApproval && state.isToolApproved(threadId, toolName)) {
            resolve(true)
            return
          }

          set({
            isModalOpen: true,
            modalProps: {
              toolName,
              threadId,
              toolParameters,
              requireFreshApproval: options?.requireFreshApproval,
              permissionSource: target?.source,
              storedActionPermission: target?.storedAction,
              ...(target && (!options?.requireFreshApproval || target.storedAction) ? { onAlwaysAllow: () => {
                get().setPersistentTool(target, true)
                get().closeModal()
                resolve(true)
              } } : {}),
              onApprove: (allowOnce: boolean) => {
                if (!allowOnce && !options?.requireFreshApproval) {
                  // If not "allow once", add to approved tools for this thread
                  get().approveToolForThread(threadId, toolName)
                }
                get().closeModal()
                resolve(true)
              },
              onDeny: () => {
                get().closeModal()
                resolve(false)
              },
            },
          })
          if (IS_TAURI) {
            notifyUnlessWatching(
              true,
              i18n.t('toolApproval.title', { ns: 'tools' }),
              i18n.t('toolApproval.notificationBody', { ns: 'tools' })
            )
          }
        })
      },

      closeModal: () => {
        set({
          isModalOpen: false,
          modalProps: null,
        })
      },

      setModalOpen: (open: boolean) => {
        set({ isModalOpen: open })
        if (!open) {
          get().closeModal()
        }
      },

      setAllowAllMCPPermissions: (allow: boolean) => {
        set({ allowAllMCPPermissions: allow })
      },
    }),
    {
      name: localStorageKey.toolApproval,
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // One-time migration: force auto-approve for every existing user so the
      // tool approval popup is hidden by default. Users can opt back in via
      // General → Chat Behavior or MCP Servers settings.
      // Version 2 preserves the user's switch; it does not repeat the old reset.
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<ToolApprovalState>
        return {
          ...state,
          allowAllMCPPermissions: state.allowAllMCPPermissions ?? true,
          persistentTools: state.persistentTools ?? {},
        } as ToolApprovalState
      },
      // Only persist approved tools and global permission setting, not modal state
      partialize: (state) => ({
        approvedTools: state.approvedTools,
        persistentTools: state.persistentTools,
        allowAllMCPPermissions: state.allowAllMCPPermissions,
      }),
    }
  )
)
