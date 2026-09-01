/**
 * learning.ts — 神经自我学习核心:记忆权重元数据、强化反馈回路、巩固与遗忘。
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
} as const

export interface WeightEntry {
  weight: number
  accessCount: number
  lastAccessed: string | null
  state: 'active' | 'inactive'
}

export interface MemoryMeta {
  version: number
  updatedAt: string | null
  entries: Record<string, WeightEntry>
}

function metaFile(root: string): string {
  return path.join(root, '.meta', 'weights.json')
}

function emptyMeta(): MemoryMeta {
  return { version: 1, updatedAt: null, entries: {} }
}

async function ensureMetaDir(root: string): Promise<void> {
  await fs.mkdir(path.dirname(metaFile(root)), { recursive: true })
}

/** 加载元数据(不存在则初始化) */
export async function loadMeta(root: string): Promise<MemoryMeta> {
  await ensureMetaDir(root)
  try {
    const raw = await fs.readFile(metaFile(root), 'utf8')
    const m = JSON.parse(raw) as MemoryMeta
    if (!m.entries) m.entries = {}
    return m
  } catch {
    return emptyMeta()
  }
}

export async function saveMeta(root: string, meta: MemoryMeta): Promise<void> {
  meta.updatedAt = new Date().toISOString()
  await ensureMetaDir(root)
  await fs.writeFile(metaFile(root), JSON.stringify(meta, null, 2), 'utf8')
}

function entryOf(meta: MemoryMeta, conceptId: string): WeightEntry {
  if (!meta.entries[conceptId]) {
    meta.entries[conceptId] = { weight: 1.0, accessCount: 0, lastAccessed: null, state: 'active' }
  }
  return meta.entries[conceptId]
}

/** 交互反馈:用户选中(如 TechChoice 候选被拍板);写锁内串行防权重丢失 */
export async function recordSelect(root: string, conceptId: string, delta: number = PARAMS.SELECT_DELTA): Promise<number> {
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
export async function recordSkip(root: string, conceptId: string, delta: number = PARAMS.SKIP_DELTA): Promise<number> {
  return withLock(async () => {
    const meta = await loadMeta(root)
    const e = entryOf(meta, conceptId)
    e.weight = Math.max(0.05, e.weight - delta)
    await saveMeta(root, meta)
    return e.weight
  })
}

/** 交互反馈:被唤起且被使用 */
export async function recordHit(root: string, conceptId: string): Promise<number> {
  return recordSelect(root, conceptId, PARAMS.HIT_DELTA)
}

/** 巩固:未使用衰减 + 阈值归档(不删除,可复活);写锁内串行 */
export async function consolidate(root: string): Promise<MemoryMeta> {
  return withLock(async () => {
    const meta = await loadMeta(root)
    const now = Date.now()
    let changed = false
    for (const e of Object.values(meta.entries)) {
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
export function startConsolidation(root: string, intervalMs: number = PARAMS.CONSOLIDATE_INTERVAL_MS): () => void {
  const id = setInterval(() => {
    consolidate(root).catch(() => {})
  }, intervalMs)
  if (typeof id.unref === 'function') id.unref()
  return () => clearInterval(id)
}

/**
 * 唤起评分:relevance × weight × recency_factor。
 */
export function recallScore(relevance: number, weight: number = 1.0, lastAccessed: string | null = null): number {
  let recency = 1.0
  if (lastAccessed) {
    const days = (Date.now() - new Date(lastAccessed).getTime()) / 86400000
    recency = Math.max(0.4, 1 / (1 + days / 30))
  }
  return relevance * weight * recency
}

export interface RankableHit {
  conceptId: string
  score: number
  [key: string]: unknown
}

/** 把检索结果与学习权重合并,按唤起评分排序 */
export async function rank<T extends RankableHit>(root: string, searchHits: T[]): Promise<Array<T & { weight: number; state: string; score: number }>> {
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
