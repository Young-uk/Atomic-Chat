import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useModelProvider } from '@/hooks/useModelProvider'
import { localEngineCoordinator, STRATA_MODEL, STRATA_PROVIDER, useLocalEngine } from '@/services/managed-local-engine'
import { ServerEngineIdentity } from './ServerEngineIdentity'
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
 const model = { id: STRATA_MODEL } as Model
 useModelProvider.setState({ selectedProvider: STRATA_PROVIDER, selectedModel: model, providers: [{ provider: STRATA_PROVIDER, active: true, base_url: 'http://127.0.0.1:18080/v1', models: [model] } as ModelProvider] })
 useLocalEngine.setState({ target: {engine:'strata', provider: STRATA_PROVIDER, model: STRATA_MODEL}, phase:'ready', snapshot:{ engine:'strata', status:'ready', owned:true, servedModels:[STRATA_MODEL] } }, true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('reports verified Strata separately without lifecycle side effects or controls', () => {
 const start = vi.spyOn(localEngineCoordinator, 'retry')
 const stop = vi.spyOn(localEngineCoordinator, 'cancel')
 render(<ServerEngineIdentity />)
 expect(screen.getByText('endpoints:localEngine.ready')).toBeInTheDocument()
 expect(screen.getByText(/Strata/)).toBeInTheDocument()
 expect(screen.getByText('api:overview.routeHint')).toBeInTheDocument()
 expect(screen.queryByRole('button')).not.toBeInTheDocument()
 expect(start).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled()
})
it.each(['wrong-engine','wrong-model','not-ready','stale-selection'])('does not claim readiness for %s', kind => {
 if (kind === 'wrong-engine') useLocalEngine.setState({snapshot:{engine:'dstar',status:'ready',owned:true,servedModels:[STRATA_MODEL]}})
 if (kind === 'wrong-model') useLocalEngine.setState({snapshot:{engine:'strata',status:'ready',owned:true,servedModels:['another-model']}})
 if (kind === 'not-ready') useLocalEngine.setState({snapshot:{engine:'strata',status:'stopped',owned:false,servedModels:[]}})
 if (kind === 'stale-selection') useLocalEngine.setState({target:{engine:'strata',provider:STRATA_PROVIDER,model:'another-model'}})
 render(<ServerEngineIdentity />)
 expect(screen.queryByText('endpoints:localEngine.ready')).not.toBeInTheDocument()
 expect(screen.getByText('api:overview.engineUnknown')).toBeInTheDocument()
})
it.each(['loading','waiting','stopping','idle','error'] as const)('reports %s honestly', phase => {
 useLocalEngine.setState({phase, ...(phase === 'idle' ? {snapshot:{engine:'strata',status:'stopped',owned:false,servedModels:[]}} : {})})
 render(<ServerEngineIdentity />)
 expect(screen.getByText(`endpoints:localEngine.${phase}`)).toBeInTheDocument()
 expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('does not call an unpolled startup state stopped', () => {
 useLocalEngine.setState({phase:'idle',snapshot:undefined})
 render(<ServerEngineIdentity />)
 expect(screen.getByText('api:overview.engineUnknown')).toBeInTheDocument()
 expect(screen.queryByText('endpoints:localEngine.idle')).not.toBeInTheDocument()
})
