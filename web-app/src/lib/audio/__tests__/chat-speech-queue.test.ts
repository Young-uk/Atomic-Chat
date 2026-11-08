import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeechQueue } from '../chat-speech-queue'

const fixture = vi.hoisted(() => ({
  generate: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(), deleteGalleryItem: vi.fn(),
  getStatus: vi.fn(), loadModel: vi.fn(), unsubscribe: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ audio: () => ({
  ...fixture, subscribe: () => fixture.unsubscribe, listModelFiles: async () => [],
}) }) }))
vi.mock('@/lib/audio/models', () => ({
  audioWireId: () => 'qwen', isAudioQuantOnDisk: () => true,
  buildAudioLoadRequest: () => ({}), QWEN_CHAT_TTS_MODEL: 'qwen', QWEN_CHAT_TTS_VOICE: 'sohee',
}))
vi.mock('@/services/audio-catalog-registry', () => ({
  fetchAudioCatalog: async () => ({ catalog: {} }), findAudioModel: () => ({ quants: [{}] }),
}))
vi.mock('@/lib/video/webview-playback', () => ({ webviewReadsAssetMedia: () => true, MAX_BLOB_CLIP_BYTES: 1024 }))
vi.mock('@/lib/readFileBytes', () => ({ readFileBytes: async () => ({ bytes: new Uint8Array(44), size: 44 }) }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }))
vi.mock('sonner', () => ({ toast: { error: fixture.toast } }))

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
const queues: ReturnType<typeof createSpeechQueue>[] = []
const queue = () => { const q = createSpeechQueue(vi.fn(), vi.fn()); queues.push(q); return q }

beforeEach(() => {
  vi.clearAllMocks()
  fixture.getStatus.mockResolvedValue({ model: { loaded: { modelId: 'qwen' } } })
  fixture.cancelJob.mockResolvedValue(undefined)
  fixture.deleteGalleryItem.mockResolvedValue(undefined)
  fixture.getJob.mockResolvedValue({ id: 'late', state: 'cancelled' })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('playing'))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(async () => {
  await Promise.all(queues.splice(0).map((q) => q.stop()))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('speech queue shutdown', () => {
  it('cancels a generate response that arrives after off and waits before draining', async () => {
    let respond!: (job: unknown) => void
    fixture.generate.mockImplementation(() => new Promise((resolve) => { respond = resolve }))
    const q = queue()
    q.enqueue([{ text: 'Read me.' }])
    await flush()
    expect(fixture.generate).toHaveBeenCalledTimes(1)
    let drained = false
    const stopping = q.stop().then(() => { drained = true })
    await flush()
    expect(drained).toBe(false)
    respond({ id: 'late', state: 'generating' })
    await stopping
    expect(fixture.cancelJob).toHaveBeenCalledExactlyOnceWith('late')
    expect(document.querySelector('audio')).toBeNull()
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1)
    expect(fixture.toast).not.toHaveBeenCalled()
  })

  it('plays competing messages sequentially and stops the active clip and queued clips once', async () => {
    let count = 0
    fixture.generate.mockImplementation(async () => ({ id: `clip-${++count}`, state: 'completed', output: { path: '/clip.wav' } }))
    const q = queue()
    q.enqueue([{ text: 'One.' }, { text: 'Two.' }, { text: 'Three.' }])
    await flush()
    await vi.waitFor(() => expect(fixture.generate).toHaveBeenCalledTimes(3))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('audio')).toHaveLength(1)
    document.querySelector('audio')!.dispatchEvent(new Event('ended'))
    await flush()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    await q.stop()
    await q.stop()
    expect(document.querySelector('audio')).toBeNull()
    expect(fixture.deleteGalleryItem.mock.calls.map(([id]) => id).sort()).toEqual(['clip-1', 'clip-2', 'clip-3'])
    expect(fixture.toast).not.toHaveBeenCalled()
  })

  it('does not generate after off interrupts model preparation', async () => {
    let loaded!: () => void
    fixture.getStatus.mockResolvedValue({ model: {} })
    fixture.loadModel.mockImplementation(() => new Promise<void>((resolve) => { loaded = resolve }))
    const q = queue()
    q.enqueue([{ text: 'Pending.' }])
    await flush()
    const stopped = q.stop()
    loaded()
    await stopped
    expect(q.stopped).toBe(true)
    expect(fixture.generate).not.toHaveBeenCalled()
    expect(fixture.toast).not.toHaveBeenCalled()
  })

  it('stops once on synthesis failure and never retries an ordinary failed request', async () => {
    fixture.generate.mockRejectedValue(new Error('Unavailable'))
    const q = queue()
    q.enqueue([{ text: 'One.' }, { text: 'Two.' }])
    await flush()
    expect(q.stopped).toBe(true)
    expect(fixture.generate).toHaveBeenCalledTimes(1)
    expect(fixture.toast).toHaveBeenCalledTimes(1)
    await q.stop()
  })

  it('records media state and stops after both native and blob playback stall', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = () => 'blob:fixture'
      static revokeObjectURL = vi.fn()
    })
    fixture.generate.mockResolvedValue({ id: 'clip', state: 'completed', output: { path: '/private-clip.wav' } })
    const q = queue()
    q.enqueue([{ text: 'Private spoken text.' }])
    await flush()
    await vi.advanceTimersByTimeAsync(11000)
    await q.stop()
    expect(q.stopped).toBe(true)
    expect(document.querySelector('audio')).toBeNull()
    const failures = warn.mock.calls.filter(([message]) => message === '[chat-speech] Playback failed')
    expect(failures.map(([, fields]) => fields)).toEqual([
      expect.objectContaining({ source: 'asset', currentTime: 0, readyState: 0, mediaError: null }),
      expect.objectContaining({ source: 'blob', currentTime: 0, readyState: 0, mediaError: null }),
    ])
    expect(JSON.stringify(failures)).not.toMatch(/private-clip|Private spoken/)
    expect(fixture.deleteGalleryItem).toHaveBeenCalledExactlyOnceWith('clip')
    expect(fixture.toast).toHaveBeenCalledTimes(1)
  })
})
