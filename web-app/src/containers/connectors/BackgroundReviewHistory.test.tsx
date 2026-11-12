import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import BackgroundReviewHistory from './BackgroundReviewHistory'
const callTool = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({ mcp: () => ({ callTool }) }) }))
it('loads only when opened and undoes exactly the selected review', async () => {
  let undone = false
  callTool.mockReset().mockImplementation(async ({ arguments: args }) => {
    if (args.action === 'undo') undone = true
    return { content: [{ type: 'text', text: JSON.stringify(args.action === 'undo' ? { undone: true } : [{ id: 7, createdAt: 1000, undoneAt: undone ? 2000 : null, changes: [{ id: 9, activation: 'Response style', principle: 'Keep it concise.', steps: [], evidence: [{ id: 'user', quote: 'Always keep it concise' }] }] }]) }] }
  })
  render(<BackgroundReviewHistory />)
  expect(callTool).not.toHaveBeenCalled()
  await userEvent.click(screen.getByText('tools:features.reviewHistory'))
  expect(await screen.findByText('Keep it concise.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'tools:features.reviewUndo' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'tools:features.reviewUndone' })).toBeDisabled())
  expect(callTool.mock.calls.filter(([args]) => args.arguments.action === 'undo').map(([args]) => args.arguments)).toEqual([{ action: 'undo', id: 7 }])
})
