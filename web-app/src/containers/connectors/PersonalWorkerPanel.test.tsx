import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import PersonalWorkerPanel from './PersonalWorkerPanel'
const callTool = vi.hoisted(() => vi.fn())
const service = { mcp: () => ({ callTool }) }
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service }))
beforeEach(() => {
  callTool.mockReset().mockImplementation(async ({ arguments: args }) => ({ content: [{ type: 'text', text: JSON.stringify({ supported: true, running: args.action === 'worker_start', registered: args.action !== 'worker_status', enabledAtLogin: false }) }] }))
})
it('only reads on opening and starts on explicit user action', async () => {
  render(<PersonalWorkerPanel />)
  await userEvent.click(screen.getByText('Background service'))
  await screen.findByText('App only')
  expect(callTool).toHaveBeenCalledTimes(1)
  expect(callTool.mock.calls[0][0].arguments).toEqual({ action: 'worker_status' })
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await userEvent.click(screen.getByRole('button', { name: 'Start service' }))
  await screen.findByText('Background service running')
  expect(callTool.mock.calls[1][0].arguments).toEqual({ action: 'worker_start' })
})
it('reports service errors and leaves controls usable', async () => {
  callTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'Service unavailable' }] })
  render(<PersonalWorkerPanel />)
  await userEvent.click(screen.getByText('Background service'))
  await waitFor(() => expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent('Service unavailable'))
})
