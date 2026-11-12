/** Native background banks accept text/JSON, not general tool execution. */
export async function completeBackground(params, { endpoint, model, fetcher = fetch }) {
  const emitter = params.tools?.[0]?.function
  const schema = emitter?.parameters
  const prompt = schema ? `${params.prompt}\nReturn only a JSON object matching these output fields (do not call tools): ${JSON.stringify(schema)}` : params.prompt
  const base = { model, atomic_summary:true, atomic_auxiliary:true, think:false, stream:false,
    temperature:1, max_tokens:params.maxTokens ?? 0, messages:[{ role:'user',content:prompt }],
    ...(schema ? { response_format:{ type:'json_schema',json_schema:{ name:emitter.name,schema } } } : params.reviewChannel ? { response_format:{type:'json_object'} } : {}) }
  const send = clone => fetcher(`${endpoint}/chat/completions`, { signal:params.signal,method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ ...base,...(clone ? {atomic_summary_clone:params.cacheOwner} : {}) }) })
  let response = await send(!!params.cacheOwner && endpoint.endsWith(':18080/v1'))
  if (!response.ok && response.status === 409 && params.cacheOwner) {
    const failure = await response.clone().json().catch(() => null)
    if (['atomic_summary_clone_stale','atomic_summary_headroom_exhausted','atomic_summary_admission_refused'].includes(failure?.error?.code)) response = await send(false)
  }
  if (!response.ok) throw new Error(`Background review inference failed: HTTP ${response.status}`)
  const result = await response.json(), choice = result.choices?.[0]
  if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('Background review did not complete; no changes saved')
  if (params.signal?.aborted) throw new Error('Background review interrupted')
  if (!schema) return { content:choice.message.content }
  const args = JSON.parse(choice.message.content)
  return { content:'',toolCalls:[{ id:'background-output',type:'function',function:{name:emitter.name,arguments:JSON.stringify(args)} }] }
}
