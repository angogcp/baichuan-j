"use client"
import { useEffect, useMemo, useRef, useState } from "react"

type Role = "system" | "user" | "assistant"
type Msg = { role: Role; content: string }

function formatPlain(content: string) {
  let s = content || ""
  s = s.replace(/```[\s\S]*?```/g, "")
  s = s.replace(/`([^`]*)`/g, "$1")
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1")
  s = s.replace(/\*([^*]+)\*/g, "$1")
  s = s.replace(/_([^_]+)_/g, "$1")
  s = s.replace(/\^(\d+)\^/g, "[$1]")
  s = s.replace(/^#{1,6}\s*/gm, "")
  s = s.replace(/^\s*>+\s?/gm, "")
  s = s.replace(/^\s*[-*+]\s+/gm, "• ")
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
  s = s.replace(/\n{3,}/g, "\n\n")
  return s.trim()
}

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s<>()\[\]{}"']+/g) || []
  const cleaned = matches.map(sanitizeUrl).filter((u): u is string => !!u)
  return Array.from(new Set(cleaned))
}

function renderWithLinks(text: string, msgIndex?: number, urls?: string[]) {
  const parts: (string | JSX.Element)[] = []
  const re = /(https?:\/\/[^\s<>()\[\]{}"']+|\[\d+\])/g
  let i = 0
  let last = 0
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (start > last) parts.push(text.slice(last, start))
    const token = m[0]
    if (token.startsWith("http")) {
      const u = sanitizeUrl(token)
      if (u) parts.push(<a key={`link-${i++}`} href={u} target="_blank" rel="noopener noreferrer">{u}</a>)
      else parts.push(token)
    } else {
      const num = token.replace(/[^0-9]/g, "")
      const idx = Math.max(0, parseInt(num) - 1)
      const targetUrl = urls && urls[idx] ? urls[idx] : null
      if (targetUrl) {
        parts.push(<a key={`ref-${i++}`} href={targetUrl} target="_blank" rel="noopener noreferrer">{`[${num}]`}</a>)
      } else {
        const anchor = `#ref-${msgIndex ?? 0}-${num}`
        parts.push(<a key={`ref-${i++}`} href={anchor}>{`[${num}]`}</a>)
      }
    }
    last = end
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function validateSections(content: string, lang: string, audience: string) {
  const t = content || ""
  let checks: string[]
  if (audience === "patient") {
    checks = lang === "zh"
      ? ["摘要|要点", "今天|立刻|现在", "一周|7天|计划", "家庭|自测|监测|记录", "就诊|门诊", "紧急|急诊|呼救", "向医生|问题", "参考|参考文献|出典"]
      : ["要約|まとめ", "今すぐ|今日", "1週間|七日|プラン", "家庭血圧|家庭測定|記録", "受診の目安|外来", "緊急受診|救急|119", "医師へ伝える|質問", "出典|参考文献"]
  } else {
    checks = lang === "zh"
      ? ["病因", "生活方式", "药物", "特殊人群", "目标", "监测", "新兴疗法", "参考文献"]
      : ["要約|機序|病因", "生活|ライフスタイル", "薬物|薬物療法", "特定集団|併存症", "目標|ターゲット", "モニタ|監視|監測", "新規治療|新興療法|技術", "出典|参考文献"]
  }
  const missing: string[] = []
  for (const k of checks) {
    const re = new RegExp(k, "i")
    if (!re.test(t)) missing.push(k)
  }
  return missing
}

function sanitizeUrl(u: string) {
  let x = u.trim()
  x = x.replace(/[\u200b\u200c\u200d\ufeff\u00A0]/g, "")
  x = x.replace(/[)\]\}>"'、，。；：！？]+$/u, "")
  x = x.replace(/\^\d+\^$/, "")
  x = x.replace(/\.+$/u, "")
  if (!/^https?:\/\//.test(x)) return null
  try { new URL(x) } catch { return null }
  return x
}

function detectLang(t: string) {
  if (/[\u3040-\u30FF]/.test(t)) return "ja"
  if (/[\uAC00-\uD7AF]/.test(t)) return "ko"
  if (/[\p{Script=Han}]/u.test(t)) return "zh"
  return "en"
}

function pickContent(data: any) {
  if (!data) return ""
  const c = data?.choices?.[0] || {}
  const s = c?.message?.content ?? c?.delta?.content ?? c?.text ?? data?.output_text ?? data?.data ?? data?.output ?? data?.content ?? data?.message ?? data?.result ?? data?.response ?? data?.thinking?.output ?? data?.thinking?.summary
  if (typeof s === "string" && s.trim()) return s.trim()
  return ""
}

