import { NextResponse } from "next/server"

const CACHE_LIMIT = 200
const metaCache: Map<string, { originTitle?: string; translations?: Record<string, string | undefined>; doi?: string }> = new Map()
function putCache(key: string, value: { originTitle?: string; translations?: Record<string, string | undefined>; doi?: string }) {
  if (metaCache.has(key)) metaCache.delete(key)
  metaCache.set(key, value)
  if (metaCache.size > CACHE_LIMIT) {
    const first = metaCache.keys().next().value
    if (first) metaCache.delete(first)
  }
}

function decodeHtml(s: string) {
  return s
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim()
}

async function translateIfNeeded(text: string, targetLang?: string) {
  if (!text) return undefined
  if (!targetLang || targetLang === "en") return undefined
  const key = process.env.BAICHUAN_API_KEY
  if (!key) return undefined
  const payload: any = {
    model: "Baichuan-M2-Plus",
    messages: [
      { role: "system", content: "You are a translator. Output only the translated title without explanations." },
      { role: "user", content: `Translate the following title into ${targetLang}: \n\n${text}` }
    ],
    stream: false,
    temperature: 0.1,
    top_p: 0.8,
    top_k: 5,
    max_tokens: 128
  }
  try {
    const res = await fetch("https://api.baichuan-ai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload)
    })
    if (!res.ok) return undefined
    const data = await res.json()
    const txt = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.output_text ?? ""
    return (txt || "").trim()
  } catch {
    return undefined
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const url = String(body?.url || "")
    const targetLang = body?.targetLang as string | undefined
    if (!/^https?:\/\//.test(url)) return NextResponse.json({ error: "invalid url" }, { status: 400 })
    const cached = metaCache.get(url)
    if (cached) {
      let translatedTitle = cached.translations?.[targetLang || "en"]
      if (!translatedTitle && cached.originTitle) {
        translatedTitle = await translateIfNeeded(cached.originTitle || "", targetLang)
        const nextTranslations = { ...(cached.translations || {}) }
        nextTranslations[targetLang || "en"] = translatedTitle
        putCache(url, { originTitle: cached.originTitle, translations: nextTranslations, doi: cached.doi })
      }
      return NextResponse.json({ url, originTitle: cached.originTitle, translatedTitle, doi: cached.doi })
    }
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 7000)
    const res = await fetch(url, { method: "GET", signal: ctrl.signal })
    clearTimeout(to)
    if (!res.ok) return NextResponse.json({ url, originTitle: undefined, translatedTitle: undefined })
    const html = await res.text()
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const originTitle = m ? decodeHtml(m[1] || "") : undefined
    const doi = extractDoi(html)
    const translatedTitle = await translateIfNeeded(originTitle || "", targetLang)
    putCache(url, { originTitle, translations: { [targetLang || "en"]: translatedTitle }, doi })
    return NextResponse.json({ url, originTitle, translatedTitle, doi })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
function extractDoi(html: string) {
  const metas = [
    /<meta[^>]+name=["']citation_doi["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']dc\.identifier["'][^>]+content=["'](?:doi:)?\s*([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']doi["'][^>]+content=["']([^"']+)["'][^>]*>/i
  ]
  for (const re of metas) {
    const m = html.match(re)
    if (m && m[1]) return m[1].trim()
  }
  const reDoi = /(10\.\d{4,9}\/[\-._;()\/:A-Z0-9]+)/i
  const m2 = html.match(reDoi)
  if (m2 && m2[1]) return m2[1].trim()
  return undefined
}
