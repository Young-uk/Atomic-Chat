import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LocalEngineStatus } from './LocalEngineStatus'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useChatSessions } from '@/stores/chat-session-store'
import { localEngineCoordinator, STRATA_MODEL, STRATA_PROVIDER, useLocalEngine } from '@/services/managed-local-engine'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import englishEndpoints from '@/locales/en/endpoints.json'
import koreanEndpoints from '@/locales/ko/endpoints.json'
beforeEach(() => {
  vi.stubGlobal('IS_TAURI', true)
  const model = { id: STRATA_MODEL, settings: {} } as Model
  useModelProvider.setState({ selectedProvider: STRATA_PROVIDER, selectedModel: model, providers: [{ provider: STRATA_PROVIDER, active: true, base_url: 'http://127.0.0.1:18080/v1', api_key: '', models: [model], settings: [] }] })
  useLocalEngine.setState({ target: { engine: 'strata', provider: STRATA_PROVIDER, model: STRATA_MODEL }, phase: 'ready' }, true)
  useChatSessions.setState({ requestActive: {}, sessions: {} })
})
afterEach(() => { i18n.changeLanguage('en'); cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('disables Stop through an active reply or tool approval, with a clear wait hint', () => {
  useChatSessions.getState().setRequestActive('tools', true)
  const cancel = vi.spyOn(localEngineCoordinator, 'cancel').mockImplementation(() => {})
  render(<LocalEngineStatus />)
  const stop = screen.getByRole('button', { name: 'endpoints:localEngine.stop' })
  expect(stop).toBeDisabled()
  expect(stop).toHaveAttribute('title', 'endpoints:localEngine.waiting')
  fireEvent.click(stop)
  expect(cancel).not.toHaveBeenCalled()
})
it('offers Stop when ready and idle, and Retry on a failed start', () => {
  const cancel = vi.spyOn(localEngineCoordinator, 'cancel').mockImplementation(() => {})
  const view = render(<LocalEngineStatus />)
  fireEvent.click(screen.getByRole('button', { name: 'endpoints:localEngine.stop' }))
  expect(cancel).toHaveBeenCalledOnce()
  view.unmount()
  useLocalEngine.setState({ phase: 'error', error: 'foreignEngine' })
  render(<LocalEngineStatus />)
  expect(screen.getByRole('alert')).toHaveTextContent('endpoints:localEngine.errors.foreignEngine')
  expect(screen.getByRole('button', { name: 'endpoints:localEngine.retry' })).toBeEnabled()
})

it.each([
  ['en', englishEndpoints.localEngine.strataCaution, /high memory requirements/, /reported capabilities/],
  ['ko', koreanEndpoints.localEngine.strataCaution, /메모리 요구량이 큰/, /서버가 알려 주는 지원 기능/],
] as const)('shows accurate experimental IQ3 caution in %s without promising unqualified features', (language, caution, memory, capabilities) => {
  i18n.changeLanguage(language)
  render(<TranslationContext.Provider value={{ t: i18n.t, i18n }}><LocalEngineStatus /></TranslationContext.Provider>)
  const notice = screen.getByText(caution)
  expect(notice).toBeVisible()
  expect(notice).toHaveTextContent('IQ3_XXS')
  expect(notice).toHaveTextContent(memory)
  expect(notice).toHaveTextContent(capabilities)
  expect(notice).toHaveTextContent(language === 'en' ? 'not yet been verified' : '아직 검증되지 않았습니다')
  expect(notice).not.toHaveTextContent(/IQ2|64K|not connected yet|아직 연결되지/)
})
