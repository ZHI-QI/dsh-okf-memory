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
  ensureRoot, writeConcept, readConcept, refreshIndex, appendLog, defaultRoot, filePathOf, scanBundle, withLock,
} from './store.js'
import { search, findSimilarByTitle } from './dedupe.js'
import { preload, recall } from './recall.js'
import { loadMeta, saveMeta, recordSelect, recordSkip, consolidate, rank, startConsolidation } from './learning.js'
import { MEMORY_DISCIPLINE, RECALL_GUIDE } from './capture.js'
import { buildDecisionBody, buildTechChoiceBody, TYPE_VOCAB, slugify, normalizeType, mergeConceptBodies } from './concept.js'
import { buildGraph } from './graph.js'

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

export const inject = ['tools', 'systemPrompt', 'webServer']

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

/**
 * 注入系统提示片段(正确 API:dsh-system-prompt 的 section,字段 name/order/text。
 * 之前误用 add() 静默失效;不能用 register()。失败时静默跳过,不阻塞插件加载)。
 */
function addPrompt(ctx, name, content, order) {
  try {
    if (ctx.systemPrompt?.section) {
      ctx.systemPrompt.section({ name, order, text: content })
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
    // P1-8:预测性预取(供其他插件/后续瀑布接线用;会话开场可先 service.preload 粗筛)
    preload: (query, opts) => preload(root, query, opts),
    // 记忆图谱 JSON(供可视化前端/服务消费)
    graph: (opts) => buildGraph(root, opts),
  }
  try {
    ctx.provide('okfMemory', service)
  } catch {
    ctx.okfMemory = service
  }
  ctx.okfMemory = service

  // ── Web 路由:/okf-graph 供 client 插件 fetch 记忆图谱 JSON(M2) ──
  if (ctx.webServer?.register) {
    try {
      ctx.webServer.register({
        name: 'okf-memory-graph',
        kind: 'exact',
        path: '/okf-graph',
        handler: async (req, res) => {
          try {
            const g = await buildGraph(root)
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(g))
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: String(e.message || e) }))
          }
        },
      })
    } catch {
      /* webServer 仅在 web profile 存在,desktop 等无 webServer 时静默跳过 */
    }
  }

  // ── 工具 1:okf_remember(核心:概念化→去重→写入→索引) ──
  ctx.tools.register(defineTool({
    name: 'okf_remember',
    description:
      '把一条新知识按 OKF v0.1 规范写入长期记忆库(概念文档 + index/log 更新)。' +
      'type 词表:Fact/Preference/Decision/Method/Insight/Idea/Lesson/TechChoice。' +
      'Decision/Insight 正文建议用 # 数据/# 分析/# 结论 三段式;TechChoice 用 # Options 候选表 + # Active。' +
      '写入前自动去重:标题相同则更新/跳过,相近则返回建议。' +
      'Write a new piece of knowledge into the long-term memory library as an OKF v0.1 concept (updates index/log). ' +
      'Types: Fact/Preference/Decision/Method/Insight/Idea/Lesson/TechChoice. Deduplicates automatically: same title → update or skip; similar → returns suggestion.',
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
        text: value.status === 'error'
          ? `记忆写入失败:${value.reason}`
          : value.status === 'created'
            ? `已沉淀记忆 ${value.conceptId}`
            : value.status === 'updated'
              ? `已更新记忆 ${value.conceptId}`
              : value.status === 'skipped'
                ? `跳过写入:${value.reason}`
                : `记忆写入:${value.status}`,
      }],
    },
    async execute(args) {
      try {
        return await rememberCore(root, {
          title: args.title,
          type: args.type,
          tags: args.tags,
          related: args.related,
        }, args.content)
      } catch (e) {
        return { status: 'error', conceptId: null, reason: String(e.message || e) }
      }
    },
  }))

  // ── 工具 2:okf_search(检索,命中 TechChoice 返回完整候选表) ──
  ctx.tools.register(defineTool({
    name: 'okf_search',
    description:
      '检索 OKF 长期记忆库,按唤起评分(相关度×权重×近因)排序返回概念摘要。' +
      '命中 TechChoice 类型时附加返回完整 Options 候选表,供技术选型三档规则展示。' +
      '写入新记忆前必须先搜索去重。' +
      'Search the OKF long-term memory library, returning concept summaries ranked by recall score (relevance × weight × recency). ' +
      'TechChoice hits additionally return the full Options table. Always search before writing new memory.',
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
          results: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
    description:
      '读取记忆库中某个概念全文(含交叉链接),并记录一次使用反馈(权重更新)。' +
      'Read a full concept from the memory library (with cross-links) and record one usage feedback (weight update).',
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
          links: { type: 'array', items: { type: 'object', additionalProperties: true } },
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

  // ── 工具 5:okf_graph(导出记忆图谱 JSON,供可视化前端) ──
  ctx.tools.register(defineTool({
    name: 'okf_graph',
    description:
      '导出记忆库的图谱 JSON:nodes(概念:title/type/tags/weight/state)+edges(交叉链接)+timeline(权重历史)。' +
      '供图谱可视化前端渲染,契约稳定。' +
      'Export the memory graph JSON: nodes (concepts: title/type/tags/weight/state) + edges (cross-links) + timeline (weight history).',
    parameters: {
      limit: { type: 'number', description: '可选:节点上限,默认全部' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { meta: { type: 'object', additionalProperties: true }, nodes: { type: 'array', items: { type: 'object', additionalProperties: true } }, edges: { type: 'array', items: { type: 'object', additionalProperties: true } }, timeline: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      render: (_args, value) => [{
        type: 'text',
        text: `记忆图谱:${value.nodes?.length || 0} 节点 · ${value.edges?.length || 0} 边 · ${value.timeline?.length || 0} 权重历史`,
      }],
    },
    async execute(args) {
      const g = await buildGraph(root)
      if (args.limit && args.limit > 0) g.nodes = g.nodes.slice(0, Math.min(args.limit, 500))
      return { meta: g.meta, nodes: g.nodes, edges: g.edges, timeline: g.timeline }
    },
  }))

  // ── 工具 4:okf_forget(撤回记忆) ──
  ctx.tools.register(defineTool({
    name: 'okf_forget',
    description:
      '从记忆库索引撤回一条概念(默认保留文件,可从 index/log 追溯;可选删除文件)。' +
      'Withdraw a concept from the memory library index (keeps the file by default, traceable via index/log; optionally deletes the file).',
    parameters: {
      concept_id: { type: 'string', required: true, description: '概念 ID' },
      delete_file: { type: 'boolean', description: 'true 时同时删除文件(默认 false 仅移出索引)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { status: { type: 'string' }, conceptId: { type: 'string' }, reason: { type: 'string' } } },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'forgotten'
          ? `已撤回记忆 ${value.conceptId}${value.reason ? `(${value.reason})` : ''}`
          : value.status === 'not_found'
            ? `记忆 ${value.conceptId} 不存在或已撤回`
            : `撤回失败:${value.reason || value.status}`,
      }],
    },
    async execute(args) {
      const id = String(args.concept_id).replace(/\.md$/, '')
      try {
        return await forgetCore(root, id, args.delete_file === true)
      } catch (e) {
        return { status: 'error', conceptId: id, reason: String(e.message || e) }
      }
    },
  }))

  // ── 系统提示注入:记忆纪律 + 库摘要 + 召回指引(用正确的 section API) ──
  addPrompt(ctx, 'okf-memory-discipline', MEMORY_DISCIPLINE, 50)
  const indexPrompt = await buildIndexPrompt(root)
  addPrompt(ctx, 'okf-memory-index', indexPrompt, 150)
  // P1-8:召回指引(低优先级,提示用 okf_read 取细节)
  addPrompt(ctx, 'okf-memory-recall-guide', RECALL_GUIDE, 160)

  // ── 预取增强(暂移除) ──
  // 之前用 ctx.on('agent/request', ...) 做会话预取,但 agent/request 是瀑布事件,
  // 监听器必须调用 next() 委托;未正确实现会卡死模型请求链,导致
  // "Cannot read properties of undefined (reading 'provider')"。
  // 预取是增强功能,先移除保稳定;后续按瀑布事件规范(带 next())重新实现。

  // 卸载时清理:停掉巩固定时器(注册均为 effect-based,自动撤销)
  const stopConsolidation = startConsolidation(root)
  return () => {
    stopConsolidation()
  }
}

/**
 * remember 核心(服务与工具共用):类型校验 → 去重 → 小节级合并/新建 → 反馈。
 * 全程持写锁,保证"判断→写入"原子,避免并发下同标题概念被重复创建。
 */
async function rememberCore(root, meta, body, opts = {}) {
  return withLock(async () => {
    const { title, type, tags, related } = meta
    if (!title || !body) throw new Error('title/content 必填')
    // P0-4:类型归一化 + 词表校验(非法类型不得新建污染目录)
    const normType = normalizeType(type)

    // 去重
    const similar = await findSimilarByTitle(root, title, normType)
    if (similar.length > 0) {
      const top = similar[0]
      if (top.similarity >= 1) {
        // 标题完全相同 → 更新(小节级合并)或跳过
        const existing = await readConcept(root, top.conceptId)
        const existingLen = String(existing.body || '').trim().length
        const newLen = String(body || '').trim().length
        if (newLen > existingLen * 0.7 && opts.force !== false) {
          // P0-5:按 # 小节合并:同小节覆盖、新小节追加,不再无限 "## 补充(日期)"
          const mergedBody = mergeConceptBodies(existing.body || '', body)
          const res = await writeConcept(root, {
            ...existing.meta, title, type: normType, tags: tags || existing.meta.tags, timestamp: new Date().toISOString(),
          }, mergedBody)
          return { status: 'updated', conceptId: res.conceptId, filePath: res.filePath, reason: '标题相同,按小节合并更新' }
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
      type: normType,
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
  })
}

/**
 * forget 核心:概念不存在返回 not_found;默认移到 .meta/forgotten/(保留目录结构防同名冲突),
 * delete_file=true 时直接删除文件。全程持写锁。
 */
async function forgetCore(root, id, deleteFile) {
  return withLock(async () => {
    const filePath = filePathOf(root, id)
    let exists = true
    try {
      await fs.access(filePath)
    } catch {
      exists = false
    }
    if (!exists) {
      return { status: 'not_found', conceptId: id, reason: '概念不存在(可能已撤回)' }
    }
    if (deleteFile) {
      await fs.rm(filePath, { force: true })
    } else {
      // 保留相对目录结构,避免同 slug 概念在 forgotten 里撞文件
      const forgottenDir = path.join(root, '.meta', 'forgotten')
      const dest = path.join(forgottenDir, path.relative(root, filePath))
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.rename(filePath, dest)
    }
    await refreshIndex(root)
    await appendLog(root, {
      action: deleteFile ? 'forgotten(deleted)' : 'forgotten',
      conceptId: id,
      type: '—',
      title: deleteFile ? '已删除文件' : '已移至 .meta/forgotten/',
    })
    // 学习元数据:标记 inactive(可复活)
    const meta = await loadMeta(root)
    if (meta.entries[id]) {
      meta.entries[id].state = 'inactive'
      await saveMeta(root, meta)
    }
    return { status: 'forgotten', conceptId: id, reason: deleteFile ? '已删除文件' : '已移至 .meta/forgotten/' }
  })
}

function firstLine(s) {
  const line = String(s || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
  return line ? line.slice(0, 120) : ''
}
