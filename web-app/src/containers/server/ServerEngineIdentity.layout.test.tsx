import { cleanup, render, screen } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { afterEach, expect, it } from 'vitest'
import i18n from '@/i18n/setup'
import { useModelProvider } from '@/hooks/useModelProvider'
import { STRATA_MODEL, STRATA_PROVIDER, useLocalEngine } from '@/services/managed-local-engine'
import { DEFAULT_FONT_SIZE, XL_FONT_SIZE, expectNoHorizontalOverflow, setFontSize, setTheme, settle, withTranslations } from '@/test/layout'
import { ServerEngineIdentity } from './ServerEngineIdentity'
afterEach(() => { cleanup(); i18n.changeLanguage('en'); setFontSize(DEFAULT_FONT_SIZE); setTheme('light') })
for (const width of [1024,1280]) for (const font of [DEFAULT_FONT_SIZE,XL_FONT_SIZE]) for (const theme of ['light','dark'] as const) for (const language of ['en','ko']) {
 it(`separates API route from active Strata at ${width}/${font}/${theme}/${language}`, async () => {
  await page.viewport(width,800); setFontSize(font); setTheme(theme); await i18n.changeLanguage(language)
  const model = {id:STRATA_MODEL} as Model
  useModelProvider.setState({selectedProvider:STRATA_PROVIDER,selectedModel:model,providers:[{provider:STRATA_PROVIDER,active:true,base_url:'http://127.0.0.1:18080/v1',models:[model]} as ModelProvider]})
  useLocalEngine.setState({target:{engine:'strata',provider:STRATA_PROVIDER,model:STRATA_MODEL},phase:'ready',snapshot:{engine:'strata',status:'ready',owned:true,servedModels:[STRATA_MODEL]}},true)
  render(withTranslations(<div data-testid="surface" style={{width:width-304}}><ServerEngineIdentity /></div>))
  await settle()
  expectNoHorizontalOverflow(screen.getByTestId('surface'))
  expect(screen.getByText(/Strata/, {selector:'strong'})).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
 })
}
