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
  MIN_WEIGHT: 0.05,         // 权重下限
  MAX_WEIGHT: 10,           // 权重上限
  DECAY_DAYS: 30,           // 宽限期:距上次「触摸」(被读 / 入表)未超过 N 天不衰减
  DECAY_FACTOR: 0.9,        // 每超出宽限期一个 DECAY_DAYS 的衰减系数
  MAX_DECAY_STEPS: 30,      // 衰减指数上限(防极端天数把权重一步打到地板)
  ARCHIVE_THRESHOLD: 0.3,   // 权重低于该值 → 归档 inactive(不删除,可复活)
  ARCHIVE_RECOVER: 0.6,     // 归档后再次被触摸 → 权重至少恢复到该值(防「复活即再归档」抖动)
  CONSOLIDATE_INTERVAL_MS: 24 * 60 * 60 * 1000, // 巩固周期:24h
} as const

export interface WeightEntry {
  weight: number
  accessCount: number
  lastAccessed: string | null
  state: 'active' | 'inactive'
  /** 概念首次进入权重表的时间(从未被读取时的衰减基线;旧数据可能缺失) */
  createdAt?: string
  /** 上次应用衰减时的「距触摸天数」——用于把衰减做成增量式,保证 consolidate 幂等 */
  lastDecayDays?: number
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
    meta.entries[conceptId] = {
      weight: 1.0, accessCount: 0, lastAccessed: null, state: 'active',
      // 记下入表时间作为衰减基线 —— 否则「只被跳过、从未被读」的记忆会因为
      // lastAccessed=null 而被当成无限陈旧,第一次巩固就瞬间衰减+归档
      createdAt: new Date().toISOString(),
    }
  }
  return meta.entries[conceptId]
}

/** 触摸时间基线:读过用 lastAccessed;只入表未读过用 createdAt;两者都缺(旧数据)→ 视为现在(保守,不衰减) */
function touchedAtMs(e: WeightEntry, now: number): number {
  const t = e.lastAccessed || e.createdAt
  if (!t) return now
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : now
}

/** 衰减因子:宽限期内为 1;超出后按 (超出天数 / DECAY_DAYS) 做 DECAY_FACTOR 幂衰减 */
function decayFactor(elapsedDays: number): number {
  if (elapsedDays <= PARAMS.DECAY_DAYS) return 1
  const over = (elapsedDays - PARAMS.DECAY_DAYS) / PARAMS.DECAY_DAYS
  return Math.pow(PARAMS.DECAY_FACTOR, Math.min(over, PARAMS.MAX_DECAY_STEPS))
}

/** 交互反馈:用户选中(如 TechChoice 候选被拍板);写锁内串行防权重丢失 */
export async function recordSelect(root: string, conceptId: string, delta: number = PARAMS.SELECT_DELTA): Promise<number> {
  return withLock(async () => {
    const meta = await loadMeta(root)
    const e = entryOf(meta, conceptId)
    e.weight = Math.min(PARAMS.MAX_WEIGHT, e.weight + delta)
    e.accessCount += 1
    e.lastAccessed = new Date().toISOString()
    // 触摸后衰减基线归零:下次从宽限期重新起算
    e.lastDecayDays = 0
    if (e.state === 'inactive') {
      // 复活:权重至少抬到 ARCHIVE_RECOVER —— 否则 okf_read 只 +0.1,
      // 复活后仍低于归档线,下次巩固立刻再归档(来回抖动)
      e.weight = Math.max(e.weight, PARAMS.ARCHIVE_RECOVER)
      e.state = 'active'
    }
    await saveMeta(root, meta)
    return e.weight
  })
}

/** 交互反馈:用户跳过/否定;写锁内串行防权重丢失 */
export async function recordSkip(root: string, conceptId: string, delta: number = PARAMS.SKIP_DELTA): Promise<number> {
  return withLock(async () => {
    const meta = await loadMeta(root)
    const e = entryOf(meta, conceptId)
    e.weight = Math.max(PARAMS.MIN_WEIGHT, e.weight - delta)
    await saveMeta(root, meta)
    return e.weight
  })
}

/** 交互反馈:被唤起且被使用 */
export async function recordHit(root: string, conceptId: string): Promise<number> {
  return recordSelect(root, conceptId, PARAMS.HIT_DELTA)
}

/**
 * 巩固:增量衰减 + 阈值归档(不删除,可复活);写锁内串行。
 *
 * 幂等性:衰减按「本次因子 / 上次已应用的因子」增量施加。两次调用之间 elapsedDays
 * 不变时比值为 1,所以时间没流逝就不会重复扣血 —— 这正是旧实现的问题:
 * 它每次都把 factor 乘到已衰减的权重上,连调 N 次就衰减 N 次(24h 定时器 + 每次
 * 重启/reload 多跑一次即反复扣血)。
 */
export async function consolidate(root: string): Promise<MemoryMeta> {
  return withLock(async () => {
    const meta = await loadMeta(root)
    const now = Date.now()
    let changed = false
    for (const e of Object.values(meta.entries)) {
      const elapsedDays = (now - touchedAtMs(e, now)) / 86400000
      if (elapsedDays > PARAMS.DECAY_DAYS) {
        const prev = typeof e.lastDecayDays === 'number' ? e.lastDecayDays : PARAMS.DECAY_DAYS
        const ratio = Math.min(1, decayFactor(elapsedDays) / decayFactor(prev))
        if (ratio < 1) {
          e.weight = Math.max(PARAMS.MIN_WEIGHT, e.weight * ratio)
          changed = true
        }
        if (e.lastDecayDays !== elapsedDays) {
          e.lastDecayDays = elapsedDays
          changed = true
        }
      }
      if (e.state === 'active' && e.weight < PARAMS.ARCHIVE_THRESHOLD) {
        e.state = 'inactive'
        changed = true
      }
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

/**
 * 可排序命中项:只要带 conceptId 与 score 即可。
 * 不要求索引签名 —— 否则 SearchHit 这类具体接口会被判为不可赋值。
 */
export interface RankableHit {
  conceptId: string
  score: number
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
