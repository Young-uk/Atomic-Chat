import { describe, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import PersonalWorkerPanel from './PersonalWorkerPanel'
import { DEFAULT_FONT_SIZE, XL_FONT_SIZE, expectNoHorizontalOverflow, setFontSize, setTheme, settle } from '@/test/layout'
const service = { mcp: () => ({ callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ supported: true, running: false, registered: false, enabledAtLogin: false }) }] }) }) }
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service, getServiceHub: () => service }))
for (const width of [1024, 1280]) for (const font of [DEFAULT_FONT_SIZE, XL_FONT_SIZE]) for (const theme of ['light', 'dark'] as const) {
  describe(`${width}/${font}/${theme}`, () => {
    it('keeps service controls inside the panel', async () => {
      await page.viewport(width, 900); setFontSize(font); setTheme(theme)
      const { container } = render(<main style={{ width: width - 300 }} className="p-4"><PersonalWorkerPanel /></main>)
      container.querySelectorAll('details').forEach(details => { details.open = true })
      await settle(container)
      expectNoHorizontalOverflow(container)
    })
  })
}