function localFallbackFor(q: string) {
  const t = q || ""
  if (/[高血圧|血圧]/.test(t)) {
    return "要点:\n- 生活: 減塩(5g/日目安)、適正体重、禁煙、節酒、有酸素運動150分/週\n- 食事: DASH食\n- 家庭血圧: 朝晩の測定と記録\n- 薬物療法: ACEI/ARB・CCB・利尿薬などを個別に調整\n- 受診目安: 診察室血圧\u2265140/90mmHgや症状時\n\n出典: https://www.jpnsh.jp/data/jsh2019.pdf https://www.jpnsh.jp/general/"
  }
  if (/[血糖|糖尿病|HbA1c]/i.test(t)) {
    return "要点:\n- 食事: 炭水化物・脂質の質を改善し、野菜・全粒穀物を増やす\n- 活動: 週150分以上の中等度運動\n- 体重管理: 5–10%減量を目標\n- 目標: HbA1cは個別設定、低血糖回避\n- 薬物療法: メトホルミン等を個別に選択\n\n出典: https://www.jds.or.jp/modules/publication/index.php?content_id=3 https://www.who.int/news-room/fact-sheets/detail/diabetes"
  }
  return "要点:\n- 生活習慣の調整と定期的な自己管理\n- 症状や高リスク時は速やかに受診\n\n出典: https://www.mhlw.go.jp/ https://www.who.int/"
}

function buildSystemJA(q: string) {
  const base = [
    "あなたは臨床ガイドラインに基づき日本語のみで回答する医療アシスタントです。",
    "出力構成: 1) 要約 2) 推奨事項（具体的数値を含む箇条書き） 3) 注意・禁忌 4) 受診目安 5) 参照。",
    "要件: 真偽一貫性、曖昧な点は『不確実』と明記。参照は質問に直接関連する一次資料（ガイドライン、学会声明、政府・公的機関、系統的レビュー）に限定。",
    "参照表記: 各項目にタイトル（可能なら日本語、原題も併記）とURLを含め、本文の [n] と対応付ける。"
  ].join(" ")
  if (/高血圧|血圧/i.test(q)) {
    const src = "日本高血圧学会(JSH)ガイドライン2019、JSH一般向け情報、WHO高血圧ファクトシートを優先。"
    return `${base} 対象: 高血圧。引用は ${src}`
  }
  if (/糖尿病|血糖|HbA1c/i.test(q)) {
    const src = "日本糖尿病学会(JDS)ガイドライン・診療指針、厚労省、WHO糖尿病ファクトシートを優先。"
    return `${base} 対象: 糖尿病/血糖管理。引用は ${src}`
  }
  return base
}

function buildSystemZH(q: string) {
  const base = [
    "你是一名依据临床指南进行解答的医疗助手，仅用中文输出。",
    "输出结构：1) 要点总结 2) 建议（含具体数值的要点） 3) 注意与禁忌 4) 就诊指征 5) 参考文献。",
    "要求：保证事实一致；不确定处明确标注为不确定。参考文献仅限与问题直接相关的一次资料（指南、学会声明、政府/公立机构、系统综述）。",
    "参考标注：每个要点至少对应一个编号 [n]，并给出标题（如可则中文并附原题）与URL。"
  ].join(" ")
  if (/高血压|血压/i.test(q)) {
    const src = "优先使用日本高血压学会指南、WHO资料以及权威政府网站。"
    return `${base} 对象：高血压。引用以 ${src}`
  }
  if (/糖尿病|血糖|HbA1c/i.test(q)) {
    const src = "优先使用日本糖尿病学会指南、国家/WHO资料。"
    return `${base} 对象：糖尿病/血糖管理。引用以 ${src}`
  }
  return base
}

function buildQualityPromptZH() {
  return [
    "你是一名医学顾问和临床研究助理，擅长根据最新的国际医学指南和系统综述提供循证医学回答。",
    "当用户提出某种疾病或健康管理相关的问题时，请按以下要求输出：",
    "1) 全面而结构化地回答：病因/机制简述、生活方式干预、药物治疗、特殊人群或合并症、目标值与监测方式、新兴疗法或技术、参考文献。",
    "2) 基于最新临床证据（2023–2025），优先引用：ESC/ESH、ACC/AHA、JNC、WHO 等指南；PubMed 或 ScienceDirect 收录的近三年系统综述/Meta；高质量期刊（Ann Med、Eur J Prev Cardiol、JAMA、NEJM 等）。",
    "3) 语气清晰、专业、客观，避免主观建议或替代临床诊疗。",
    "4) 以医生对同行或患者的解释方式表达，条理清晰、循证、非广告化。",
    "5) 在结尾提醒：治疗方案应结合个体情况，并建议查阅最新指南或咨询医生。",
    "6) 若可能，提供带 DOI 的引用格式。"
  ].join(" ")
}

