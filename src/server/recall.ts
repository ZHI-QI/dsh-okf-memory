/**
 * recall.ts — 预测性唤起:摘要层粗筛 → 细节层校验 → 反馈回路。
 * 对应"预测加工":先预测需要什么记忆,再检索验证,命中质量写回权重。
 */
import { search, type SearchOptions, type SearchHit } from './dedupe.js'
import { readConcept, type ConceptRef } from './store.js'
import { rank, recordHit } from './learning.js'

export interface PreloadOptions extends SearchOptions {
  limit?: number
}

export interface PreloadHit {
  conceptId: string
  title: string
  description: string
  type: string
  tags: string[]
  weight: number
  state: string
  score: number
}

/**
 * 预测性预取:给定查询,返回按唤起评分排序的记忆摘要。
 */
export async function preload(root: string, query: string, opts: PreloadOptions = {}): Promise<PreloadHit[]> {
  const raw = await search(root, query, { ...opts, limit: (opts.limit || 8) * 3 })
  const ranked = await rank(root, raw)
  return ranked.slice(0, opts.limit || 8).map(({ conceptId, title, description, type, tags, weight, state, score }) => ({
    conceptId, title, description, type, tags, weight, state, score,
  }))
}

export interface ConceptLink {
  text: string
  conceptId: string
}

export interface RecalledConcept extends ConceptRef {
  links: ConceptLink[]
}

/**
 * 精读:读全文 + 提取交叉链接,并记录命中反馈。
 */
export async function recall(root: string, conceptId: string): Promise<RecalledConcept> {
  const concept = await readConcept(root, conceptId)
  // 提取交叉链接 [text](/path/to/x.md)
  const links: ConceptLink[] = []
  const re = /\[([^\]]+)\]\(\/([^)]+\.md)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(concept.body || '')) !== null) {
    links.push({ text: m[1], conceptId: m[2].replace(/\.md$/, '') })
  }
  await recordHit(root, conceptId)
  return { ...concept, links }
}
