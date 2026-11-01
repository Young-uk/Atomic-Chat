import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonalToolsPanel } from './PersonalToolsPanel'

const callTool = vi.hoisted(() => vi.fn())
const service = { mcp: () => ({ callTool }) }
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service, getServiceHub: () => service }))

describe('PersonalToolsPanel', () => {
  beforeEach(() => {
    callTool.mockReset().mockImplementation(async ({ toolName, arguments: args }) => ({ content: [{ type: 'text', text: JSON.stringify(toolName === 'personal_memory' ? [{ id: 'm1', text: 'Saved preference', source: 'chat/message/1' }] : args.action === 'list' ? [{ id: 't1', prompt: 'Test task', status: 'completed', dueAt: 0, runs: [{ result: 'READY' }] }] : {}) }] }))
  })
  it('shows persisted task results without starting inference', async () => {
    render(<PersonalToolsPanel />)
    await userEvent.click(screen.getByText(/Scheduled tasks/))
    await waitFor(() => expect(screen.getByText('READY')).toBeInTheDocument())
    expect(callTool.mock.calls.every(([call]) => call.arguments.action === 'list')).toBe(true)
  })
  it('searches memory and presents its original source', async () => {
    render(<PersonalToolsPanel />)
    await userEvent.click(screen.getByText('Long-term memory'))
    await userEvent.type(screen.getByLabelText('Search personal memory'), 'preference')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('chat/message/1')).toBeInTheDocument()
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'personal_memory', arguments: { action: 'search', query: 'preference' } }))
  })
  it('surfaces MCP failures instead of presenting an empty successful result', async () => {
    callTool.mockResolvedValue({ error: 'Worker unavailable', content: [] })
    render(<PersonalToolsPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Worker unavailable')
  })
})
