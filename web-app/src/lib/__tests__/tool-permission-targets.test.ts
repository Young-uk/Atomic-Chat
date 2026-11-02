import { beforeEach, expect, it, vi } from 'vitest'
import { useAppState } from '@/hooks/useAppState'
import { useMCPServers } from '@/hooks/useMCPServers'
import { toolPermissionTarget } from '../tool-permission-targets'
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
