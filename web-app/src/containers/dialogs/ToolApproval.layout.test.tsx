import { render, screen } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { afterEach, expect, it } from 'vitest'
import ToolApproval from './ToolApproval'
import { useToolApproval } from '@/hooks/useToolApproval'
import { expectNoHorizontalOverflow, setFontSize, setTheme, settle, withTranslations } from '@/test/layout'

afterEach(() => useToolApproval.setState({ isModalOpen: false, modalProps: null }))

it.each([1024, 1280].flatMap(width => ['13px', '20px'].flatMap(fontSize => (['light', 'dark'] as const).map(theme => ({ width, fontSize, theme })))))('native approval stays readable: $width $fontSize $theme', async ({ width, fontSize, theme }) => {
  await page.viewport(width, 800)
  setFontSize(fontSize)
  setTheme(theme)
  useToolApproval.setState({ isModalOpen: true, modalProps: {
    toolName: 'personal_native', threadId: 'layout',
    toolParameters: { action: 'confirm', nativeTool: 'os.fs.write', arguments: { path: '/long-project-folder/'.repeat(30) + 'file.txt' } },
    onApprove: () => {}, onDeny: () => {},
  } })
  render(withTranslations(<ToolApproval />))
  await settle()
  const dialog = screen.getByRole('dialog')
  expectNoHorizontalOverflow(dialog)
  const box = dialog.getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(width)
  expect(box.height).toBeLessThanOrEqual(800)
  for (const button of screen.getAllByRole('button')) {
    const b = button.getBoundingClientRect()
    expect(b.right).toBeLessThanOrEqual(box.right)
  }
})
