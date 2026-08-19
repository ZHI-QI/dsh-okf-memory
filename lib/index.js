/**
 * dsh-okf-memory — 会话记忆 → OKF 知识沉淀插件(神经自我学习驱动)。
 *
 * 工具:okf_remember / okf_search / okf_read / okf_forget
 * 服务:ctx.okfMemory(root, search, read, write, consolidate, meta)
 * 记忆库:OKF v0.1 bundle,默认 ~/.dsh/memory/(环境变量 OKF_MEMORY_ROOT 可覆盖)
 */
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  ensureRoot, writeConcept, readConcept, refreshIndex, appendLog, defaultRoot, filePathOf, scanBundle,
} from './store.js'
import { search, findSimilarByTitle } from './dedupe.js'
import { preload, recall } from './recall.js'
import { loadMeta, saveMeta, recordSelect, recordSkip, consolidate, rank, PARAMS } from './learning.js'
import { MEMORY_DISCIPLINE } from './capture.js'
import { buildDecisionBody, buildTechChoiceBody, TYPE_VOCAB, slugify } from './concept.js'

/**
 * defineTool 动态解析:dsh 运行时提供 @deepseek-ai/dsh-tools 时用官方 API,
 * 不可用时降级为透传定义对象(兼容运行时不暴露该包的情况)。
 */
async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    return mod.defineTool || ((def) => def)
  } catch {
    return (def) => def
  }
}

export const name = 'okf-memory'

export const inject = ['tools']

/** 会话启动预取条数 */
const PRELOAD_LIMIT = 5

/** 解析记忆库根目录(优先级:settings > env > 默认) */
function resolveRoot(ctx) {
  try {
    const s = ctx.settings?.okfMemory?.root
    if (s) return path.resolve(String(s))
  } catch { /* settings API 不可用时忽略 */ }
  return defaultRoot()
}

/** 注入系统提示片段(API 形态随 dsh 版本演进,失败不阻塞) */
function addPrompt(ctx, content, priority = 100) {
  try {
    if (ctx.systemPrompt?.add) {
      ctx.systemPrompt.add({ content, priority })
      return
    }
    if (typeof ctx.systemPrompt === 'object' && ctx.systemPrompt.register) {
      ctx.systemPrompt.register({ content, priority })
    }
  } catch { /* 无 systemPrompt 扩展点时跳过 */ }
}

/** 把根 index.md 摘要整理成提示片段(模型每轮可见"库里有啥") */
async function buildIndexPrompt(root) {
  try {
    const text = await fs.readFile(path.join(root, 'index.md'), 'utf8')
    const concepts = await scanBundle(root)
    const summary = `记忆库共有 ${concepts.length} 个概念(路径即概念 ID)。库目录:\n${text.slice(0, 3000)}`
    return summary
  } catch {
    return 'OKF 记忆库为空或不可读。'
  }
}