function buildQualityPromptJA() {
  return [
    "あなたは医学顧問かつ臨床研究アシスタントです。最新の国際ガイドラインとシステマティックレビューに基づき、根拠に裏付けられた回答を作成します。",
    "疾患や健康管理に関する質問には次の要件で出力してください：",
    "1) 構造化回答：病因/機序の要約、生活習慣介入、薬物療法、特定集団や併存症への対応、目標値とモニタリング、新規治療/技術、参考文献。",
    "2) 最新の臨床エビデンス（2023–2025）を優先し、ESC/ESH・ACC/AHA・JNC・WHOのガイドライン、近3年のシステマティックレビュー/メタ解析（PubMed/ScienceDirect収載）、質の高い誌（Ann Med、Eur J Prev Cardiol、JAMA、NEJMなど）を引用。",
    "3) 語調は明瞭・専門的・客観的で、主観的助言や診療の代替を避ける。",
    "4) 医師が同僚や患者に説明する体裁で、条理的・根拠提示・非広告的にまとめる。",
    "5) 結語で個別性への配慮と最新ガイドライン参照・受診の推奨を明記。",
    "6) 可能なら DOI を付した引用形式を示す。"
  ].join(" ")
}

function buildPatientPromptJA() {
  return [
    "患者向けモード: 出力は『すぐ役立つ行動計画』として作成する。",
    "構成: 0) 一文要約、1) 今すぐできること（今日）、2) 1週間プラン（チェックリスト）、3) 家庭での測定・記録方法（時間帯・回数・しきい値）、4) 受診の目安（通常外来）、5) 緊急受診のサイン（119/救急コールの基準）、6) 医師へ伝えること・質問テンプレート、7) 出典。",
    "表現は中学生にも分かる平易さで、数値や具体例を付す。薬の開始・中止の指示は行わず、注意喚起に留める。個人差や既往症への配慮を明記する。"
  ].join(" ")
}

function buildPatientPromptZH() {
  return [
    "患者模式：把输出写成‘立刻可执行的行动计划’。",
    "结构：0) 一句话摘要，1) 今天立刻可做，2) 一周计划（清单），3) 家庭测量与记录方法（时间段/次数/阈值），4) 普通门诊就诊指征，5) 紧急就医信号（急救呼叫的标准），6) 告知医生与提问模板，7) 参考文献。",
    "语言通俗、提供具体数值与例子；不下药物启动/停用指令，仅给风险提示，并声明需个体化。"
  ].join(" ")
}

function ensureForAudience(text: string, q: string, lang: string, audience: string) {
  if (audience !== "patient") return text
  const miss = validateSections(text, lang, audience)
  if (miss.length < 4) return text
  if (/高血圧|血圧|降圧/i.test(q) || /高血圧|血圧|降圧/i.test(text)) {
    if (lang === "zh") return buildPatientPlanZH(q)
    return buildPatientPlanJA(q)
  }
  if (/糖尿病|血糖|HbA1c/i.test(q) || /糖尿病|血糖|HbA1c/i.test(text)) {
    if (lang === "zh") return buildPatientPlanZH(q)
    return buildPatientPlanJA(q)
  }
  if (lang === "zh") return buildPatientPlanZH(q)
  return buildPatientPlanJA(q)
}

