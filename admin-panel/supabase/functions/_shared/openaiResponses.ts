// Bot adimlari (chatbotFlow.js) istegi chat/completions biciminde kurar ve
// cevabi o bicimde okur. gpt-6-luna fonksiyon + reasoning'i birlikte yalniz
// /v1/responses'ta kabul ediyor; burada istek oraya cevrilir, cevap da eski
// bicime geri donusturulur, boylece adimlar degismez.
type Json = Record<string, unknown>

export function toResponsesRequest(req: Json): Json {
  const messages = (req.messages ?? []) as { role: string; content: string }[]
  const tools = (req.tools ?? []) as { function: Json }[]
  return {
    model: req.model,
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    tools: tools.map((t) => ({ type: 'function', ...t.function })),
    tool_choice: req.tool_choice,
    ...(req.reasoning_effort ? { reasoning: { effort: req.reasoning_effort } } : {}),
    // sohbet gecmisi zaten bizim veritabaninda; OpenAI tarafinda saklanmasin
    store: false,
  }
}

export function fromResponsesResponse(res: Json): Json {
  const output = (res.output ?? []) as Json[]
  const text = output
    .filter((o) => o.type === 'message')
    .flatMap((o) => (o.content ?? []) as Json[])
    .filter((c) => c.type === 'output_text')
    .map((c) => String(c.text ?? ''))
    .join('')
  const calls = output.filter((o) => o.type === 'function_call')
  const message: Json = { role: 'assistant', content: text || null }
  if (calls.length) {
    message.tool_calls = calls.map((c) => ({ id: c.call_id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
  }
  const usage = (res.usage ?? {}) as Json
  return {
    choices: [{ message, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
    usage: {
      prompt_tokens: usage.input_tokens ?? 0,
      prompt_tokens_details: { cached_tokens: (usage.input_tokens_details as Json | undefined)?.cached_tokens ?? 0 },
      completion_tokens: usage.output_tokens ?? 0,
    },
  }
}
