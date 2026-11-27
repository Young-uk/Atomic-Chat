import { create } from 'zustand'

export const useStrataProjection = create<{
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}>((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
}))
