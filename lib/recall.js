/**
 * recall.js — 预测性唤起:摘要层粗筛 → 细节层校验 → 反馈回路。
 * 对应"预测加工":先预测需要什么记忆,再检索验证,命中质量写回权重。
 */
import { search } from './dedupe.js'
import { readConcept } from './store.js'
import { rank, recordHit } from './learning.js'

/**
 * 预测性预取:给定查询,返回按唤起评分排序的记忆摘要。
 * @param {string} root
 * @param {string} query
 * @param {{type?: string, tags?: string[], limit?: number}} opts
 */
export async function preload(root, query, opts = {}) {
  const raw = await search(root, query, { ...opts, limit: (opts.limit || 8) * 3 })
  const ranked = await rank(root, raw)
  return ranked.slice(0, opts.limit || 8).map(({ conceptId, title, description, type, tags, weight, state, score }) => ({
    conceptId, title, description, type, tags, weight, state, score,
  }))
}

/**
 * 精读:读全文 + 提取交叉链接,并记录命中反馈。
 */
export async function recall(root, conceptId) {
  const concept = await readConcept(root, conceptId)
  // 提取交叉链接 [text](/path/to/x.md)
  const links = []
  const re = /\[([^\]]+)\]\(\/([^)]+\.md)\)/g
  let m
  while ((m = re.exec(concept.body || '')) !== null) {
    links.push({ text: m[1], conceptId: m[2].replace(/\.md$/, '') })
  }
  await recordHit(root, conceptId)
  return { ...concept, links }
}
