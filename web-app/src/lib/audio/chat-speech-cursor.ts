import type { UIMessage } from 'ai'
import type { SpeechSentence } from './chat-speech-queue'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

/** One cursor per live Chat, retained while its page is not mounted. */
export function createChatSpeechCursor() {
  let userId = ''
  const messagesRead = new Map<string, { text: string; offset: number; instruct?: string }>()

  return (messages: UIMessage[], status: string) => {
    const user = messages.findLast((message) => message.role === 'user')
    const last = messages.at(-1)
    const sentences: SpeechSentence[] = []
    let newTurn = false
    if (!user || !last) return { sentences, newTurn }
    if ((status === 'submitted' || status === 'streaming') && userId !== user.id) {
      userId = user.id
      messagesRead.clear()
      newTurn = true
    }
    // Loading a finished conversation, or enabling speech on one, never
    // replays history. Only a turn observed while it is running is eligible.
    if (userId !== user.id || last.role !== 'assistant' || status === 'submitted') {
      return { sentences, newTurn }
    }
    let position = messagesRead.get(last.id)
    if (!position) {
      position = { text: '', offset: 0 }
      messagesRead.set(last.id, position)
    }
    const text = last.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
    // Edits/regeneration must not replay a prefix that was already queued.
    if (!text.startsWith(position.text.slice(0, position.offset))) return { sentences, newTurn }
    position.text = text
    const remainder = text.slice(position.offset)
    const append = (chunk: string, flush: boolean) => {
      const segments = Array.from(segmenter.segment(chunk), ({ segment }) => segment)
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
    const markerStart = tail.lastIndexOf('[[')
    const incomplete = markerStart >= 0 && /^\[\[(?:voice:[^\]\n]*\]?|v(?:o(?:i(?:c(?:e)?)?)?)?)?$/i.test(tail.slice(markerStart))
      ? markerStart
      : tail.endsWith('[') ? tail.length - 1 : -1
    append(incomplete < 0 ? tail : tail.slice(0, incomplete), status !== 'streaming')
    return { sentences, newTurn }
  }
}
