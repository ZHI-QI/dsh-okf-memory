/**
 * dedupe.js — 去重与互补决策(对应"互补而非复制"原则)。
 * 写前必查:命中且相同 → skip;命中但互补 → merge 建议 + 交叉链接;未命中 → create。
 */
import { promises as fs } from 'node:fs'
import { parseFrontmatter } from './concept.js'
import { scanBundle, readConcept } from './store.js'

/**
 * 词项化:空白分词 + CJK 二元组。
 * 纯子串匹配对中文短语(如「查询数据库」)几乎必然落空,而库中概念标题/描述往往写成
 * 「查询鼎赞…数据…」。补重叠二元组后,「查询」「数据」等子片段也能命中,提升中文召回。
 * 保留原始整串词项以维持精确短语加分。
 * @param {string} q 已小写的查询串
 * @returns {string[]}
 */
function tokenizeQuery(q) {
  const terms = new Set()
  const raw = String(q || '').split(/\s+/).filter(Boolean)
  for (const token of raw) {
    terms.add(token)
    // 含 CJK 且长度>=3 时,补相邻 2 字符二元组
    if (/[\u4e00-\u9fff]/.test(token) && token.length >= 3) {
      for (let i = 0; i < token.length - 1; i++) terms.add(token.slice(i, i + 2))
    }
  }
  return [...terms]
}

/**
 * 全库检索:按关键词匹配 title/description/tags/type(正文做二级加分)。
 * @param {string} root
 * @param {string} query 关键词(支持中文短语,内部按空白+二元组分词)
 * @param {{type?: string, tags?: string[], limit?: number}} opts
 * @returns {Promise<Array<{conceptId, title, description, type, tags, score}>>}
 */
export async function search(root, query, opts = {}) {
  const { type, tags, limit = 20 } = opts
  const q = String(query || '').trim().toLowerCase()
  // 空白分词 + CJK 二元组,缓解中文短语「查询数据库」这类整串子串匹配落空的问题
  const qTerms = tokenizeQuery(q)
  const concepts = await scanBundle(root)
  const hits = []
  for (const c of concepts) {
    let text
    try {
      text = await fs.readFile(c.filePath, 'utf8')
    } catch {
      continue
    }
    const { meta } = parseFrontmatter(text)
    if (!meta || !meta.type) continue
    if (type && String(meta.type).toLowerCase() !== String(type).toLowerCase()) continue
    if (tags && tags.length > 0) {
      const mt = Array.isArray(meta.tags) ? meta.tags.map(String) : []
      if (!tags.every((t) => mt.some((x) => x.toLowerCase().includes(String(t).toLowerCase())))) continue
    }
    let score = 0
    if (qTerms.length > 0) {
      const hay = [meta.title, meta.description, Array.isArray(meta.tags) ? meta.tags.join(' ') : '', meta.type]
        .filter(Boolean)
        .join(' ').toLowerCase()
      let matched = 0
      for (const t of qTerms) {
        if (hay.includes(t)) matched++
        else if (text.toLowerCase().includes(t)) { score += 0.3; matched++ }
      }
      if (matched === 0) continue
      score += (matched / qTerms.length) * 2
      if (hay.includes(q)) score += 3 // 完整短语命中加分
    }
    score += (Array.isArray(meta.tags) ? meta.tags.length : 0) * 0.1
    hits.push({
      conceptId: c.conceptId,
      title: meta.title || c.conceptId,
      description: meta.description || '',
      type: meta.type,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      score,
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

/**
 * 按标题找相似概念(去重主查:精确相等或互相包含)。
 */
export async function findSimilarByTitle(root, title, type) {
  const t = String(title || '').trim().toLowerCase()
  if (!t) return []
  const concepts = await scanBundle(root)
  const out = []
  for (const c of concepts) {
    let text
    try {
      text = await fs.readFile(c.filePath, 'utf8')
    } catch {
      continue
    }
    const { meta } = parseFrontmatter(text)
    if (!meta || !meta.title) continue
    if (type && String(meta.type).toLowerCase() !== String(type).toLowerCase()) continue
    const ct = String(meta.title).trim().toLowerCase()
    if (ct === t || ct.includes(t) || t.includes(ct)) {
      out.push({ conceptId: c.conceptId, title: meta.title, type: meta.type, similarity: ct === t ? 1 : 0.6 })
    }
  }
  return out.sort((a, b) => b.similarity - a.similarity)
}

/**
 * 去重决策。
 * @returns {{action: 'skip'|'update'|'create', conceptId?: string, reason: string}}
 */
export async function decide(root, { title, type, body }) {
  const similar = await findSimilarByTitle(root, title, type)
  if (similar.length > 0) {
    const top = similar[0]
    if (top.similarity >= 1) {
      // 标题完全相同:比较正文长度,内容被覆盖 → update,否则 skip 建议
      const existing = await readConcept(root, top.conceptId)
      const bodyLen = String(body || '').trim().length
      const existingLen = String(existing.body || '').trim().length
      if (bodyLen > existingLen * 0.7) {
        return { action: 'update', conceptId: top.conceptId, reason: `标题相同且新正文更完整(${bodyLen}字 vs 已有${existingLen}字),更新已有概念` }
      }
      return { action: 'skip', conceptId: top.conceptId, reason: '标题相同的概念已存在,内容未明显增加,跳过写入' }
    }
    return { action: 'update', conceptId: top.conceptId, reason: `找到相近概念[${top.title}](similarity ${top.similarity}),建议互补合并或互建交叉链接` }
  }
  return { action: 'create', reason: '未命中已有概念,新建' }
}
