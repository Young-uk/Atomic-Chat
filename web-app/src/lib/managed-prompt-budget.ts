import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'

/** CPU-only counting of the exact wire body. No generation or KV mutation. */
export async function assertManagedPromptFits(baseUrl: string, body: string,
  fetcher: typeof fetch, signal?: AbortSignal): Promise<string> {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/atomic/prompt-token-count`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    signal,
  })
  if (!response.ok) throw new Error(`Exact prompt token counting failed (${response.status}); request not sent`)
  const count = await response.json()
  const values = [count.input_tokens, count.context_length, count.reserved_tokens]
  if (!values.every(value => Number.isSafeInteger(value) && value >= 0) || count.context_length < 1) {
    throw new Error('Exact prompt token counter returned an invalid budget; request not sent')
  }
  if (count.input_tokens >= count.context_length || count.input_tokens + count.reserved_tokens > count.context_length) {
    throw new Error(`${OUT_OF_CONTEXT_SIZE} Prompt has ${count.input_tokens} tokens plus ${count.reserved_tokens} reserved output tokens; context limit is ${count.context_length}`)
  }
  if (count.prepared_messages !== undefined) {
    if (!Array.isArray(count.prepared_messages)) throw new Error('Invalid prepared image messages; request not sent')
    return JSON.stringify({ ...JSON.parse(body), messages: count.prepared_messages })
  }
  return body
}
