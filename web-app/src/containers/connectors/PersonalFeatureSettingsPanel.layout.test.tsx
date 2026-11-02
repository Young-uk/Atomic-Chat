import { render, screen } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { expect, it, vi } from 'vitest'
import PersonalFeatureSettingsPanel from './PersonalFeatureSettingsPanel'
import { expectNoHorizontalOverflow, setFontSize, settle, withTranslations } from '@/test/layout'
const service = { mcp: () => ({ callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ version: 1, semanticMemory: { enabled: false, url: 'http://127.0.0.1:19092/v1', model: '', dimensions: 768 }, memoryMaintenance: { enabled: false, queryRewrite: false } }) }] }) }) }
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service, getServiceHub: () => service }))
it.each([400, 720])('memory controls fit a $width pixel settings column', async width => {
  await page.viewport(width, 1000); setFontSize('20px')
  render(withTranslations(<div style={{ width: '100%', padding: 16 }}><PersonalFeatureSettingsPanel /></div>))
  await settle()
  const details = document.querySelector('details')!; details.open = true
  await settle()
  expect(screen.getAllByRole('switch')).toHaveLength(3)
  expectNoHorizontalOverflow(details)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
})
