import { invoke } from '@tauri-apps/api/core'
import { beforeEach, expect, it, vi } from 'vitest'
import { controlLocalEngine } from '../managed-local-engine'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => vi.mocked(invoke).mockReset())
it('forwards an explicit Strata context for the native owner to validate and persist', async () => {
  await controlLocalEngine('ensure', 'strata', 32768)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('managed_engine_control', {
    action: 'ensure', engine: 'strata', strataContext: 32768,
  })
})
it('leaves ordinary lifecycle commands and Dstar configuration unchanged', async () => {
  await controlLocalEngine('ensure', 'dstar')
  await controlLocalEngine('status', 'strata')
  expect(invoke).toHaveBeenNthCalledWith(1, 'managed_engine_control', { action: 'ensure', engine: 'dstar' })
  expect(invoke).toHaveBeenNthCalledWith(2, 'managed_engine_control', { action: 'status', engine: 'strata' })
})
