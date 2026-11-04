import { beforeEach, expect, it, vi } from 'vitest'
import { useAppState } from '@/hooks/useAppState'
import { useMCPServers } from '@/hooks/useMCPServers'
import { toolPermissionTarget, storedActionPermissionTarget } from '../tool-permission-targets'
vi.mock('../chat-exec-tools', () => ({ offeredChatExecToolNames: () => new Set(['run_command']) }))
beforeEach(() => {
  useAppState.setState({ tools: [{ name: 'read', server: 'local', description: '', inputSchema: { type: 'object' } }] })
  useMCPServers.setState({ mcpServers: { local: { command: 'node', args: ['tool.mjs'], env: { TOKEN: 'synthetic-secret' }, active: true } } })
})
it('binds access to provider configuration and schema without storing credentials', async () => {
  const original = await toolPermissionTarget('read')
  expect(JSON.stringify(original)).not.toContain('synthetic-secret')
  useMCPServers.getState().mcpServers.local.active = false
  expect(await toolPermissionTarget('read')).toEqual(original)
  useMCPServers.getState().mcpServers.local.args = ['replacement.mjs']
  expect((await toolPermissionTarget('read'))?.key).not.toBe(original?.key)
  useAppState.getState().tools[0].inputSchema = { type: 'string' }
  expect((await toolPermissionTarget('read'))?.key).not.toBe(original?.key)
})
it('refuses unknown or ambiguous providers and distinguishes built-ins', async () => {
  expect(await toolPermissionTarget('missing')).toBeUndefined()
  useAppState.getState().tools.push({ ...useAppState.getState().tools[0], server: 'other' })
  expect(await toolPermissionTarget('read')).toBeUndefined()
  expect((await toolPermissionTarget('run_command'))?.source).toBe('Atomic Chat')
})

it('scopes stored action grants to canonical arguments, resources and provider', async () => {
  useAppState.setState({ tools: [{ name: 'personal_native', server: 'atomic-personal-tools', description: '', inputSchema: { type: 'object' } }] })
  useMCPServers.setState({ mcpServers: { 'atomic-personal-tools': { command: 'node', args: ['worker.mjs'], env: {}, active: true } } })
  const original = await storedActionPermissionTarget('os.shell.run', { cmd: 'printf synthetic-secret', cwd: '/fixture' }, { category: 'shell' })
  expect(original?.storedAction).toBe(true)
  expect(JSON.stringify(original)).not.toContain('synthetic-secret')
  expect(await storedActionPermissionTarget('os.shell.run', { cwd: '/fixture', cmd: 'printf synthetic-secret' }, { category: 'shell' })).toEqual(original)
  expect((await storedActionPermissionTarget('os.shell.run', { cmd: 'different' }, { category: 'shell' }))?.key).not.toBe(original?.key)
  expect((await storedActionPermissionTarget('os.shell.run', { cmd: 'printf synthetic-secret', cwd: '/other' }, { category: 'shell' }))?.key).not.toBe(original?.key)
  expect((await storedActionPermissionTarget('os.fs.write', { cmd: 'printf synthetic-secret', cwd: '/fixture' }, { category: 'shell' }))?.key).not.toBe(original?.key)
  useMCPServers.getState().mcpServers['atomic-personal-tools'].args = ['replacement.mjs']
  expect((await storedActionPermissionTarget('os.shell.run', { cmd: 'printf synthetic-secret', cwd: '/fixture' }, { category: 'shell' }))?.key).not.toBe(original?.key)
})
