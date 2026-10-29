import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { controlDstar, isDstarEndpoint, restartDstar } from './dstar'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const call = vi.mocked(invoke)

describe('personal Dstar control', () => {
  beforeEach(() => {
    call.mockReset()
  })
  it('recognizes only this local engine, not a lookalike remote URL', () => {
    expect(isDstarEndpoint('http://127.0.0.1:8010/v1')).toBe(true)
    expect(isDstarEndpoint('http://localhost:8010/v1')).toBe(true)
    for (const url of [
      'https://localhost:8010/v1',
      'http://localhost.example.com:8010/v1',
      'http://127.0.0.1:1337/v1',
      'bad',
    ])
      expect(isDstarEndpoint(url)).toBe(false)
  })
  it('sends only the selected model and context across the lifecycle boundary', async () => {
    call.mockResolvedValue({ owned: true })
    const started = await controlDstar('start', {
      model: 'iq3',
      context: 65536,
    })
    expect(started.owned).toBe(true)
    expect(call).toHaveBeenCalledWith('dstar_control', {
      action: 'start',
      selection: { model: 'iq3', context: 65536 },
    })
  })
  it('waits for Stop to settle before starting the replacement model', async () => {
    vi.useFakeTimers()
    try {
      call
        .mockResolvedValueOnce({ owned: true })
        .mockResolvedValueOnce({ owned: false })
        .mockResolvedValueOnce({ owned: true, status: 'loading' })
      const promise = restartDstar({ model: 'q2', context: 32768 })
      await vi.advanceTimersByTimeAsync(199)
      expect(call).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await promise).status).toBe('loading')
      expect(call.mock.calls.map((args) => args[1])).toEqual([
        { action: 'stop', selection: undefined },
        { action: 'status', selection: undefined },
        { action: 'start', selection: { model: 'q2', context: 32768 } },
      ])
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not start anything if the server is not ours to stop', async () => {
    call.mockRejectedValueOnce('notOwned')
    await expect(restartDstar({ model: 'iq3', context: 65536 })).rejects.toBe(
      'notOwned'
    )
    expect(call).toHaveBeenCalledTimes(1)
  })
})
