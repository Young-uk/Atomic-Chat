import { render, screen } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { expect, it, vi } from 'vitest'
import PersonalFeatureSettingsPanel from './PersonalFeatureSettingsPanel'
import { expectNoHorizontalOverflow, setFontSize, settle, withTranslations } from '@/test/layout'
const history = [{ id: 1, createdAt: 1000, changes: [{ id: 1, activation: 'Very long learned workflow '.repeat(10), principle: 'Check the successful result before continuing. '.repeat(15), steps: [{ text: 'Verify '.repeat(30) }], evidence: [{ id: 'tool', quote: 'successful-tool-result-'.repeat(40) }] }] }]
const service = { mcp: () => ({ callTool: async ({ arguments: args }: { arguments: { action: string } }) => ({ content: [{ type: 'text', text: JSON.stringify(args.action === 'history' ? history : { version: 1, semanticMemory: { enabled: false, url: 'http://127.0.0.1:19092/v1', model: '', dimensions: 768 }, memoryMaintenance: { enabled: false, queryRewrite: false, backgroundReview: false } }) }] }) }) }
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => service, getServiceHub: () => service }))
it.each([1024, 1280].flatMap(width => ['16px', '20px'].flatMap(font => ['light', 'dark'].map(theme => ({ width, font, theme })))))('memory and review controls fit $width/$font/$theme', async ({ width, font, theme }) => {
  await page.viewport(width, 1000); setFontSize(font)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  render(withTranslations(<div style={{ width: width - 288, padding: 16 }}><PersonalFeatureSettingsPanel /></div>))
  await settle()
  const details = document.querySelector('details')!; details.open = true
  await settle()
  const nested = details.querySelector('details')!; nested.open = true
  await settle()
  const evidence = nested.querySelector('details')!; evidence.open = true
  await settle()
  expect(screen.getAllByRole('switch')).toHaveLength(4)
  expectNoHorizontalOverflow(details)
  expectNoHorizontalOverflow(nested)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
})
