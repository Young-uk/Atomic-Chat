import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { PersonalToolsPanel } from './PersonalToolsPanel'
import { DEFAULT_FONT_SIZE, XL_FONT_SIZE, expectNoHorizontalOverflow, setFontSize, setTheme, settle } from '@/test/layout'

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => service, getServiceHub: () => service,
}))
const service = { mcp: () => ({ callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify([{ id: 'task', prompt: 'A_long_scheduled_request_'.repeat(30), status: 'completed', dueAt: 0, runs: [{ result: 'A long result '.repeat(100) }] }]) }] }) }) }

for (const width of [1024, 1280]) for (const font of [DEFAULT_FONT_SIZE, XL_FONT_SIZE]) for (const theme of ['light', 'dark'] as const) {
  describe(`${width} / ${font} / ${theme}`, () => {
    it('keeps long task contents and actions inside the available panel', async () => {
      await page.viewport(width, 900)
      setFontSize(font)
      setTheme(theme)
      const { container } = render(<main style={{ width: width - 300 }} className="p-4"><PersonalToolsPanel /></main>)
      await waitFor(() => expect(screen.getByText('Scheduled tasks (1)')).toBeTruthy())
      container.querySelectorAll('details').forEach(details => { details.open = true })
      await settle(container)
      expectNoHorizontalOverflow(container)
    })
  })
}
