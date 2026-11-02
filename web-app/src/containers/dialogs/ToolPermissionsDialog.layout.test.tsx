import { render, screen } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { expect, it } from 'vitest'
import ToolPermissionsDialog from './ToolPermissionsDialog'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useAppState } from '@/hooks/useAppState'
import { expectNoHorizontalOverflow, setFontSize, setTheme, settle, withTranslations } from '@/test/layout'
it.each([1024, 1280].flatMap(width => ['13px', '20px'].flatMap(fontSize => (['light', 'dark'] as const).map(theme => ({ width, fontSize, theme })))))('permission settings remain bounded: $width $fontSize $theme', async ({ width, fontSize, theme }) => {
  await page.viewport(width, 800); setFontSize(fontSize); setTheme(theme)
  useAppState.setState({ tools: [] })
  const name = 'long-translated-native-tool-name-'.repeat(20)
  useToolApproval.setState({ persistentTools: { old: { key: 'old', source: name, toolName: name, enabled: true } } })
  render(withTranslations(<ToolPermissionsDialog open onOpenChange={() => {}} />))
  await settle()
  const dialog = screen.getByRole('dialog'); expectNoHorizontalOverflow(dialog)
  expect(dialog.getBoundingClientRect().height).toBeLessThanOrEqual(800)
  expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width)
})
