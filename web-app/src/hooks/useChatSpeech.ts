import { useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { toast } from 'sonner'
import { getServiceHub } from '@/hooks/useServiceHub'
import {
  audioWireId,
  isAudioQuantOnDisk,
  buildAudioLoadRequest,
  QWEN_CHAT_TTS_MODEL,
  QWEN_CHAT_TTS_VOICE,
} from '@/lib/audio/models'
import { toAudioError } from '@/lib/audio/errors'
import { readFileBytes } from '@/lib/readFileBytes'
import { MAX_BLOB_CLIP_BYTES } from '@/lib/video/webview-playback'
import { fetchAudioCatalog, findAudioModel } from '@/services/audio-catalog-registry'

type SpeechSentence = { text: string; instruct?: string }

function createSpeechQueue(
  setReady: (ready: boolean) => void,
  setSpeaking: (speaking: boolean) => void
) {
  const audio = getServiceHub().audio()
  const pending: SpeechSentence[] = []
  const clips: Awaited<ReturnType<typeof readFileBytes>>[] = []
  const controller = new AbortController()
  const { signal } = controller
  let generating = false
  let playing = false
  let cancelActive: (() => Promise<unknown>) | undefined

  let modelId: string | undefined
  let preparing: Promise<void> | undefined
  const unsubscribe = audio.subscribe((event) => {
    if (event.type === 'state' && modelId && !signal.aborted) {
      setReady(event.status.model.state === 'loaded' && event.status.model.loaded?.modelId === modelId)
    }
  })

  async function prepareModel() {
    const { catalog } = await fetchAudioCatalog()
    const model = findAudioModel(catalog, QWEN_CHAT_TTS_MODEL)
    const files = await audio.listModelFiles()
    const quant = model?.quants.find((q) =>
      isAudioQuantOnDisk(q, files)
    )
    if (!model || !quant) throw new Error('Install Qwen3-TTS in Audios to read replies aloud.')
    const status = await audio.getStatus()
    signal.throwIfAborted()
    modelId = audioWireId(model, quant)
    if (status.activeJob) throw new Error('Audio generation is already in progress.')
    if (status.model.loaded?.modelId !== modelId) {
      await audio.loadModel(buildAudioLoadRequest(model, quant))
    }
    signal.throwIfAborted()
    setReady(true)
  }

  function prepare() {
    return preparing ??= prepareModel().finally(() => { preparing = undefined })
  }

  async function synthesize(sentence: SpeechSentence) {
    await prepare()
    signal.throwIfAborted()
    let job = await audio.generate('speech', { ...sentence, voice: QWEN_CHAT_TTS_VOICE, transient: true })
    const id = job.id
    let cancellation: Promise<unknown> | undefined
    cancelActive = () => cancellation ??= audio.cancelJob(id).catch(() => {})
    try {
      while (!signal.aborted && (job.state === 'queued' || job.state === 'generating')) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        const latest = await audio.getJob(job.id)
        if (!latest) throw new Error('Speech generation was interrupted.')
        job = latest
      }
      signal.throwIfAborted()
      cancelActive = undefined
      if (!job.output) throw job.error ?? new Error('Speech generation produced no audio.')
      return await readFileBytes(job.output.path, { maxBytes: MAX_BLOB_CLIP_BYTES })
    } finally {
      if (signal.aborted && !job.output) {
        await cancelActive?.()
        job = (await audio.getJob(job.id).catch(() => null)) ?? job
      }
      cancelActive = undefined
      if (job.output) await audio.deleteGalleryItem(job.id).catch(console.warn)
    }
  }

  function stop() {
    if (signal.aborted) return
    controller.abort()
    unsubscribe()
    setSpeaking(false)
    setReady(false)
    pending.length = 0
    clips.length = 0
    void cancelActive?.()
  }

  function fail(stage: 'synthesis' | 'playback', error: unknown) {
    if (signal.aborted) return
    stop()
    console.warn('[chat-speech] Failed during', stage)
    toast.error('Could not read the reply aloud', {
      description: `${stage === 'synthesis' ? 'Speech synthesis' : 'Audio playback'}: ${toAudioError(error).message}`,
    })
  }

  async function generateClips() {
    if (generating || signal.aborted) return
    generating = true
    try {
      while (pending.length && !signal.aborted) {
        const clip = await synthesize(pending.shift()!)
        if (signal.aborted) return
        clips.push(clip)
        void playClips()
      }
    } catch (error) {
      fail('synthesis', error)
    } finally {
      generating = false
    }
  }

  async function playClips() {
    if (playing || signal.aborted) return
    playing = true
    try {
      while (clips.length && !signal.aborted) {
        const { bytes } = clips.shift()!
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
        const player = new Audio(url)
        let finishPlayback: (() => void) | undefined
        try {
          await new Promise<void>((resolve, reject) => {
            player.onplaying = () => { if (!signal.aborted) setSpeaking(true) }
            player.onwaiting = () => { if (!signal.aborted) setSpeaking(false) }
            player.onended = () => resolve()
            player.onerror = () => reject(new Error('Could not play the generated speech.'))
            finishPlayback = () => resolve()
            signal.addEventListener('abort', finishPlayback, { once: true })
            void player.play().catch(reject)
          })
        } finally {
          if (finishPlayback) signal.removeEventListener('abort', finishPlayback)
          if (!signal.aborted) setSpeaking(false)
          player.pause()
          URL.revokeObjectURL(url)
        }
      }
    } catch (error) {
      fail('playback', error)
    } finally {
      playing = false
    }
  }

  return {
    enqueue(sentences: SpeechSentence[]) {
      pending.push(...sentences.filter(({ text }) => /[\p{L}\p{N}]/u.test(text)))
      void generateClips()
    },
    prepare,
    stop,
    get stopped() { return signal.aborted },
  }
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

export function useChatSpeech(
  threadId: string,
  messages: UIMessage[],
  status: string,
  enabled: boolean
) {
  const [ready, setReady] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const queue = useRef<ReturnType<typeof createSpeechQueue> | null>(null)
  const cursor = useRef({ user: '', message: '', text: '', offset: 0, instruct: undefined as string | undefined })

  useEffect(() => {
    if (!enabled) return
    cursor.current = { user: '', message: '', text: '', offset: 0, instruct: undefined as string | undefined }
    const speech = createSpeechQueue(setReady, setSpeaking)
    queue.current = speech
    void speech.prepare().catch(() => {})
    return () => {
      queue.current?.stop()
      queue.current = null
    }
  }, [enabled, threadId])

  useEffect(() => {
    let speech = queue.current
    if (!speech) return
    const user = messages.findLast((message) => message.role === 'user')
    const last = messages.at(-1)
    const position = cursor.current
    if (!user || !last) return
    if (status === 'submitted' || status === 'streaming') {
      if (position.user !== user.id) {
        if (speech.stopped) speech = queue.current = createSpeechQueue(setReady, setSpeaking)
        Object.assign(position, { user: user.id, message: '', text: '', offset: 0, instruct: undefined as string | undefined })
      }
    }
    if (position.user !== user.id || last.role !== 'assistant') return
    if (status === 'submitted') return
    const text = last.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
    if (position.message !== last.id) {
      Object.assign(position, { message: last.id, text: '', offset: 0, instruct: undefined as string | undefined })
    }
    if (!text.startsWith(position.text.slice(0, position.offset))) return
    position.text = text
    const remainder = text.slice(position.offset)
    const sentences: SpeechSentence[] = []
    const append = (chunk: string, flush: boolean) => {
      const segments = Array.from(segmenter.segment(chunk), ({ segment }) => segment)
      // Keep the unfinished tail until a sentence boundary or the end of the reply.
      if (!flush && !/[.!?。！？][\s\u2019\u201d"')\]]*$/u.test(chunk)) segments.pop()
      for (const segment of segments) {
        sentences.push({ text: segment.trim(), instruct: position.instruct })
        position.offset += segment.length
      }
    }
    let start = 0
    for (const marker of remainder.matchAll(/\[\[voice:([^\]\n]*)\]\]/gi)) {
      append(remainder.slice(start, marker.index), true)
      position.instruct = marker[1].trim().slice(0, 120) || undefined
      position.offset += marker[0].length
      start = marker.index + marker[0].length
    }
    const tail = remainder.slice(start)
    const partial = tail.lastIndexOf('[')
    const markerStart = tail.lastIndexOf('[[')
    const incomplete = markerStart >= 0 && /^\[\[(?:voice:[^\]\n]*\]?|v(?:o(?:i(?:c(?:e)?)?)?)?)?$/i.test(tail.slice(markerStart))
      ? markerStart
      : tail.endsWith('[') ? partial : -1
    append(incomplete < 0 ? tail : tail.slice(0, incomplete), status !== 'streaming')
    speech.enqueue(sentences)

  }, [enabled, messages, status, threadId])

  return enabled && speaking ? 'speaking' : enabled && ready ? 'ready' : 'idle'
}
