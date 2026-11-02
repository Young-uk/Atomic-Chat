import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PersonalFeatureSettingsPanel from './PersonalFeatureSettingsPanel'
const callTool = vi.hoisted(() => vi.fn())
const service = { mcp: () => ({ callTool }) }
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service }))
const defaults = { version: 1, semanticMemory: { enabled: false, url: 'http://127.0.0.1:19092/v1', model: '', dimensions: 768 }, memoryMaintenance: { enabled: false, queryRewrite: false } }
describe('PersonalFeatureSettingsPanel', () => {
  beforeEach(() => { callTool.mockReset().mockImplementation(async ({ arguments: args }) => ({ content: [{ type: 'text', text: JSON.stringify(args.settings ?? defaults) }] })); })
  it('loads disabled configuration without connecting a model and saves explicit edits', async () => {
    render(<PersonalFeatureSettingsPanel />)
    await waitFor(() => expect(screen.getAllByRole('switch', { hidden: true })).toHaveLength(3))
    for (const control of screen.getAllByRole('switch', { hidden: true })) expect(control).toHaveAttribute('aria-checked', 'false')
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(callTool.mock.calls[0][0].arguments).toEqual({ action: 'get' })
    await userEvent.click(screen.getByText('tools:features.title'))
    await userEvent.type(screen.getByLabelText('tools:features.model'), 'local-embedding')
    await userEvent.click(screen.getByRole('button', { name: 'tools:features.save' }))
    await waitFor(() => expect(callTool).toHaveBeenCalledTimes(2))
    expect(callTool.mock.calls[1][0].arguments.settings.semanticMemory).toMatchObject({ enabled: false, model: 'local-embedding' })
  })
  it('rejects malformed worker configuration without crashing', async () => {
    callTool.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })
    render(<PersonalFeatureSettingsPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('tools:features.failed')
    expect(screen.queryByRole('switch', { hidden: true })).not.toBeInTheDocument()
  })
})
