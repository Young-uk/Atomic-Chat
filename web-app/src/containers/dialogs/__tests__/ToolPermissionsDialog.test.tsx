import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import ToolPermissionsDialog from '../ToolPermissionsDialog'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useAppState } from '@/hooks/useAppState'
import { useMCPServers } from '@/hooks/useMCPServers'
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/chat-exec-tools', () => ({ offeredChatExecToolNames: () => new Set() }))
beforeEach(() => {
  useToolApproval.setState({ persistentTools: {}, approvedTools: {} })
  useAppState.setState({ tools: [{ name: 'synthetic_catalog', description: 'Synthetic catalog only', server: 'test', inputSchema: { type: 'object' } }] })
  useMCPServers.setState({ mcpServers: { test: { command: 'test', args: [], env: {} } } })
})
it('offers configured tools and persists allow/revoke decisions', async () => {
  render(<ToolPermissionsDialog open onOpenChange={() => {}} />)
  const toggle = await screen.findByRole('switch')
  fireEvent.click(toggle)
  expect(Object.values(useToolApproval.getState().persistentTools)[0].enabled).toBe(true)
  fireEvent.click(toggle)
  expect(Object.values(useToolApproval.getState().persistentTools)[0].enabled).toBe(false)
})
it('keeps disconnected permissions visible for removal without applying them to a new provider', async () => {
  useToolApproval.setState({ persistentTools: { old: { key: 'old', toolName: 'synthetic_catalog', source: 'previous', enabled: true } } })
  render(<ToolPermissionsDialog open onOpenChange={() => {}} />)
  await screen.findByRole('switch')
  expect(screen.getByText('tools:permissions.unavailable')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'tools:permissions.remove' }))
  await waitFor(() => expect(useToolApproval.getState().persistentTools.old).toBeUndefined())
})
