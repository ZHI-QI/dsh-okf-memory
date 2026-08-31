/**
 * learning.js — 神经自我学习核心:记忆权重元数据、强化反馈回路、巩固与遗忘。
 * 唤起评分 = relevance × weight × recency_factor(相关度 × 历史权重 × 近因)。
 * 元数据存 <root>/.meta/weights.json(点目录,不影响 OKF 符合性)。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { withLock } from './store.js'

/** 学习参数(起步默认值,可随使用校准) */
export const PARAMS = {
  SELECT_DELTA: 1.0,        // 用户选中某候选/概念 → 权重增量
  SKIP_DELTA: 0.5,          // 用户跳过/否定 → 权重减量
  HIT_DELTA: 0.1,           // 被唤起且使用 → 小幅增量
  DECAY_DAYS: 30,           // 无访问超过 N 天开始明显衰减
  DECAY_FACTOR: 0.9,        // 每次巩固周期未使用时的衰减系数
  ARCHIVE_THRESHOLD: 0.3,   // 权重低于该值 → 归档 inactive(不删除,可复活)
  ARCHIVE_RECOVER: 0.6,     // 归档后再次被唤起命中 → 复活阈值(权重提到该值)
  CONSOLIDATE_INTERVAL_MS: 24 * 60 * 60 * 1000, // 巩固周期:24h
}

function metaFile(root) {
  return path.join(root, '.meta', 'weights.json')
}

function emptyMeta() {
  return { version: 1, updatedAt: null, entries: {} }
}

async function ensureMetaDir(root) {
  await fs.mkdir(path.dirname(metaFile(root)), { recursive: true })
}

/** 加载元数据(不存在则初始化) */
export async function loadMeta(root) {
  await ensureMetaDir(root)
  try {
    const raw = await fs.readFile(metaFile(root), 'utf8')
    const m = JSON.parse(raw)
    if (!m.entries) m.entries = {}
    return m
  } catch {
    return emptyMeta()
  }
}

export async function saveMeta(root, meta) {
  meta.updatedAt = new Date().toISOString()
  await ensureMetaDir(root)
  await fs.writeFile(metaFile(root), JSON.stringify(meta, null, 2), 'utf8')
}

function entryOf(meta, conceptId) {
  if (!meta.entries[conceptId]) {
    meta.entries[conceptId] = { weight: 1.0, accessCount: 0, lastAccessed: null, state: 'active' }
  }
  return meta.entries[conceptId]
}

/** 交互反馈:用户选中(如 TechChoice 候选被拍板);写锁内串行防权重丢失 */
export async function recordSelect(root, conceptId, delta = PARAMS.SELECT_DELTA) {
  return withLock(async () => {
    const meta = await loadMeta(root)
    const e = entryOf(meta, conceptId)
    e.weight = Math.min(10, e.weight + delta)
    e.accessCount += 1
    e.lastAccessed = new Date().toISOString()
    if (e.state === 'inactive') e.state = 'active'
    await saveMeta(root, meta)
    return e.weight
  })
}

/** 交互反馈:用户跳过/否定;写锁内串行防权重丢失 */
export async function recordSkip(root, conceptId, delta = PARAMS.SKIP_DELTA) {
  return withLock(async () => {
    const meta = await loadMeta(root)
    const e = entryOf(meta, conceptId)
    e.weight = Math.max(0.05, e.weight - delta)
    await saveMeta(root, meta)
    return e.weight
  })
}

/** 交互反馈:被唤起且被使用 */
export async function recordHit(root, conceptId) {
  return recordSelect(root, conceptId, PARAMS.HIT_DELTA)
}

/** 巩固:未使用衰减 + 阈值归档(不删除,可复活);写锁内串行 */
export async function consolidate(root) {
  return withLock(async () => {
    const meta = await loadMeta(root)
    const now = Date.now()
    let changed = false
    for (const [id, e] of Object.entries(meta.entries)) {
      const days = e.lastAccessed ? (now - new Date(e.lastAccessed).getTime()) / 86400000 : 999
      if (days > PARAMS.DECAY_DAYS) {
        const factor = Math.pow(PARAMS.DECAY_FACTOR, Math.min(days / PARAMS.DECAY_DAYS, 30))
        e.weight = Math.max(0.05, e.weight * factor)
        changed = true
      }
      if (e.state === 'active' && e.weight < PARAMS.ARCHIVE_THRESHOLD) {
        e.state = 'inactive'
        changed = true
      }
      // 复活:归档后再次命中由 recordSelect 处理(weight + SELECT_DELTA,state → active)
    }
    if (changed) await saveMeta(root, meta)
    return meta
  })
}

/**
 * 启动巩固定时器:每 intervalMs 对记忆库做一次巩固(衰减+归档),返回停止函数。
 * 定时器 unref(不阻止进程退出);内部吞异常,单次失败不中断进程。
 */
export function startConsolidation(root, intervalMs = PARAMS.CONSOLIDATE_INTERVAL_MS) {
  const id = setInterval(() => {
    consolidate(root).catch(() => {})
  }, intervalMs)
  if (typeof id.unref === 'function') id.unref()
  return () => clearInterval(id)
}

/**
 * 唤起评分:relevance × weight × recency_factor。
 * @param {number} relevance 检索相关度(0-5)
 * @param {number} weight 历史权重(含交互反馈)
 * @param {string|null} lastAccessed ISO 时间
 */
export function recallScore(relevance, weight = 1.0, lastAccessed = null) {
  let recency = 1.0
  if (lastAccessed) {
    const days = (Date.now() - new Date(lastAccessed).getTime()) / 86400000
    recency = Math.max(0.4, 1 / (1 + days / 30))
  }
  return relevance * weight * recency
}

/** 把检索结果与学习权重合并,按唤起评分排序 */
export async function rank(root, searchHits) {
  const meta = await loadMeta(root)
  const ranked = searchHits.map((h) => {
    const e = meta.entries[h.conceptId]
    const weight = e ? e.weight : 1.0
    const state = e ? e.state : 'active'
    const score = recallScore(h.score, weight, e ? e.lastAccessed : null)
    return { ...h, weight: +weight.toFixed(2), state, score: +score.toFixed(3) }
  })
  ranked.sort((a, b) => b.score - a.score)
  return ranked
}
