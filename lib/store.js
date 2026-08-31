/**
 * store.js — OKF bundle 存储:根目录初始化、概念落盘、index.md 渐进式目录、log.md 变更历史。
 * 路径即概念 ID:<root>/<type小写>/<kebab-id>.md
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseFrontmatter, validateConcept, slugify } from './concept.js'

/**
 * 进程内写锁(可重入):串行化对 bundle 文件(index.md/log.md/概念/weights.json)的读-改-写,
 * 避免多会话并发写入时丢失更新。Cordis 单进程内生效,跨进程不保证。
 */
let writeQueue = Promise.resolve()
let lockDepth = 0
export function withLock(fn) {
  // 已在锁内(可重入):直接执行,避免嵌套自锁死锁
  if (lockDepth > 0) return Promise.resolve().then(fn)
  const run = writeQueue.then(async () => {
    lockDepth = 1
    try {
      return await fn()
    } finally {
      lockDepth = 0
    }
  })
  writeQueue = run.then(() => {}, () => {})
  return run
}

/** 默认记忆库根目录(可被 OKF_MEMORY_ROOT 环境变量覆盖) */
export function defaultRoot() {
  return process.env.OKF_MEMORY_ROOT || path.join(os.homedir(), '.dsh', 'memory')
}

/** 概念文件路径 → 概念 ID(相对根,去扩展名,正斜杠归一) */
export function conceptIdOf(filePath, root) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/').replace(/\.md$/, '')
  return rel
}

/** 概念 ID → 文件路径(含安全校验:防路径穿越) */
export function filePathOf(root, conceptId) {
  const norm = String(conceptId || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const resolved = path.resolve(root, ...norm.split('/'))
  const rootResolved = path.resolve(root)
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new Error(`非法 concept_id(路径穿越):${conceptId}`)
  }
  return resolved.endsWith('.md') ? resolved : `${resolved}.md`
}

/** 确保记忆库骨架存在(根 index.md + log.md) */
export async function ensureRoot(root) {
  await fs.mkdir(root, { recursive: true })
  const indexPath = path.join(root, 'index.md')
  const logPath = path.join(root, 'log.md')
  try {
    await fs.access(indexPath)
  } catch {
    await fs.writeFile(
      indexPath,
      [
        '---',
        'type: Bundle Root',
        'title: OKF 记忆库',
        'description: dsh-okf-memory 会话记忆沉淀库(OKF v0.1)',
        'okf_version: "0.1"',
        '---',
        '',
        '# OKF 记忆库',
        '',
        '由 dsh-okf-memory 插件维护。概念按类型分目录,路径即概念 ID。',
        '',
      ].join('\n'),
      'utf8',
    )
  }
  try {
    await fs.access(logPath)
  } catch {
    await fs.writeFile(
      logPath,
      '---\ntype: Log\ntitle: 变更历史\n---\n\n# 变更历史\n\n',
      'utf8',
    )
  }
}

/** 读取并解析概念文档(校验概念 ID 安全) */
export async function readConcept(root, conceptId) {
  const filePath = filePathOf(root, conceptId)
  const text = await fs.readFile(filePath, 'utf8')
  const { meta, body } = parseFrontmatter(text)
  return { filePath, conceptId: conceptIdOf(filePath, root), meta, body, text }
}

/** 写概念文档(先做符合性校验,再落盘,更新 index/log) */
export async function writeConcept(root, meta, body) {
  return withLock(async () => {
    const { buildConcept } = await import('./concept.js')
    const md = buildConcept(meta, body)
    const check = validateConcept(md)
    if (!check.ok) throw new Error(`OKF 符合性校验失败:${check.errors.join('; ')}`)

    // type 目录用 slug 化命名:防路径穿越(如 type="../../x")与非法字符
    const typeDir = slugify(meta.type) || 'other'
    const dir = path.join(root, typeDir)
    await fs.mkdir(dir, { recursive: true })

    const base = slugify(meta.title || meta.type || 'untitled')
    const filePath = path.join(dir, `${base}.md`)

    // 同路径已有内容 → 更新(timestamp 刷新),否则新建
    let action = 'created'
    try {
      await fs.access(filePath)
      action = 'updated'
    } catch {
      /* new */
    }
    await fs.writeFile(filePath, md, 'utf8')
    const conceptId = conceptIdOf(filePath, root)
    await refreshIndex(root)
    await appendLog(root, { action, conceptId, type: meta.type, title: meta.title })
    return { action, conceptId, filePath }
  })
}

/** 全库扫描:返回所有概念文档清单(用于 index 重建与检索) */
export async function scanBundle(root) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.')) continue
    const dir = path.join(root, e.name)
    let files
    try {
      files = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const filePath = path.join(dir, f)
      const conceptId = conceptIdOf(filePath, root)
      out.push({ filePath, conceptId, typeDir: e.name })
    }
  }
  return out
}

/** 重建根 index.md(渐进式目录:按类型分组列概念;写锁内串行,防并发覆盖丢失) */
export async function refreshIndex(root) {
  return withLock(async () => {
    const concepts = await scanBundle(root)
    const byType = new Map()
    for (const c of concepts) {
      if (!byType.has(c.typeDir)) byType.set(c.typeDir, [])
      byType.get(c.typeDir).push(c.conceptId)
    }
    const lines = [
      '---',
      'type: Bundle Root',
      'title: OKF 记忆库',
      'description: dsh-okf-memory 会话记忆沉淀库(OKF v0.1)',
      'okf_version: "0.1"',
      '---',
      '',
      '# OKF 记忆库',
      '',
      `共 ${concepts.length} 个概念。路径即概念 ID,交叉链接用包内绝对路径。`,
      '',
    ]
    for (const [typeDir, ids] of [...byType.entries()].sort()) {
      lines.push(`## ${typeDir}`, '')
      for (const id of [...ids].sort()) {
        lines.push(`- [${id}](/${id}.md)`)
      }
      lines.push('')
    }
    if (byType.size === 0) lines.push('(空库 — 在会话中说"记住这个",即可沉淀第一条记忆)', '')
    await fs.writeFile(path.join(root, 'index.md'), lines.join('\n'), 'utf8')
  })
}

/** 追加 log.md 变更记录(## YYYY-MM-DD 分组;写锁内串行) */
export async function appendLog(root, entry) {
  return withLock(async () => {
    const logPath = path.join(root, 'log.md')
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    const time = now.toISOString().slice(11, 19)
    let text = ''
    try {
      text = await fs.readFile(logPath, 'utf8')
    } catch {
      text = '---\ntype: Log\ntitle: 变更历史\n---\n\n# 变更历史\n\n'
    }
    const marker = `## ${date}`
    const line = `- ${time} — ${entry.action} [${entry.conceptId}](${entry.conceptId}.md) (${entry.type}${entry.title ? ` · ${entry.title}` : ''})`
    if (text.includes(marker)) {
      text = `${text.replace(/\s*$/, '')}\n${line}\n`
    } else {
      text = `${text.replace(/\s*$/, '')}\n${marker}\n\n${line}\n`
    }
    await fs.writeFile(logPath, text, 'utf8')
  })
}
