/**
 * graph.js — 记忆图谱数据提取:把 OKF 记忆库转成图谱 JSON(nodes/edges/timeline)。
 * 供 okf_graph 工具/服务消费,契约与可视化前端一致,可被 dshfind 等复用。
 * 纯业务逻辑,不依赖 dsh ctx,便于单测。
 */
import { promises as fs } from 'node:fs'
import { scanBundle } from './store.js'
import { parseFrontmatter } from './concept.js'
import { loadMeta } from './learning.js'

/**
 * 提取记忆图谱数据。
 * @param {string} root 记忆库根目录
 * @returns {Promise<{meta:object, nodes:Array, edges:Array, timeline:Array}>}
 */
export async function buildGraph(root, opts = {}) {
  const concepts = await scanBundle(root)
  const weights = await loadMeta(root)
  const meta = {
    generatedAt: new Date().toISOString(),
    root,
    totalConcepts: concepts.length,
  }

  const nodes = []
  const byId = new Map()
  for (const c of concepts) {
    let text
    try {
      text = await readText(c.filePath)
    } catch {
      continue
    }
    const { meta: fm } = parseFrontmatter(text)
    if (!fm) continue
    const w = weights.entries[c.conceptId]
    nodes.push({
      id: c.conceptId,
      title: fm.title || c.conceptId.replace(/^[^/]+\//, ''),
      type: fm.type || 'Other',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      description: fm.description || '',
      weight: w ? +w.weight.toFixed(2) : 1.0,
      state: w?.state || 'active',
      lastAccessed: w?.lastAccessed || null,
    })
    byId.set(c.conceptId, c.conceptId)
  }

  // 边:交叉链接(用 recall 同款正则,不触发权重反馈)
  const edges = []
  const seen = new Set()
  for (const c of concepts) {
    let text
    try {
      text = await readText(c.filePath)
    } catch {
      continue
    }
    const { body } = parseFrontmatter(text)
    const re = /\[([^\]]+)\]\(\/([^)]+\.md)\)/g
    let m
    while ((m = re.exec(body || '')) !== null) {
      let targetId = m[2].replace(/^\/+/, '').replace(/\.md$/, '')
      if (!byId.has(targetId)) {
        const k = Object.keys(byId).find((x) => x.toLowerCase() === targetId.toLowerCase())
        if (k) targetId = k
      }
      if (targetId && targetId !== c.conceptId) {
        const k = [c.conceptId, targetId].sort().join('||')
        if (!seen.has(k)) {
          seen.add(k)
          edges.push({ source: c.conceptId, target: targetId, text: m[1] })
        }
      }
    }
  }

  // 时间线(权重历史,供学习热力)
  const timeline = Object.entries(weights.entries || {}).map(([id, e]) => ({
    id,
    weight: +e.weight.toFixed(2),
    state: e.state || 'active',
    lastAccessed: e.lastAccessed || null,
    accessCount: e.accessCount || 0,
  }))

  return { meta, nodes, edges, timeline }
}

/** 读文件 */
async function readText(filePath) {
  return fs.readFile(filePath, 'utf8')
}
