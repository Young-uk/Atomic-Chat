import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolApproval } from '../useToolApproval'
import { useDesktopControlOverlay } from '../useDesktopControlOverlay'

const mocks = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined), listen: vi.fn(), handler: undefined as undefined | ((event: { payload: { id: string; decision: string } }) => void) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@/lib/personal-build', () => ({ isPersonalBuild: () => true }))

describe('desktop overlay permission decisions', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_TAURI', true)
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.listen.mockImplementation((_name, callback) => { mocks.handler = callback; return Promise.resolve(vi.fn()) })
    useToolApproval.setState({ isModalOpen: false, modalProps: null })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  function request() {
    const onApprove = vi.fn(() => useToolApproval.getState().closeModal())
    const onDeny = vi.fn(() => useToolApproval.getState().closeModal())
    act(() => useToolApproval.setState({ isModalOpen: true, modalProps: {
      toolName: 'personal_native', threadId: 'thread', toolParameters: { action: 'confirm', pendingId: 'stored-one', nativeTool: 'os.screen.click' }, onApprove, onDeny,
    } }))
    const calls = mocks.invoke.mock.calls.filter(([name]) => name === 'update_desktop_control_overlay')
    const payload = calls.at(-1)?.[1]
    return { onApprove, onDeny, id: payload.approvalId, payload }
  }
  it('shows a focused-window request and resolves only the current request once', () => {
    renderHook(() => useDesktopControlOverlay('thread', [], 'ready'))
    const first = request()
    expect(first.payload.title).toBe('Approval required')
    expect(first.payload.detail).toContain('stored-one')
    const second = request()
    act(() => mocks.handler?.({ payload: { id: first.id, decision: 'approve' } }))
    expect(second.onApprove).not.toHaveBeenCalled()
    act(() => mocks.handler?.({ payload: { id: second.id, decision: 'approve' } }))
    act(() => mocks.handler?.({ payload: { id: second.id, decision: 'approve' } }))
    expect(second.onApprove).toHaveBeenCalledExactlyOnceWith(true)
    expect(first.onApprove).not.toHaveBeenCalled()
  })
  it('denies through the existing callback and ignores a closed request', () => {
    renderHook(() => useDesktopControlOverlay('thread', [], 'ready'))
    const first = request()
    act(() => mocks.handler?.({ payload: { id: first.id, decision: 'deny' } }))
    expect(first.onDeny).toHaveBeenCalledOnce()
    expect(useToolApproval.getState().modalProps).toBeNull()
    expect(useToolApproval.getState().isModalOpen).toBe(false)
    const second = request()
    act(() => useToolApproval.getState().closeModal())
    act(() => mocks.handler?.({ payload: { id: second.id, decision: 'approve' } }))
    expect(second.onApprove).not.toHaveBeenCalled()
  })
})
