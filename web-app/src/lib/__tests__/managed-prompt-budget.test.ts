import { describe, expect, it, vi } from 'vitest'
import { assertManagedPromptFits } from '../managed-prompt-budget'

describe('managed exact prompt preflight', () => {
  const body = JSON.stringify({ messages: [{ role: 'tool', content: 'large result' }], tools: [{ function: { name: 'read' } }], think: false })
  it('sends the unmodified final wire body to the selected engine', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ input_tokens: 66029, context_length: 131072, reserved_tokens: 1032 }))
    await expect(assertManagedPromptFits('http://127.0.0.1:18080/v1', body, fetcher)).resolves.toBe(body)
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:18080/v1/atomic/prompt-token-count', expect.objectContaining({ body }))
  })
  it('rejects the observed overflow including the output reserve', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ input_tokens: 66029, context_length: 65536, reserved_tokens: 1032 }))
    await expect(assertManagedPromptFits('http://local/v1', body, fetcher)).rejects.toThrow('exceeds the available context size')
  })
  it.each([Response.json({}, { status: 404 }), Response.json({ input_tokens: -1, context_length: 65536, reserved_tokens: 8 }), Response.json({ input_tokens: 12, context_length: 0, reserved_tokens: 8 })])('does not substitute a heuristic on unavailable/invalid counts', async response => {
    await expect(assertManagedPromptFits('http://local/v1', body, vi.fn().mockResolvedValue(response))).rejects.toThrow('request not sent')
  })
  it('uses immutable prepared image bytes for generation without dropping other fields', async () => {
    const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,fixed' } }] }]
    const fetcher = vi.fn().mockResolvedValue(Response.json({ input_tokens: 90, context_length: 65536, reserved_tokens: 1032, prepared_messages: messages }))
    const prepared = await assertManagedPromptFits('http://local/v1', JSON.stringify({ model: 'model', messages: [], think: false }), fetcher)
    expect(JSON.parse(prepared)).toEqual({ model: 'model', messages, think: false })
  })

})
