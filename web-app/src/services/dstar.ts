import { invoke } from '@tauri-apps/api/core'

export type DstarSelection = { model: string; context: number }
export type DstarSnapshot = {
  available: boolean
  status:
    | 'unavailable'
    | 'stopped'
    | 'loading'
    | 'ready'
    | 'stopping'
    | 'external'
    | 'error'
  owned: boolean
  selection: DstarSelection
  models: {
    id: string
    name: string
    available: boolean
    reason?: string
    bytes: number
  }[]
  servedModels: string[]
  elapsedSeconds: number
  error?: string
  log: string
}

/** Only typed lifecycle actions cross IPC; command lines never come from the renderer. */
export const controlDstar = (
  action: 'status' | 'start' | 'stop',
  selection?: DstarSelection
) => invoke<DstarSnapshot>('dstar_control', { action, selection })

export function isDstarEndpoint(url?: string): boolean {
  try {
    const value = new URL(url ?? '')
    return (
      value.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(value.hostname) &&
      value.port === '8010'
    )
  } catch {
    return false
  }
}

/** Wait for our owned child to exit before starting another model. */
export async function restartDstar(
  selection: DstarSelection
): Promise<DstarSnapshot> {
  let snapshot = await controlDstar('stop')
  const deadline = Date.now() + 8_000
  while (snapshot.owned) {
    if (Date.now() >= deadline) throw new Error('stopTimeout')
    await new Promise((resolve) => setTimeout(resolve, 200))
    snapshot = await controlDstar('status')
  }
  return controlDstar('start', selection)
}