function buildPatientPlanJA(q: string) {
  const hasStroke = /脳出血|脳卒中|麻痺/.test(q)
  const sum = hasStroke ? "高血圧の管理を強化し、再発予防と日常の安全を両立する。" : "高血圧の管理を今日から始めるための行動計画。"
  return [
    `要約: ${sum}`,
    "今すぐ今日:",
    "- 減塩開始（1日5g目安）。加工食品を避け、調味料は控えめ",
    "- 家庭血圧を朝晩で測定。測定前1分安静、腕帯は上腕、同じ腕で",
    "- 服薬は自己判断で増減しない。飲み忘れ防止の仕組みを作る",
    hasStroke ? "- 片麻痺のある側の転倒予防。歩行補助具・手すりを確認" : "- 有酸素運動の準備（散歩10–20分）",
    "1週間プラン:",
    "- 食事記録を付け、塩分の多い食品を把握して置き換え",
    "- 週150分の有酸素運動を分割（例: 20–30分×5回）",
    "- 体重・飲酒量・喫煙の状況を記録し、減量や禁煙を計画",
    hasStroke ? "- リハビリの継続内容を見直し、疲労や痛みの自己管理を加える" : "- 就寝前のストレッチと睡眠の見直し",
    "家庭での測定・記録:",
    "- 朝起床後1時間以内と就寝前に測定。各2回、間隔1分で平均",
    "- 家庭血圧の目安は135/85未満。超える日が続く時は記録を持参",
    "- 塩分・運動・睡眠と一緒にメモ（因子と血圧の関係が分かる）",
    "受診の目安（通常外来）:",
    "- 家庭血圧が1–2週間平均で135/85以上",
    "- 頭痛・動悸・息切れ・むくみなどの症状が持続",
    "- 服薬の副作用が疑われる（めまい、咳、むくみなど）",
    "緊急受診のサイン:",
    "- 片側の脱力・しびれ、ろれつが回らない、急な視力低下、激しい頭痛",
    "- 胸痛・呼吸困難・意識障害。迷ったら119へ",
    "医師へ伝える・質問:",
    "- 家庭血圧の記録、服薬リスト、症状の有無、塩分・運動・睡眠の状況",
    "- 目標値の調整（既往や腎機能に合わせた厳格度）について相談",
    "出典: [1] https://www.jpnsh.jp/general/ [2] https://www.who.int/news-room/fact-sheets/detail/hypertension"
  ].join("\n")
}

function buildPatientPlanZH(q: string) {
  return [
    "摘要: 从今天开始把血压管理做到位，兼顾安全与可持续。",
    "今天立刻:",
    "- 减盐（≤5g/日），减少加工食品",
    "- 早晚测量家庭血压（上臂袖带，静坐1分钟后测）",
    "- 不自行加减药，建立提醒机制",
    "一周计划:",
    "- 记录饮食，替换高盐食物；累计150分钟中等强度运动",
    "- 体重/饮酒/吸烟记录并设定目标",
    "家庭测量与记录:",
    "- 早晚各测2次取均值；目标135/85以下",
    "门诊就诊:",
    "- 1–2周平均≥135/85或症状持续",
    "紧急就医信号:",
    "- 单侧无力/言语不清/视力骤降/剧烈头痛；胸痛/呼吸困难/意识障碍",
    "告知医生与提问:",
    "- 家庭血压记录、用药清单、症状、饮食运动睡眠状况",
    "出典: [1] https://www.jpnsh.jp/general/ [2] https://www.who.int/news-room/fact-sheets/detail/hypertension"
  ].join("\n")
}

