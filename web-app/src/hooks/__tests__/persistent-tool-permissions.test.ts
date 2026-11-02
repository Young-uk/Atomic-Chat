import { beforeEach, expect, it } from 'vitest'
import { useToolApproval } from '../useToolApproval'
const target = { key: 'a'.repeat(64), toolName: 'synthetic', source: 'test-provider' }
beforeEach(() => useToolApproval.setState({ approvedTools: {}, persistentTools: {}, allowAllMCPPermissions: false, isModalOpen: false, modalProps: null }))
it('remembers explicit always allow across threads and revokes remembered thread access', async () => {
  const first = useToolApproval.getState().showApprovalModal('synthetic', 'one', {}, { persistentTarget: target })
  expect(useToolApproval.getState().modalProps?.onAlwaysAllow).toBeTypeOf('function')
  useToolApproval.getState().modalProps?.onAlwaysAllow?.()
  expect(await first).toBe(true)
  expect(await useToolApproval.getState().showApprovalModal('synthetic', 'two', {}, { persistentTarget: target })).toBe(true)
  useToolApproval.getState().approveToolForThread('two', 'synthetic')
  useToolApproval.getState().setPersistentTool(target, false)
  const next = useToolApproval.getState().showApprovalModal('synthetic', 'two', {}, { persistentTarget: target })
  expect(useToolApproval.getState().isModalOpen).toBe(true)
  useToolApproval.getState().modalProps?.onDeny()
  expect(await next).toBe(false)
})
it('does not reuse a saved grant for another provider or a native confirmation', async () => {
  useToolApproval.getState().setPersistentTool(target, true)
  for (const options of [{ persistentTarget: { ...target, key: 'b'.repeat(64) } }, { persistentTarget: target, requireFreshApproval: true }]) {
    const call = useToolApproval.getState().showApprovalModal('synthetic', 'one', {}, options)
    expect(useToolApproval.getState().isModalOpen).toBe(true)
    if ('requireFreshApproval' in options) expect(useToolApproval.getState().modalProps?.onAlwaysAllow).toBeUndefined()
    useToolApproval.getState().modalProps?.onDeny()
    expect(await call).toBe(false)
  }
})
it('persists only grants and settings, never live approval callbacks', () => {
  useToolApproval.getState().setPersistentTool(target, true)
  const stored = JSON.parse(localStorage.getItem('tool-approval') ?? '{}')
  // Inspect the configured persistence name rather than assuming a product key.
  const actual = JSON.parse(localStorage.getItem(useToolApproval.persist.getOptions().name)!)
  expect(actual.state.persistentTools[target.key].enabled).toBe(true)
  expect(actual.state.modalProps).toBeUndefined()
  expect(stored).toBeDefined()
})
