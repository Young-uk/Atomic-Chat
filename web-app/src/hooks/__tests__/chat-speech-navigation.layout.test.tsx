import { act, cleanup, render, waitFor } from '@testing-library/react'
import { userEvent } from '@vitest/browser/context'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useChatSpeech } from '../useChatSpeech'
import { useChatSpeechStore } from '@/stores/chat-speech-store'

// The backend supplies a small synthetic WAV, but playback is Chromium's real
// media implementation. No running app, models or user conversations are used.
const fixture = vi.hoisted(() => ({
  sessions: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  messageListeners: new Set<() => void>(),
  generate: vi.fn(), discard: vi.fn(),
}))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: {
  getState: () => ({ sessions: fixture.sessions }),
  subscribe: (cb: () => void) => { fixture.listeners.add(cb); return () => fixture.listeners.delete(cb) },
} }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ audio: () => ({
  subscribe: () => () => {}, listModelFiles: async () => [],
  getStatus: async () => ({ model: { loaded: { modelId: 'qwen' } } }),
  generate: fixture.generate, deleteGalleryItem: fixture.discard,
}) }) }))
vi.mock('@/lib/audio/models', () => ({
  audioWireId: () => 'qwen', isAudioQuantOnDisk: () => true,
  buildAudioLoadRequest: () => ({}), QWEN_CHAT_TTS_MODEL: 'qwen', QWEN_CHAT_TTS_VOICE: 'sohee',
}))
vi.mock('@/services/audio-catalog-registry', () => ({
  fetchAudioCatalog: async () => ({ catalog: {} }), findAudioModel: () => ({ quants: [{}] }),
}))
vi.mock('@/lib/video/webview-playback', () => ({ webviewReadsAssetMedia: () => false, MAX_BLOB_CLIP_BYTES: 1000000 }))
vi.mock('@/lib/readFileBytes', () => ({ readFileBytes: async () => {
  const sampleRate = 16000
  const bytes = new Uint8Array(44 + sampleRate * 2 * 3)
  const view = new DataView(bytes.buffer)
  const tag = (offset: number, text: string) => [...text].forEach((char, i) => bytes[offset + i] = char.charCodeAt(0))
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, bytes.length - 44, true)
  return { bytes }
} }))

function ChatPage({ name }: { name: string }) {
  const speech = useChatSpeech()
  return <button onClick={speech.toggle}>{name}: {speech.enabled ? 'on' : 'off'} ({speech.status})</button>
}
function App() {
  const [page, setPage] = useState('A')
  return <>
    <button onClick={() => setPage('A')}>Chat A</button>
    <button onClick={() => setPage('B')}>Chat B</button>
    <button onClick={() => setPage('settings')}>Settings</button>
    {page !== 'settings' && <ChatPage key={page} name={page} />}
  </>
}

afterEach(async () => {
  await act(async () => { useChatSpeechStore.getState().setEnabled(false) })
  await waitFor(() => expect(document.querySelector('audio')).toBeNull())
  cleanup()
  vi.restoreAllMocks()
})

it('keeps native audio advancing across A → B → Settings → A, then stops on Off', async () => {
  let job = 0
  fixture.generate.mockImplementation(async () => ({ id: `clip-${++job}`, state: 'completed', output: { path: '/synthetic.wav' } }))
  fixture.discard.mockResolvedValue(undefined)
  const chat = {
    status: 'ready',
    messages: [] as { id: string; role: string; parts: { type: string; text: string }[] }[],
    '~registerMessagesCallback': (cb: () => void) => { fixture.messageListeners.add(cb); return () => fixture.messageListeners.delete(cb) },
    '~registerStatusCallback': () => () => {},
  }
  fixture.sessions = { a: { chat } }
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const element = create(tag, options)
    // Native playback remains real; mute keeps this automated check silent
    // and allows autoplay in an unattended browser.
    if (element instanceof HTMLAudioElement) element.muted = true
    return element
  })
  const view = render(<App />)
  await act(async () => { await userEvent.click(view.getByText('A: off (idle)')) })
  await waitFor(() => expect(view.getByText('A: on (ready)')).toBeTruthy())
  await act(async () => {
    chat.status = 'streaming'
    chat.messages = [
      { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Read' }] },
      { id: 'reply', role: 'assistant', parts: [{ type: 'text', text: 'First sentence. ' }] },
    ]
    fixture.messageListeners.forEach((cb) => cb())
  })
  await waitFor(() => expect(document.querySelector('audio')!.currentTime).toBeGreaterThan(0.1))
  const player = document.querySelector('audio')!
  const before = player.currentTime
  await act(async () => { await userEvent.click(view.getByText('Chat B')) })
  expect(view.getByText('B: on (speaking)')).toBeTruthy()
  await act(async () => { await userEvent.click(view.getByText('Settings')) })
  await act(async () => {
    chat.messages[1].parts[0].text += 'Background sentence.'
    fixture.messageListeners.forEach((cb) => cb())
  })
  await waitFor(() => expect(player.currentTime).toBeGreaterThan(before + 0.1))
  expect(document.querySelector('audio')).toBe(player)
  await act(async () => { await userEvent.click(view.getByText('Chat A')) })
  expect(view.getByText('A: on (speaking)')).toBeTruthy()
  expect(fixture.generate).toHaveBeenCalledTimes(2)
  await act(async () => { await userEvent.click(view.getByText('A: on (speaking)')) })
  await waitFor(() => expect(document.querySelector('audio')).toBeNull())
  expect(player.paused).toBe(true)
  await waitFor(() => expect(fixture.discard).toHaveBeenCalledTimes(2))
  expect(view.getByText('A: off (idle)')).toBeTruthy()
})
