/**
 * concept.js — OKF v0.1 概念化:frontmatter 组装、正文模板、概念 ID 规范化、frontmatter 解析。
 * 依据 OKF v0.1:frontmatter 唯一硬要求是 type;title/description 强烈建议;tags/timestamp 可选;扩展字段允许。
 */

/** 类型词表(起步版) */
export const TYPE_VOCAB = [
  'Fact', 'Preference', 'Decision', 'Method',
  'Insight', 'Idea', 'Lesson', 'TechChoice',
]

/** 归一化并校验概念类型(大小写不敏感,必须属于 TYPE_VOCAB);非法时抛错 */
export function normalizeType(type) {
  const t = String(type || '').trim()
  if (!t) throw new Error('OKF 概念 type 必填')
  const hit = TYPE_VOCAB.find((v) => v.toLowerCase() === t.toLowerCase())
  if (!hit) throw new Error(`非法 type:「${type}」;可选:${TYPE_VOCAB.join('/')}`)
  return hit
}

/** 规范化概念 ID:保留中文/字母数字,其余转连字符(Windows 安全字符集) */
export function slugify(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** YAML 标量转义 */
function yamlScalar(v) {
  if (typeof v === 'string') {
    if (/^[\p{L}\p{N}\s.,\-_/:（）()%¥￥+*#@!?'"=<>\[\]{}|&^~`\\;]*$/u.test(v) && !/^[\s\-?:]/.test(v) && !v.includes(': ')) {
      return v
    }
    return JSON.stringify(v)
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function yamlTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 'tags: []'
  const items = tags.map((t) => yamlScalar(String(t))).join(', ')
  return `tags: [${items}]`
}

/** 生成 frontmatter(固定顺序,稳定可比较) */
export function buildFrontmatter(meta) {
  const lines = ['---']
  const order = ['type', 'title', 'description', 'resource', 'tags', 'timestamp', 'source']
  for (const key of order) {
    const v = meta[key]
    if (v === undefined || v === null || v === '') continue
    if (key === 'tags') {
      lines.push(yamlTags(v))
    } else {
      lines.push(`${key}: ${yamlScalar(v)}`)
    }
  }
  // 生产者扩展字段(OKF 允许,消费者须保留)
  for (const [k, v] of Object.entries(meta)) {
    if (order.includes(k)) continue
    lines.push(`${k}: ${yamlScalar(v)}`)
  }
  lines.push('---')
  return lines.join('\n')
}

/**
 * 生成概念文档。
 * @param {object} meta frontmatter 字段(type 必填)
 * @param {string} body 结构化正文(Markdown,调用方提供,含 # 小节标题)
 * @returns {string} 完整 .md 内容
 */
export function buildConcept(meta, body) {
  const type = String(meta.type || '').trim()
  if (!type) throw new Error('OKF 概念必须包含非空 type')
  const fm = buildFrontmatter(meta)
  const b = String(body || '').trim()
  return b ? `${fm}\n\n${b}\n` : `${fm}\n`
}

/**
 * 决策/结论三段式模板(继承用户约定:数据/分析/结论)。
 * @param {{data?: string, analysis?: string, conclusion: string}} parts
 */
export function buildDecisionBody(parts) {
  const { data, analysis, conclusion } = parts || {}
  const out = []
  if (data) out.push(`# 数据\n\n${data.trim()}`)
  if (analysis) out.push(`# 分析\n\n${analysis.trim()}`)
  if (conclusion) out.push(`# 结论\n\n${conclusion.trim()}`)
  if (out.length === 0) throw new Error('Decision/Insight 正文需至少包含 conclusion')
  return out.join('\n\n')
}

/**
 * 技术选型正文模板(TechChoice):Options 候选表 + Active 当前使用。
 * @param {{title: string, options: Array<{name: string, desc?: string, config?: string, status?: string}>, active?: string, notes?: string}} spec
 */
export function buildTechChoiceBody(spec) {
  const opts = spec.options || []
  if (opts.length === 0) throw new Error('TechChoice 至少需要一个候选')
  const rows = opts
    .map((o) => `| ${yamlScalar(o.name)} | ${yamlScalar(o.desc || '')} | ${yamlScalar(o.config || '')} | ${yamlScalar(o.status || 'candidate')} |`)
    .join('\n')
  const out = []
  out.push(`## Options\n\n| 候选 | 说明 | 配置要点 | 状态 |\n|---|---|---|---|\n${rows}`)
  if (spec.active) out.push(`## Active\n\n- 当前使用:${spec.active}`)
  if (spec.notes) out.push(`## 相关\n\n${spec.notes.trim()}`)
  return out.join('\n\n')
}

/** 解析 frontmatter(容错:解析失败返回 {meta:null, body:原文}) */
export function parseFrontmatter(md) {
  const text = String(md || '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { meta: null, body: text }
  const [, yaml, body] = m
  const meta = {}
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if (/^\[.*\]$/.test(val)) {
      val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    } else if (/^['"].*['"]$/.test(val)) {
      val = val.slice(1, -1)
    }
    meta[key] = val
  }
  return { meta, body: body || '' }
}

/**
 * OKF v0.1 符合性校验(三条硬要求 + 建议字段)。
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateConcept(md) {
  const errors = []
  const warnings = []
  const { meta } = parseFrontmatter(md)
  // 硬要求 1:可解析 YAML 头信息
  if (!meta) {
    errors.push('缺少可解析的 YAML frontmatter')
    return { ok: false, errors, warnings }
  }
  // 硬要求 2:type 非空
  const type = String(meta.type || '').trim()
  if (!type) errors.push('type 字段为空')
  // 建议字段
  if (!meta.title) warnings.push('缺 title(将用文件名推导)')
  if (!meta.description) warnings.push('缺 description(索引/搜索靠它)')
  if (!meta.timestamp) warnings.push('缺 timestamp')
  return { ok: errors.length === 0, errors, warnings }
}

/**
 * 按顶层小节合并两份概念正文(防止更新时无限追加 "## 补充(日期)"):
 * - 相同小节标题(如 # 数据 / ## Options)→ 新内容覆盖旧小节,保留原位置
 * - 新小节 → 追加到末尾
 * - 无标题引言 → 仅当旧文没有引言时才补入
 */
export function mergeConceptBodies(existing, incoming) {
  const ex = splitSections(existing)
  const inc = splitSections(incoming)
  const byKey = new Map(ex.map((s) => [s.key, s]))
  for (const s of inc) {
    if (s.key === null) {
      if (!byKey.has(null)) byKey.set(null, s)
    } else {
      byKey.set(s.key, s)
    }
  }
  const out = []
  const used = new Set()
  for (const s of ex) {
    const hit = byKey.get(s.key)
    if (hit) { out.push(hit); used.add(s.key) }
  }
  for (const s of inc) {
    if (!used.has(s.key)) { out.push(s); used.add(s.key) }
  }
  return out.map(renderSection).filter(Boolean).join('\n\n')
}

/** 按 #/##/### 顶层标题切分成小节(含无标题引言小节 key=null) */
function splitSections(body) {
  const sections = []
  let cur = null
  for (const line of String(body || '').split('\n')) {
    const m = /^(#{1,3})\s+(.*)$/.exec(line)
    if (m) {
      cur = { key: `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim(), content: '' }
      sections.push(cur)
    } else {
      if (!cur) {
        // 无标题引言小节:必须把首行一并收进 content,否则引言内容丢失
        cur = { key: null, content: '' }
        sections.push(cur)
      }
      cur.content += line + '\n'
    }
  }
  return sections
}

function renderSection(s) {
  if (s.key === null) return s.content.trim()
  const body = s.content.trim()
  return body ? `${s.key}\n\n${body}` : s.key
}
