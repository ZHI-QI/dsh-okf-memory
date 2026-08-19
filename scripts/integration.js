/**
 * 集成测试(临时):mock dsh Cordis ctx,验证插件 apply() 注册服务/工具/提示词,
 * 并直接调用四个工具 execute 验证全链路。
 * 用法:node scripts/integration.js [临时记忆库根]
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(__dirname, '..', 'lib')
const root = process.argv[2] || path.join(os.tmpdir(), `okf-int-${Date.now()}`)
process.env.OKF_MEMORY_ROOT = root

let pass = 0
let fail = 0
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

// ── mock Cordis ctx ──
const registeredTools = []
const promptParts = []
const events = {}
const ctx = {
  settings: {},
  tools: {
    register(def) { registeredTools.push(def) },
  },
  provide(name, impl) { this[name] = impl },
  on(event, fn) { events[event] = fn },
  systemPrompt: {
    section({ name, order, text }) { promptParts.push({ name, order, text }) },
  },
}

// 加载插件(与 dsh 加载器一致:apply 的返回值是 dispose)
const mod = await import(pathToFileURL(path.join(lib, 'index.js')).href)
assert('插件导出 name', mod.name === 'okf-memory')
assert('插件导出 apply', typeof mod.apply === 'function')

const dispose = await mod.apply(ctx)
assert('apply 执行完成', !!ctx.okfMemory)

// 服务
assert('服务暴露 root', ctx.okfMemory.root === root)
assert('服务有 search/read/write', typeof ctx.okfMemory.search === 'function' && typeof ctx.okfMemory.write === 'function')

// 工具注册
assert('注册 4 个工具', registeredTools.length === 4)
const byName = Object.fromEntries(registeredTools.map((t) => [t.name, t]))
assert('okf_remember 已注册', !!byName.okf_remember)
assert('okf_search 已注册', !!byName.okf_search)
assert('okf_read 已注册', !!byName.okf_read)
assert('okf_forget 已注册', !!byName.okf_forget)

// 系统提示
assert('注入记忆纪律', promptParts.some((p) => (p.text || '').includes('记忆纪律')))
assert('注入库摘要', promptParts.some((p) => (p.text || '').includes('OKF 记忆库')))

// ── 通过工具 execute 走全链路 ──
const remember = byName.okf_remember
const searchTool = byName.okf_search
const readTool = byName.okf_read
const forgetTool = byName.okf_forget

// 1. remember 普通概念
let r = await remember.execute({ title: '门店布局', type: 'Fact', content: '# 核心\n\n三家门店共用局域网共享文件夹。\n\n## 细节\n- 韶山店\n- 湘乡店\n- 塘厦店', tags: ['门店'] })
assert('remember 创建 Fact', r.status === 'created' && r.conceptId === 'fact/门店布局', JSON.stringify(r))

// 2. remember Decision 三段式
r = await remember.execute({
  title: '数据源确定', type: 'Decision',
  content: '# 数据\n\n美团 API / 企微报账 / 财务本地。\n\n# 分析\n\n美团是经营确定源。\n\n# 结论\n\n以美团为确定源,企微对账去重。',
})
assert('remember 创建 Decision', r.status === 'created' && r.conceptId === 'decision/数据源确定')

// 3. remember TechChoice
r = await remember.execute({
  title: '前端方案', type: 'TechChoice',
  content: '## Options\n\n| 候选 | 说明 | 配置要点 | 状态 |\n|---|---|---|---|\n| React 18 + Vite | 主力 | node22/pnpm | active |\n| Vue 3 | 遗留 | 维护中 | candidate |\n\n## Active\n\n- 当前使用:React 18 + Vite',
  tags: ['前端', '技术选型'],
})
assert('remember 创建 TechChoice', r.status === 'created' && r.conceptId === 'techchoice/前端方案')

// 4. 重复写入 → skip/update
r = await remember.execute({ title: '门店布局', type: 'Fact', content: '# 核心\n\n一句话。' })
assert('重复标题走 skip/update', r.status === 'skipped' || r.status === 'updated', JSON.stringify(r))

// 5. search
let s = await searchTool.execute({ query: '门店' })
assert('search 命中', s.count >= 1 && s.results[0].conceptId.includes('门店'), JSON.stringify(s))

// 6. search TechChoice 带 options
s = await searchTool.execute({ query: '前端', type: 'TechChoice' })
assert('search TechChoice 返回候选表', s.count === 1 && !!s.results[0].options && s.results[0].options.includes('React'), JSON.stringify(s.results[0]))

// 7. read + 权重反馈
const rd = await readTool.execute({ concept_id: 'fact/门店布局' })
assert('read 返回全文', rd.conceptId === 'fact/门店布局' && rd.body.includes('韶山'))
const metaAfter = await ctx.okfMemory.meta()
assert('read 记录权重反馈', metaAfter.entries['fact/门店布局'].accessCount >= 1)

// 8. forget
const fg = await forgetTool.execute({ concept_id: 'fact/门店布局' })
assert('forget 撤回', fg.status === 'forgotten')
const s2 = await searchTool.execute({ query: '门店' })
assert('forget 后检索不到', s2.count === 0, JSON.stringify(s2))

// 9. index/log 完整性
const indexText = await fs.readFile(path.join(root, 'index.md'), 'utf8')
assert('index 不含已撤回概念', !indexText.includes('fact/门店布局'))
const logText = await fs.readFile(path.join(root, 'log.md'), 'utf8')
assert('log 含 forgotten 记录', logText.includes('forgotten'))

console.log(`\n结果:${pass} 通过,${fail} 失败`)
if (typeof dispose === 'function') dispose()
if (fail > 0) process.exit(1)
console.log('记忆库 index:')
console.log(await fs.readFile(path.join(root, 'index.md'), 'utf8'))