export async function apply(ctx) {
  const defineTool = await loadDefineTool()
  const root = resolveRoot(ctx)
  await ensureRoot(root)

  // ── 服务:ctx.okfMemory(供其他插件/工具消费) ──
  const service = {
    root,
    search: (q, opts) => search(root, q, opts),
    read: (id) => recall(root, id),
    write: (meta, body) => writeConcept(root, meta, body),
    remember: (meta, body, opts) => rememberCore(root, meta, body, opts),
    consolidate: () => consolidate(root),
    meta: () => loadMeta(root),
  }
  try {
    ctx.provide('okfMemory', service)
  } catch {
    ctx.okfMemory = service
  }
  ctx.okfMemory = service

  // ── 工具 1:okf_remember(核心:概念化→去重→写入→索引) ──
  ctx.tools.register(defineTool({
    name: 'okf_remember',
    description:
      '把一条新知识按 OKF v0.1 规范写入长期记忆库(概念文档 + index/log 更新)。' +
      'type 词表:Fact/Preference/Decision/Method/Insight/Idea/Lesson/TechChoice。' +
      'Decision/Insight 正文建议用 # 数据/# 分析/# 结论 三段式;TechChoice 用 # Options 候选表 + # Active。' +
      '写入前自动去重:标题相同则更新/跳过,相近则返回建议。',
    parameters: {
      title: { type: 'string', required: true, description: '概念标题(简洁,一句话可懂)' },
      type: { type: 'string', required: true, description: `概念类型,可选:${TYPE_VOCAB.join('/')}` },
      content: { type: 'string', required: true, description: '结构化正文(Markdown,含 # 小节标题)。Decision/Insight 传三段式;TechChoice 传 Options 表与 Active' },
      tags: { type: 'array', items: { type: 'string' }, description: '横切标签' },
      related: { type: 'array', items: { type: 'string' }, description: '相关概念 ID 列表(将互建交叉链接)' },
    },
    output: {
      schema: {
        type: 'object',
          additionalProperties: true,
        properties: {
          status: { type: 'string' },
          conceptId: { type: 'string' },
          filePath: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'created'
          ? `已沉淀记忆 ${value.conceptId}`
          : value.status === 'updated'
            ? `已更新记忆 ${value.conceptId}`
            : value.status === 'skipped'
              ? `跳过写入:${value.reason}`
              : `记忆写入:${value.status}`,
      }],
    },
    async execute(args) {
      return rememberCore(root, {
        title: args.title,
        type: args.type,
        tags: args.tags,
        related: args.related,
      }, args.content)
    },
  }))

  // ── 工具 2:okf_search(检索,命中 TechChoice 返回完整候选表) ──
  ctx.tools.register(defineTool({
    name: 'okf_search',
    description:
      '检索 OKF 长期记忆库,按唤起评分(相关度×权重×近因)排序返回概念摘要。' +
      '命中 TechChoice 类型时附加返回完整 Options 候选表,供技术选型三档规则展示。' +
      '写入新记忆前必须先搜索去重。',
    parameters: {
      query: { type: 'string', required: true, description: '检索关键词' },
      type: { type: 'string', description: '按类型过滤(如 TechChoice/Fact/Decision)' },
      tags: { type: 'array', items: { type: 'string' }, description: '按标签过滤' },
      limit: { type: 'number', description: '返回条数,默认 8' },
    },
    output: {
      schema: {
        type: 'object',
          additionalProperties: true,
        properties: {
          count: { type: 'number' },
          results: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? '记忆库无匹配。'
          : `检索到 ${value.count} 条记忆:\n` + value.results.map((r) => `- ${r.conceptId} (${r.type}, 权重 ${r.weight}) ${r.description}`).join('\n'),
      }],
    },
    async execute(args) {
      const raw = await search(root, args.query, {
        type: args.type,
        tags: args.tags,
        limit: Math.min(args.limit || 8, 30),
      })
      const ranked = await rank(root, raw)
      const results = []
      for (const h of ranked) {
        const item = { ...h }
        if (h.type === 'TechChoice') {
          // 附加候选表:读全文 Options 节
          try {
            const { body } = await readConcept(root, h.conceptId)
            const optsMatch = /## Options[\s\S]*?(?=## |$)/.exec(body || '')
            item.options = optsMatch ? optsMatch[0].trim() : null
          } catch { /* 读取失败则不带候选表 */ }
        }
        results.push(item)
      }
      return { count: results.length, results }
    },
  }))

  // ── 工具 3:okf_read(精读 + 交叉链接 + 命中反馈) ──
  ctx.tools.register(defineTool({
    name: 'okf_read',
    description: '读取记忆库中某个概念全文(含交叉链接),并记录一次使用反馈(权重更新)。',
    parameters: {
      concept_id: { type: 'string', required: true, description: '概念 ID(如 facts/meituan-data-source,可省略 .md)' },
    },
    output: {
      schema: {
        type: 'object',
          additionalProperties: true,
        properties: {
          conceptId: { type: 'string' },
          title: { type: 'string' },
          type: { type: 'string' },
          body: { type: 'string' },
          links: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `# ${value.title} (${value.type})\n\n${value.body}`,
      }],
    },
    async execute(args) {
      const id = String(args.concept_id).replace(/\.md$/, '')
      const concept = await recall(root, id)
      return {
        conceptId: concept.conceptId,
        title: concept.meta?.title || id,
        type: concept.meta?.type || '',
        body: concept.body || '',
        links: concept.links || [],
      }
    },
  }))

  // ── 工具 4:okf_forget(撤回记忆) ──
  ctx.tools.register(defineTool({
    name: 'okf_forget',
    description: '从记忆库索引撤回一条概念(默认保留文件,可从 index/log 追溯;可选删除文件)。',
    parameters: {
      concept_id: { type: 'string', required: true, description: '概念 ID' },
      delete_file: { type: 'boolean', description: 'true 时同时删除文件(默认 false 仅移出索引)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { status: { type: 'string' }, conceptId: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: `已撤回记忆 ${value.conceptId}` }],
    },
    async execute(args) {
      const id = String(args.concept_id).replace(/\.md$/, '')
      const filePath = filePathOf(root, id)
      // 移出 index:将文件移动到 .meta/forgotten/(保留可恢复)
      const forgottenDir = path.join(root, '.meta', 'forgotten')
      await fs.mkdir(forgottenDir, { recursive: true })
      const dest = path.join(forgottenDir, path.basename(filePath))
      await fs.rename(filePath, dest)
      await refreshIndex(root)
      await appendLog(root, { action: 'forgotten', conceptId: id, type: '—', title: `已撤回(移至 .meta/forgotten/)` })
      // 学习元数据:标记 inactive
      const meta = await loadMeta(root)
      if (meta.entries[id]) {
        meta.entries[id].state = 'inactive'
        await saveMeta(root, meta)
      }
      return { status: 'forgotten', conceptId: id }
    },
  }))

  // ── 系统提示注入:记忆纪律 + 库摘要 ──
  addPrompt(ctx, MEMORY_DISCIPLINE, 50)
  const indexPrompt = await buildIndexPrompt(root)
  addPrompt(ctx, indexPrompt, 150)

  // ── 会话启动预取:监听 agent/request 首轮,注入相关记忆摘要 ──
  try {
    ctx.on('agent/request', async (info) => {
      try {
        const agent = info?.agent || info?.session?.agent
        const firstMsg = info?.messages?.[0]?.content || info?.message?.content
        if (!firstMsg) return
        const q = String(firstMsg).slice(0, 200)
        const hits = await preload(root, q, { limit: PRELOAD_LIMIT })
        if (hits.length === 0) return
        const text = `记忆预取(与当前消息相关,按需用 okf_read 精读):\n` + hits
          .map((h) => `- ${h.conceptId} (${h.type}) ${h.description}`)
          .join('\n')
        if (agent?.inject) {
          await agent.inject({ content: text, source: { kind: 'plugin', plugin: 'okf-memory' } })
        }
      } catch { /* 预取失败不影响主流程 */ }
    })
  } catch { /* 事件 API 形态随版本变化,忽略 */ }

  // 卸载时清理权重会话态(可选)
  return () => {
    /* 无全局副作用需回滚;注册均为 effect-based,自动撤销 */
  }
}

/**
 * remember 核心逻辑(服务与工具共用):去重决策 → 写入/更新 → 反馈。
 */
async function rememberCore(root, meta, body, opts = {}) {
  const { title, type, tags, related } = meta
  if (!title || !type || !body) throw new Error('title/type/content 必填')

  // 去重
  const similar = await findSimilarByTitle(root, title, type)
  if (similar.length > 0) {
    const top = similar[0]
    if (top.similarity >= 1) {
      // 标题完全相同 → 更新(刷新 timestamp + 追加小节)或跳过
      const existing = await readConcept(root, top.conceptId)
      const existingLen = String(existing.body || '').trim().length
      const newLen = String(body || '').trim().length
      if (newLen > existingLen * 0.7 && opts.force !== false) {
        const mergedBody = `${existing.body?.trim() || ''}\n\n## 补充(${new Date().toISOString().slice(0, 10)})\n\n${body.trim()}`
        const res = await writeConcept(root, {
          ...existing.meta, title, type, tags: tags || existing.meta.tags, timestamp: new Date().toISOString(),
        }, mergedBody)
        return { status: 'updated', conceptId: res.conceptId, filePath: res.filePath, reason: '标题相同,内容追加合并' }
      }
      return { status: 'skipped', conceptId: top.conceptId, reason: `标题相同的概念已存在(${existingLen}字),新内容(${newLen}字)未显著增加` }
    }
    // 相近 → 建议互补
    return {
      status: 'linked',
      conceptId: top.conceptId,
      reason: `存在相近概念[${top.title}](${top.conceptId}),已返回其 ID;建议新建后与该概念互建交叉链接,而非复制内容`,
      similarTo: top.conceptId,
    }
  }

  // 新建
  const res = await writeConcept(root, {
    type,
    title,
    description: opts.description || String(body).split('\n').find((l) => l.trim().startsWith('>'))?.replace(/^>\s*/, '').trim() || firstLine(body),
    tags: tags || [],
    timestamp: new Date().toISOString(),
    source: opts.source || 'session',
  }, body)
  // 互建交叉链接(related)
  if (Array.isArray(related) && related.length > 0) {
    for (const rid of related) {
      try {
        const r = await readConcept(root, String(rid).replace(/\.md$/, ''))
        const linkLine = `\n\n## 相关\n\n- [${title}](/${res.conceptId}.md)`
        if (!(r.body || '').includes(res.conceptId)) {
          await writeConcept(root, { ...r.meta, timestamp: new Date().toISOString() }, `${r.body?.trim() || ''}${linkLine}`)
        }
      } catch { /* 相关概念不存在则忽略 */ }
    }
  }
  return { status: 'created', conceptId: res.conceptId, filePath: res.filePath, reason: '新建' }
}

function firstLine(s) {
  const line = String(s || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
  return line ? line.slice(0, 120) : ''
}
