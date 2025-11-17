import { NextResponse } from 'next/server'

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }

export async function POST(req: Request) {

  const body = await req.json()
  const {
    messages,
    model,
    temperature,
    top_p,
    top_k,
    max_tokens,
    stream,
    enable_search
  } = body as {
    messages: ChatMessage[]
    model: string
    temperature?: number
    top_p?: number
    top_k?: number
    max_tokens?: number
    stream?: boolean
    enable_search?: boolean
  }

  const usedModel = model || 'Baichuan-M2-Plus'
  const isBaichuan = usedModel.startsWith('Baichuan')
  const isDeepSeek = usedModel.toLowerCase().startsWith('deepseek')

  let apiKey: string | undefined
  if (isBaichuan) apiKey = process.env.BAICHUAN_API_KEY
  else if (isDeepSeek) apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({
        choices: [
          { message: { role: 'assistant', content: '開発モード: APIキー未設定のため簡易応答を返します。質問内容に合わせて参照を付けてください。' } }
        ]
      })
    }
    return NextResponse.json({ error: 'API key not set' }, { status: 500 })
  }

  let normalizedMessages = messages
  if (isBaichuan && usedModel === 'Baichuan-M2-Plus') {
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
    const ua = messages.filter(m => m.role === 'user' || m.role === 'assistant')
    if (sys) {
      const idx = ua.findIndex(m => m.role === 'user')
      if (idx >= 0) {
        ua[idx] = { role: 'user', content: sys + '\n\n' + ua[idx].content }
      } else {
        ua.unshift({ role: 'user', content: sys })
      }
    }
    normalizedMessages = ua
  }

  let payload: any
  if (isDeepSeek) {
    payload = {
      model: usedModel,
      messages: normalizedMessages,
      stream: !!stream,
      temperature: temperature ?? 0.2,
      top_p: top_p ?? 0.85,
      max_tokens: max_tokens ?? 1024
    }
  } else {
    payload = {
      model: usedModel,
      messages: normalizedMessages,
      stream: !!stream,
      temperature: temperature ?? 0.3,
      top_p: top_p ?? 0.85,
      top_k: top_k ?? 5,
      max_tokens: max_tokens ?? 1024
    }
  }

  if (enable_search && isBaichuan && usedModel !== 'Baichuan-M2-Plus') {
    payload.tools = [
      {
        type: 'web_search',
        web_search: { enable: true, search_mode: 'quality_first' }
      }
    ]
  }

  const endpoint = isDeepSeek ? 'https://api.deepseek.com/v1/chat/completions' : 'https://api.baichuan-ai.com/v1/chat/completions'
  let res: Response | null = null
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      })
      if (r.ok) { res = r; break }
      if (r.status >= 500) {
        await new Promise(resolve => setTimeout(resolve, (1 << i) * 200))
        continue
      }
      const text = await r.text()
      return NextResponse.json({ error: text || 'Upstream error' }, { status: r.status })
    } catch {
      await new Promise(resolve => setTimeout(resolve, (1 << i) * 200))
    }
  }
  if (!res) {
    return NextResponse.json({ error: 'Upstream unavailable' }, { status: 502 })
  }

  if (payload.stream) {
    const readable = res.body
    if (!readable) {
      const txt = await res.text()
      return new NextResponse(txt)
    }
    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })
  }

  const data = await res.json()
  return NextResponse.json(data)
}
