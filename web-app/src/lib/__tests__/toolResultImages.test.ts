import { describe, it, expect } from 'vitest'
import { convertToModelMessages } from 'ai'
import { completionReviewPartCount, TOOL_REVIEW_METADATA, withToolCompletionReviews } from '../tool-completion-review'
import { projectCompactedMessages } from '../dstar-context-compaction'
import { type UIMessage } from '@ai-sdk/react'

import { prepareToolResultImagesForModel } from '../toolResultImages'

const IMG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const toolMessageWithImage = (): UIMessage =>
  ({
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-get_viewport_screenshot',
        toolCallId: 'call_1',
        state: 'output-available',
        input: {},
        output: [
          { type: 'text', text: 'Screenshot taken' },
          { type: 'image', data: IMG_B64, mimeType: 'image/png' },
        ],
      },
    ],
  }) as unknown as UIMessage

const getToolOutput = (message: UIMessage): unknown[] => {
  const part = (message.parts as Array<Record<string, unknown>>)[0]
  return part.output as unknown[]
}

describe('prepareToolResultImagesForModel', () => {
  it('strips image base64 from tool output and replaces it with a text placeholder (non-vision)', () => {
    const [msg] = prepareToolResultImagesForModel([toolMessageWithImage()], {
      supportsVision: false,
    })

    const output = getToolOutput(msg)
    // No raw image block survives in the model-bound payload.
    expect(output.some((b) => (b as Record<string, unknown>).type === 'image')).toBe(false)
    // The original text block is preserved; the image becomes a placeholder.
    expect(output).toHaveLength(2)
    const placeholder = output[1] as { type: string; text: string }
    expect(placeholder.type).toBe('text')
    expect(placeholder.text).toContain('omitted')
    expect(JSON.stringify(output)).not.toContain(IMG_B64)
  })

  it('does NOT hoist a separate image message for non-vision models', () => {
    const result = prepareToolResultImagesForModel([toolMessageWithImage()], {
      supportsVision: false,
    })
    expect(result).toHaveLength(1)
  })

  it('hoists the image as an image_url user message for vision models', () => {
    const result = prepareToolResultImagesForModel([toolMessageWithImage()], {
      supportsVision: true,
    })

    expect(result).toHaveLength(2)
    const hoisted = result[1]
    expect(hoisted.role).toBe('user')

    const parts = hoisted.parts as Array<Record<string, unknown>>
    const filePart = parts.find((p) => p.type === 'file')
    expect(filePart).toBeDefined()
    expect(filePart?.mediaType).toBe('image/png')
    expect(String(filePart?.url)).toContain(IMG_B64)

    // The tool output itself still carries no raw image (only the placeholder).
    const output = getToolOutput(result[0])
    expect(output.some((b) => (b as Record<string, unknown>).type === 'image')).toBe(false)
  })

  it('leaves messages without tool-result images untouched (same reference)', () => {
    const plain = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
    } as unknown as UIMessage

    const result = prepareToolResultImagesForModel([plain], {
      supportsVision: true,
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(plain)
  })
})


it('keeps the model image prefix stable as the assistant continues and history is replayed', async () => {
  const first = toolMessageWithImage()
  const secondTool = { ...first.parts[0], toolCallId: 'call_2' }
  const completed = { ...first, parts: [...first.parts,
    { type: 'text', text: 'I can see the first screenshot.' }, secondTool,
    { type: 'text', text: 'Both screenshots are visible.' }] } as UIMessage
  const original = JSON.stringify(completed)
  const prepare = (message: UIMessage) => prepareToolResultImagesForModel([message], { supportsVision: true })
  const initial = prepare(first)
  const continued = prepare(completed)
  const initialWire = await convertToModelMessages(initial)
  const continuedWire = await convertToModelMessages(continued)
  expect(continuedWire.slice(0, initialWire.length)).toEqual(initialWire)
  expect(continued.map(message => message.role)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant'])
  expect(projectCompactedMessages([completed], continued)).toEqual(continued)
  expect(projectCompactedMessages([], continued)).toEqual([])
  expect(JSON.stringify(completed)).toBe(original)
  // Persisting the turn must not move either image past the final answer.
  expect(await convertToModelMessages(prepare(JSON.parse(original)))).toEqual(continuedWire)
})


it('preserves a completion-review boundary once when splitting image turns', () => {
  const message = toolMessageWithImage()
  const reviewed = { ...message,
    metadata: { [TOOL_REVIEW_METADATA]: { prefixParts: 2 } },
    parts: [...message.parts, { type: 'text', text: 'I will check more.' },
      { type: 'text', text: 'The remaining work is complete.' }],
  } as UIMessage
  const prepared = prepareToolResultImagesForModel([reviewed], { supportsVision: true })
  const expanded = withToolCompletionReviews(prepared)
  expect(expanded.filter(message => message.id.endsWith('-completion-review'))).toHaveLength(1)
  expect(expanded.map(message => message.parts.filter(part => part.type === 'text').map(part => part.text).join(' ')).at(-1))
    .toBe('The remaining work is complete.')
})


it('replays a reviewed screenshot continuation after the complete prior tool wave', async () => {
  const previous = toolMessageWithImage()
  const response = { id: 'current-step', role: 'assistant', parts: [
    { type: 'reasoning', text: 'Compare the screenshot.' },
    { type: 'text', text: 'The screen is unchanged.' },
  ] } as UIMessage
  const primary = { ...previous, parts: [...previous.parts, { type: 'step-start' }, ...response.parts] } as UIMessage
  const prepare = (messages: UIMessage[]) => withToolCompletionReviews(prepareToolResultImagesForModel(messages, { supportsVision: true }))
  const initialWire = await convertToModelMessages(prepare([primary]))
  const completed = { ...primary,
    metadata: { [TOOL_REVIEW_METADATA]: { prefixParts: completionReviewPartCount([previous], response) } },
    parts: [...primary.parts, { type: 'step-start' }, { type: 'text', text: 'Comparison is complete.' }],
  } as UIMessage
  const replayWire = await convertToModelMessages(prepare([completed]))
  expect(replayWire.slice(0, initialWire.length)).toEqual(initialWire)
  expect(completionReviewPartCount([previous], response)).toBe(3)
  expect(completionReviewPartCount([{ id: 'u', role: 'user', parts: [] }], response)).toBe(2)
})