export default function Page() {
  const FIXED_MODEL = "Baichuan-M2-Plus"
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [system, setSystem] = useState("")
  const [temperature, setTemperature] = useState(0.2)
  const [topP, setTopP] = useState(0.85)
  const [topK, setTopK] = useState(5)
  const [maxTokens, setMaxTokens] = useState(1800)
  const [stream, setStream] = useState(true)
  const [enableSearch, setEnableSearch] = useState(false)
  const [showCitations, setShowCitations] = useState(true)
  const [detailed, setDetailed] = useState(true)
  const [loading, setLoading] = useState(false)
  const chatRef = useRef<HTMLDivElement | null>(null)
  const [userLang, setUserLang] = useState<string>("ja")
  const [metaMap, setMetaMap] = useState<Record<string, { originTitle?: string; translatedTitle?: string; doi?: string }>>({})
  const [model, setModel] = useState<string>("Baichuan-M2-Plus")
  const [audience, setAudience] = useState<string>("patient")
  const [filterType, setFilterType] = useState<string>("All")
  const [filterYearMin, setFilterYearMin] = useState<number>(2023)

  const fullMessages = useMemo(() => {
    const list: Msg[] = []
    if (system.trim()) list.push({ role: "system", content: system })
    const sys1 = userLang === "zh"
      ? "仅用中文输出，并按 1) 要点总结 2) 建议（要点式，含具体数值） 3) 注意与禁忌 4) 就诊指征 5) 参考文献 的结构；参考需与问题直接相关，尽可能使用中文可读的指南或公立机构资料。各部分至少提供2条一次资料，并给出标题（附原题）与URL，用编号 [n] 与正文对应。"
      : "すべての回答は日本語のみで出力してください。以下の構成で簡潔かつ正確に提示してください: 1) 要約、2) 推奨事項（箇条書き）、3) 注意点・禁忌、4) 受診目安、5) 出典。出典は質問内容に直接関連し、可能なら日本語のガイドラインや公的機関の資料を優先し、各項目に最低2件の参照を付し、タイトル（原題併記）とURLを含め、番号付き [n] で本文と対応させてください。"
    list.push({ role: "system", content: sys1 })
    const qual = userLang === "zh" ? buildQualityPromptZH() : buildQualityPromptJA()
    list.push({ role: "system", content: qual })
    if (audience === "patient") {
      const tone = userLang === "zh"
        ? "请用通俗易懂、非术语的方式解释重点，避免复杂药物细节，突出生活方式与就诊指征。"
        : "専門用語を避け、平易な表現で要点を説明し、薬剤の細かい指示は控え、生活習慣と受診目安を強調してください。"
      list.push({ role: "system", content: tone })
      const patient = userLang === "zh" ? buildPatientPromptZH() : buildPatientPromptJA()
      list.push({ role: "system", content: patient })
    }
    if (showCitations) {
      const sys2 = userLang === "zh"
        ? "参考文献必须为高质量一次资料（指南、学会声明、系统综述、政府/公立机构）。禁止不相关的一般网页。每部分至少2条引用。"
        : "引用は質の高い一次資料（ガイドライン、学会声明、系統的レビュー、政府・公的機関）を優先し、質問に直接関連しない一般ページは避けてください。各項目に最低2件の参照を付してください。"
      list.push({ role: "system", content: sys2 })
    }
    return [...list, ...messages]
  }, [messages, system, showCitations, userLang, audience])

  useEffect(() => {
    const saved = localStorage.getItem("bj_chat")
    if (saved) {
      const data = JSON.parse(saved)
      setMessages(data.messages ?? [])
      setSystem(data.system ?? "")
      setTemperature(data.temperature ?? 0.3)
      setTopP(data.topP ?? 0.85)
      setTopK(data.topK ?? 5)
      setMaxTokens(data.maxTokens ?? 1024)
      setStream(!!data.stream)
      setEnableSearch(!!data.enableSearch)
      setShowCitations(data.showCitations ?? true)
      setModel(data.model ?? "Baichuan-M2-Plus")
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(
      "bj_chat",
      JSON.stringify({ model, messages, system, temperature, topP, topK, maxTokens, stream, enableSearch, showCitations })
    )
  }, [messages, system, temperature, topP, topK, maxTokens, stream, enableSearch, showCitations, model])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, loading])

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return
    const urls = extractUrls(last.content)
    urls.forEach(async (u) => {
      if (metaMap[u]) return
      try {
        const res = await fetch("/api/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u, targetLang: userLang }) })
        const data = await res.json()
        setMetaMap(prev => ({ ...prev, [u]: { originTitle: data?.originTitle || undefined, translatedTitle: data?.translatedTitle || undefined, doi: data?.doi || undefined } }))
      } catch {}
    })
  }, [messages, userLang])

  async function send() {
    if (!input.trim()) return
    setUserLang(detectLang(input))
    if (!system.trim()) {
      const lang = detectLang(input)
      const auto = lang === "zh" ? buildSystemZH(input) : buildSystemJA(input)
      setSystem(auto)
    }
    const next = [...messages, { role: "user", content: input }]
    setMessages(next)
    setInput("")
    setLoading(true)
    try {
      if (stream) {
        const ctrl = new AbortController()
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [...fullMessages, { role: "user", content: input }], model, temperature: detailed ? Math.min(temperature, 0.15) : temperature, top_p: topP, top_k: topK, max_tokens: detailed ? Math.max(maxTokens, 1800) : maxTokens, stream, enable_search: enableSearch }),
          signal: ctrl.signal
        })
        const reader = res.body?.getReader()
        let acc = ""
        const assistantMsg: Msg = { role: "assistant", content: "" }
        setMessages(prev => [...prev, assistantMsg])
        let received = false
        const timeout = setTimeout(() => {
          if (!received) ctrl.abort()
        }, 15000)
        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = new TextDecoder().decode(value)
            acc += chunk
            const parts = acc.split("\n")
            acc = parts.pop() ?? ""
            for (const p of parts) {
              const line = p.trim()
              if (!line.startsWith("data:")) continue
              const json = line.slice(5).trim()
              if (json === "[DONE]") continue
              try {
                const obj = JSON.parse(json)
                const delta = obj?.choices?.[0]?.delta?.content ?? obj?.choices?.[0]?.message?.content ?? obj?.output_text ?? obj?.text ?? ""
                if (delta) {
                  received = true
                  setMessages(prev => {
                    const updated = [...prev]
                    const lastIndex = updated.length - 1
                    updated[lastIndex] = { role: "assistant", content: updated[lastIndex].content + delta }
                    return updated
                  })
                }
              } catch {}
            }
          }
          clearTimeout(timeout)
        }
        if (!received) {
          const res2 = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: fullMessages.concat({ role: "user", content: next[next.length - 1].content }), model, temperature: detailed ? Math.min(temperature, 0.15) : temperature, top_p: topP, top_k: topK, max_tokens: detailed ? Math.max(maxTokens, 1800) : maxTokens, stream: false, enable_search: enableSearch })
          })
          const data2 = await res2.json()
          const content2 = data2?.error ? `エラー: ${data2.error}` : pickContent(data2)
          setMessages(prev => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            updated[lastIndex] = { role: "assistant", content: content2 || localFallbackFor(next[next.length - 1].content) }
            return updated
          })
        }
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: fullMessages.concat({ role: "user", content: next[next.length - 1].content }), model, temperature: detailed ? Math.min(temperature, 0.15) : temperature, top_p: topP, top_k: topK, max_tokens: detailed ? Math.max(maxTokens, 1800) : maxTokens, stream, enable_search: enableSearch })
        })
        const data = await res.json()
        const content = data?.error ? `エラー: ${data.error}` : pickContent(data)
        setMessages(prev => [...prev, { role: "assistant", content: content || localFallbackFor(next[next.length - 1].content) }])
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "エラーが発生しました" }])
    } finally {
      setLoading(false)
    }
  }

  function hyperlinkRefs(text: string, urls: string[]) {
    const re = /\[(\d+)\]/g
    return text.replace(re, (_, n) => {
      const idx = Math.max(0, parseInt(n) - 1)
      const u = urls[idx]
      return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">[${n}]</a>` : `[${n}]`
    })
  }

  function classifyType(host: string, title: string) {
    const h = host.toLowerCase()
    const t = (title || "").toLowerCase()
    if (/(jpnsh\.jp|escardio\.org|acc\.org)/.test(h)) return "Guideline"
    if (/(who\.int|nih\.gov|mhlw\.go\.jp|cdc\.gov)/.test(h)) return "Agency"
    if (/(jamanetwork\.com|nejm\.org|sciencedirect\.com)/.test(h)) return /meta|systematic/.test(t) ? "Meta" : "Journal"
    if (/ncbi\.nlm\.nih\.gov/.test(h)) return /meta|systematic/.test(t) ? "Meta" : "PubMed"
    return "Source"
  }

  function extractYear(title?: string) {
    const m = (title || "").match(/20\d{2}/)
    return m ? m[0] : ""
  }

  function exportPdf() {
    const last = messages.filter(m => m.role === "assistant").slice(-1)[0]
    if (!last) return
    const urls = filterTrusted(extractUrls(last.content), input)
    const ensured = ensureForAudience(formatPlain(last.content), input, userLang, audience)
    const htmlContent = hyperlinkRefs(ensured, urls)
    const items = urls.map((u) => {
      const info = metaMap[u] || {}
      let host = ""
      try { host = new URL(u).hostname } catch {}
      const type = classifyType(host, info.originTitle || info.translatedTitle || "")
      const yr = extractYear(info.originTitle || info.translatedTitle)
      const doi = info.doi ? ` <a href="https://doi.org/${info.doi}" target="_blank">DOI:${info.doi}</a>` : ""
      const title = info.translatedTitle || info.originTitle || u
      return `<div>[${urls.indexOf(u)+1}] <span>${title}</span> <a href="${u}" target="_blank">${u}</a> ${host ? `(${host})` : ""} ${type ? `[${type}]` : ""} ${yr ? `(${yr})` : ""}${doi}</div>`
    }).join("")
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Export</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}h1{font-size:20px;margin:0 0 12px}hr{margin:16px 0} .cit div{margin:6px 0} .content{white-space:pre-wrap;line-height:1.6}</style></head><body><h1>回答</h1><div class="content">${htmlContent}</div><hr/><h1>引用</h1><div class="cit">${items}</div></body></html>`
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => { try { w.print() } catch {} }, 300)
  }

  function exportSessionPdf() {
    const assists = messages.filter(m => m.role === "assistant")
    if (!assists.length) return
    const blocks = assists.map((msg, i) => {
      const urls = filterTrusted(extractUrls(msg.content), input)
      const ensured = ensureForAudience(formatPlain(msg.content), input, userLang, audience)
      const htmlContent = hyperlinkRefs(ensured, urls)
      const items = urls.map((u) => {
        const info = metaMap[u] || {}
        let host = ""
        try { host = new URL(u).hostname } catch {}
        const type = classifyType(host, info.originTitle || info.translatedTitle || "")
        const yr = extractYear(info.originTitle || info.translatedTitle)
        const doi = info.doi ? ` <a href="https://doi.org/${info.doi}" target="_blank">DOI:${info.doi}</a>` : ""
        const title = info.translatedTitle || info.originTitle || u
        return `<div>[${urls.indexOf(u)+1}] <span>${title}</span> <a href="${u}" target="_blank">${u}</a> ${host ? `(${host})` : ""} ${type ? `[${type}]` : ""} ${yr ? `(${yr})` : ""}${doi}</div>`
      }).join("")
      return `<h2>回答 ${i+1}</h2><div class="content">${htmlContent}</div><h3>引用</h3><div class="cit">${items}</div><hr/>`
    }).join("")
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Export Session</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}h1{font-size:22px;margin:0 0 16px}h2{font-size:18px;margin:12px 0}h3{font-size:16px;margin:12px 0}hr{margin:16px 0} .cit div{margin:6px 0} .content{white-space:pre-wrap;line-height:1.6}</style></head><body><h1>会話エクスポート</h1>${blocks}</body></html>`
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => { try { w.print() } catch {} }, 300)
  }

  function reset() {
    setMessages([])
    setSystem("")
  }

  return (
    <div className="container">
      <div className="header">
        <div className="title">百川チャット（日本語対応）</div>
        <div className="controls">
          <button className="button" onClick={() => setStream(s => !s)}>{stream ? "ストリーム: ON" : "ストリーム: OFF"}</button>
          <button className="button danger" onClick={reset}>リセット</button>
          <button className="button" onClick={exportPdf}>PDF</button>
          <button className="button" onClick={exportSessionPdf}>Session PDF</button>
        </div>
      </div>

      <div className="params">
        <div className="param">
          <label>システムプロンプト</label>
          <input className="input" value={system} onChange={e => setSystem(e.target.value)} placeholder="役割や指示を入力" />
        </div>
        <div className="param">
          <label>温度 {temperature.toFixed(2)}</label>
          <input className="slider" type="range" min={0} max={1} step={0.01} value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} />
        </div>
        <div className="param">
          <label>トップP {topP.toFixed(2)}</label>
          <input className="slider" type="range" min={0} max={1} step={0.01} value={topP} onChange={e => setTopP(parseFloat(e.target.value))} />
        </div>
        <div className="param">
          <label>トップK {topK}</label>
          <input className="slider" type="range" min={0} max={20} step={1} value={topK} onChange={e => setTopK(parseInt(e.target.value))} />
        </div>
        <div className="param">
          <label>最大トークン {maxTokens}</label>
          <input className="slider" type="range" min={64} max={2048} step={64} value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value))} />
        </div>
        <div className="param">
          <label>Web検索</label>
          <button className="button" onClick={() => setEnableSearch(v => !v)}>{enableSearch ? "ON" : "OFF"}</button>
        </div>
        <div className="param">
          <label>詳細モード</label>
          <button className="button" onClick={() => setDetailed(v => !v)}>{detailed ? "ON" : "OFF"}</button>
        </div>
        <div className="param">
          <label>モデル</label>
          <select className="select" value={model} onChange={e => setModel(e.target.value)}>
            <option value="Baichuan-M2-Plus">Baichuan-M2-Plus</option>
            <option value="deepseek-chat">deepseek-chat</option>
            <option value="deepseek-reasoner">deepseek-reasoner</option>
          </select>
        </div>
        <div className="param">
          <label>出力言語</label>
          <select className="select" value={userLang} onChange={e => setUserLang(e.target.value)}>
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
          </select>
        </div>
        <div className="param">
          <label>ビュー</label>
          <select className="select" value={audience} onChange={e => setAudience(e.target.value)}>
            <option value="doctor">Doctor</option>
            <option value="patient">Patient</option>
          </select>
        </div>
        <div className="param">
          <label>証拠タイプ</label>
          <select className="select" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="All">All</option>
            <option value="Guideline">Guideline</option>
            <option value="Agency">Agency</option>
            <option value="Meta">Meta</option>
            <option value="Journal">Journal</option>
            <option value="PubMed">PubMed</option>
            <option value="Source">Source</option>
          </select>
        </div>
        <div className="param">
          <label>年閾値 {filterYearMin}</label>
          <input className="slider" type="range" min={2000} max={2030} step={1} value={filterYearMin} onChange={e => setFilterYearMin(parseInt(e.target.value))} />
        </div>
        <div className="param">
          <label>引用表示</label>
          <button className="button" onClick={() => setShowCitations(v => !v)}>{showCitations ? "ON" : "OFF"}</button>
        </div>
      </div>

      <div ref={chatRef} className="chat">
        {fullMessages.length === 0 && !loading && (
          <div className="msg">
            <div className="role">案内</div>
            <div className="bubble">ここにチャットが表示されます。メッセージを入力して送信してください。</div>
          </div>
        )}
        {fullMessages.map((m, i) => (
          <div key={i} className="msg">
            <div className="role">{m.role === "user" ? "ユーザー" : m.role === "assistant" ? "アシスタント" : "システム"}</div>
            <div className="bubble">{m.role === "assistant" ? renderWithLinks(ensureForAudience(formatPlain(m.content), input, userLang, audience), i, filterTrusted(extractUrls(m.content), input)) : renderWithLinks(m.content, i)}</div>
            {m.role === "assistant" && showCitations && (
              <div className="citations">
                {filterTrusted(extractUrls(m.content), input).map((u, idx) => {
                  let host = ""
                  try { host = new URL(u).hostname } catch {}
                  const info = metaMap[u] || {}
                  const translated = info.translatedTitle
                  const origin = info.originTitle
                  const type = classifyType(host, (translated || origin || ""))
                  const yr = extractYear(translated || origin)
                  const passType = filterType === "All" || type === filterType
                  const passYear = !filterYearMin || (yr && parseInt(yr) >= filterYearMin)
                  if (!passType || !passYear) return null
                  return (
                    <div key={idx} id={`ref-${i}-${idx + 1}`}>
                      <span className="refnum">[{idx + 1}]</span>
                      {translated ? <span className="ctitle">{translated}</span> : null}
                      {origin ? <span className="ctitle origin">[原] {origin}</span> : null}
                      <a href={u} target="_blank" rel="noopener noreferrer">{u}</a>
                      {host ? <span className="refhost"> ({host})</span> : null}
                      {(() => { const y = yr; return <span className="badge">[{type}{y ? ` ${y}` : ""}]</span> })()}
                      {info.doi ? <a className="doi" href={`https://doi.org/${info.doi}`} target="_blank" rel="noopener noreferrer"> DOI:{info.doi}</a> : null}
                    </div>
                  )
                })}
              </div>
            )}
            {m.role === "assistant" && (
              (() => {
                const miss = validateSections(ensureForAudience(formatPlain(m.content), input, userLang, audience), userLang, audience)
                if (!miss.length) return null
                const label = userLang === "zh" ? "缺失项" : "欠落項目"
                return <div className="warnings">{label}: {miss.join(", ")}</div>
              })()
            )}
          </div>
        ))}
        {loading && (
          <div className="msg">
            <div className="role">生成中</div>
            <div className="bubble">...</div>
          </div>
        )}
      </div>

      <div className="inputRow">
        <textarea className="input" rows={3} value={input} onChange={e => setInput(e.target.value)} placeholder="メッセージを入力" />
        <button className="button primary" onClick={send} disabled={loading}>送信</button>
      </div>

      <div className="footer">
        <div>APIは安全にサーバでプロキシされています</div>
        <div>Vercel無料枠で動作</div>
      </div>
    </div>
  )
}
function filterTrusted(urls: string[], q: string) {
  const common = ["who.int", "ncbi.nlm.nih.gov", "nih.gov", "mhlw.go.jp"]
  const jsh = ["jpnsh.jp"]
  const jds = ["jds.or.jp"]
  const extra = ["escardio.org", "acc.org", "ahajournals.org", "jamanetwork.com", "nejm.org", "sciencedirect.com", "cdc.gov"]
  let allow = [...common]
  if (/高血圧|血圧/i.test(q)) allow = [...allow, ...jsh]
  if (/糖尿病|血糖|HbA1c/i.test(q)) allow = [...allow, ...jds]
  allow = [...allow, ...extra]
  const picked = urls.filter(u => {
    try { return allow.includes(new URL(u).hostname) } catch { return false }
  })
  return picked.length ? picked : urls
}
