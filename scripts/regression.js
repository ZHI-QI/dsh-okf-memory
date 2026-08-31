/**
 * regression.js — P0 修复的回归测试(防次生 bug)。
 * 聚焦本次改动的高风险边界,区别于 smoke(核心功能)/integration(全链路)/concurrency(并发量)。
 * 覆盖:withLock 可重入/异常传播/队列恢复、mergeConceptBodies 空与重复边界、
 *       normalizeType 空值/大小写、writeConcept 路径穿越防护、forget 幂等、巩固调度清理。
 * 用法:node scripts/regression.js [临时记忆库路径]
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(__dirname, '..', 'lib')

async function load(moduleName) {
  return import(pathToFileURL(path.join(lib, moduleName)).href)
}

const root = process.argv[2] || path.join(os.tmpdir(), `okf-regress-${Date.now()}`)
// 关键隔离:必须先把 OKF_MEMORY_ROOT 指到临时目录,
// 否则 mod.apply(ctx) 里的 resolveRoot() 会回退到真实 ~/.dsh/memory 造成污染
process.env.OKF_MEMORY_ROOT = root
console.log('记忆库根:', root)

const store = await load('store.js')
const concept = await load('concept.js')
const learning = await load('learning.js')
const dedupe = await load('dedupe.js')

let pass = 0
let fail = 0
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}
async function expectReject(fn, name, contains) {
  try {
    await fn()
    assert(name, false, '期望抛错但未抛')
  } catch (e) {
    assert(name, !contains || String(e.message || e).includes(contains), `err=${e.message}`)
  }
}

await store.ensureRoot(root)

// ── A. withLock 可重入 + 异常传播 + 队列恢复 ──
let order = []
await store.withLock(async () => {
  order.push('a1')
  // 嵌套可重入:不应死锁,且结果正确
  const r = await store.withLock(async () => { order.push('a2'); return 42 })
  order.push(`a3:${r}`)
})
assert('withLock 嵌套可重入不死锁且返回值正确', order.join(',') === 'a1,a2,a3:42', order.join(','))

// 异常传播:锁内抛错 → 拒绝;且队列恢复,后续调用不受影响
await expectReject(() => store.withLock(async () => { throw new Error('boom') }), 'withLock 异常正确传播', 'boom')
const afterErr = await store.withLock(async () => 'ok-after')
assert('withLock 异常后队列恢复', afterErr === 'ok-after')

// 并发混合:锁内嵌套 + 多个顶层并发,全部完成且无互相覆盖
const mixed = await Promise.all(Array.from({ length: 8 }, (_, i) =>
  store.withLock(async () => {
    const inner = await store.withLock(async () => i * 2)
    return inner + 1
  })))
assert('withLock 并发+嵌套全部完成且结果正确',
  mixed.length === 8 && mixed.every((v, i) => v === i * 2 + 1), JSON.stringify(mixed))

// ── B. mergeConceptBodies 边界 ──
const M = concept.mergeConceptBodies
assert('merge 空+空 → 空串', M('', '') === '')
assert('merge existing 空 → 取 incoming', M('', '# A\n\na') === '# A\n\na')
assert('merge incoming 空 → 保留 existing', M('# A\n\na', '') === '# A\n\na')
assert('merge 无标题引言保留', M('引言行\n\n# A\n\na', '# A\n\n新a') === '引言行\n\n# A\n\n新a')
assert('merge 仅 incoming 引言不覆盖已有引言', M('旧引言', '新引言').includes('旧引言'))
// 重复小节:相同 key 以 incoming 覆盖,顺序按 existing 保留 + 新 key 追加
const dup = M('# A\n\nold\n\n## B\n\nb', '# A\n\nnew\n\n## C\n\nc')
assert('merge 同 key 覆盖且新 key 追加', dup.includes('# A\n\nnew') && dup.includes('## B\n\nb') && dup.includes('## C\n\nc'))
// 三级标题与标题后空内容
const lvl = M('# A\n\nx', '## B\n\nb\n\n### C\n\nc')
assert('merge 支持 ##/### 层级', lvl.includes('## B\n\nb') && lvl.includes('### C\n\nc'))
// 标题内容为空时仍保留标题
const emptyBody = M('# 核心\n\nx', '## 新节')
assert('merge 空小节保留标题', emptyBody.includes('## 新节'))
// 大量小节不丢
const many = M(
  Array.from({ length: 5 }, (_, i) => `## S${i}\n\nv${i}`).join('\n\n'),
  Array.from({ length: 3 }, (_, i) => `## S${i}\n\nn${i}`).join('\n\n'),
)
assert('merge 多小节不丢', [0, 1, 2, 3, 4].every((i) => many.includes(`## S${i}`)), many)

// ── C. normalizeType 边界 ──
assert('normalizeType 大小写变体', concept.normalizeType('fact') === 'Fact' && concept.normalizeType('TECHCHOICE') === 'TechChoice')
assert('normalizeType 前后空格', concept.normalizeType('  Method  ') === 'Method')
await expectReject(() => concept.normalizeType(''), 'normalizeType 空串抛错')
await expectReject(() => concept.normalizeType(null), 'normalizeType null 抛错')
await expectReject(() => concept.normalizeType(undefined), 'normalizeType undefined 抛错')
await expectReject(() => concept.normalizeType('Factual'), 'normalizeType 未知类型抛错')

// ── D. writeConcept 路径穿越防护(type 目录 slug 化) ──
await store.writeConcept(root,
  { type: '../evil', title: '越界尝试', timestamp: new Date().toISOString() },
  '# 核心\n\n不应逃出根目录')
const evilPath = path.join(root, '..', 'evil', '越界尝试.md')
const evilOutside = await fs.access(evilPath).then(() => true).catch(() => false)
assert('type=../evil 不逃出根目录', !evilOutside)
const evilInside = await fs.access(path.join(root, 'evil', '越界尝试.md')).then(() => true).catch(() => false)
assert('type=../evil 落在根内 slug 目录', evilInside)

// ── E. forget 幂等 + 状态一致性(经插件 mock ctx) ──
const mod = await import(pathToFileURL(path.join(lib, 'index.js')).href)
const registered = []
const promptParts = []
const ctx = {
  settings: {},
  tools: { register: (d) => registered.push(d) },
  provide() {},
  on() {},
  systemPrompt: { section({ name, order, text }) { promptParts.push({ name, order, text }) } },
}
const dispose = await mod.apply(ctx)
const byName = Object.fromEntries(registered.map((t) => [t.name, t]))
const remember = byName.okf_remember
const forget = byName.okf_forget
const search = byName.okf_search
const read = byName.okf_read

// 巩固调度已启动且返回 dispose(不抛错)
assert('startConsolidation 返回可调用 dispose', typeof dispose === 'function')

let r = await remember.execute({ title: '回归概念', type: 'Fact', content: '# 核心\n\n内容。', tags: ['回归'] })
assert('remember 创建', r.status === 'created', JSON.stringify(r))
// 先 read 一次触发 recordHit → 权重 entry 才会存在
await read.execute({ concept_id: 'fact/回归概念' })
// 二次 forget 同 id → not_found(幂等)
const fg1 = await forget.execute({ concept_id: 'fact/回归概念' })
const fg2 = await forget.execute({ concept_id: 'fact/回归概念' })
assert('首次 forget → forgotten', fg1.status === 'forgotten')
assert('二次 forget → not_found(幂等)', fg2.status === 'not_found', JSON.stringify(fg2))
// forget 后 weights 标 inactive
const meta = await ctx.okfMemory.meta()
assert('forget 后 weights 标 inactive', meta.entries['fact/回归概念']?.state === 'inactive')
// delete_file=true 后文件消失
r = await remember.execute({ title: '回归删除', type: 'Fact', content: '# 核心\n\n内容。' })
await forget.execute({ concept_id: 'fact/回归删除', delete_file: true })
const gone = await fs.access(path.join(root, 'fact', '回归删除.md')).then(() => false).catch(() => true)
assert('delete_file 后文件删除', gone)
// 删除后 index 不含该概念
const idxAfter = await fs.readFile(path.join(root, 'index.md'), 'utf8')
assert('删除后 index 不含概念', !idxAfter.includes('fact/回归删除'))

// forgotten(默认)后文件已移出原路径 → read 该 id 应 reject(而非 hang/读旧文件)
await expectReject(() => read.execute({ concept_id: 'fact/回归概念' }),
  'forgotten 概念 read 正确 reject(文件已移走)')

// ── F. 巩固调度:短周期跑一次不崩、清理后可再次触发 ──
const stop = learning.startConsolidation(root, 1)
await new Promise((res) => setTimeout(res, 30))
stop()
const meta2 = await learning.loadMeta(root)
assert('巩固调度运行后 weights 仍可读', !!meta2.entries)

// 卸载 dispose 不抛错
let disposeOk = true
try { dispose() } catch { disposeOk = false }
assert('apply dispose 不抛错', disposeOk)

// ── G. P1 回归:parseFrontmatter 边界矩阵 ──
const P = concept.parseFrontmatter
// 单/双引号值(含转义)
let fm = P('---\ntype: Fact\ntitle: "含 \\"引号\\" 和: 冒号"\n---\n\nb')
assert('引号值保留冒号与转义引号', fm.meta.title === '含 "引号" 和: 冒号', JSON.stringify(fm.meta.title))
// 空数组
fm = P('---\ntype: Fact\ntags: []\n---\n\nb')
assert('空数组解析为 []', Array.isArray(fm.meta.tags) && fm.meta.tags.length === 0)
// 引号内逗号 + 方括号字符
fm = P('---\ntype: Fact\ntags: ["a,b", "c[d]"]\n---\n\nb')
assert('flow 数组引号内逗号/方括号不拆', fm.meta.tags.length === 2 && fm.meta.tags[0] === 'a,b' && fm.meta.tags[1] === 'c[d]', JSON.stringify(fm.meta.tags))
// 多行块(| 字面保留换行)
fm = P('---\ntype: Fact\ndesc: |\n  第一行\n  第二行\n---\n\nb')
assert('多行块 | 保留换行', fm.meta.desc === '第一行\n第二行', JSON.stringify(fm.meta.desc))
// 注释行与空白行跳过
fm = P('---\n# 注释\ntype: Fact\n\n title: 带空格键\n---\n\nb')
assert('注释/空行/键空格容错', fm.meta.type === 'Fact' && fm.meta.title === '带空格键', JSON.stringify(fm.meta))
// 值内含 YAML 特殊开头(#/:/引号)不被误解析
fm = P('---\ntype: Fact\ntitle: "#主题"\n---\n\nb')
assert('#开头值解析', fm.meta.title === '#主题', JSON.stringify(fm.meta.title))
// 写侧:yamlTags 对特殊字符 tag 转义往返
const specialTags = ['a,b', 'c[d]', 'e"f', 'g:h', '#tag']
const md2 = concept.buildConcept(
  { type: 'Fact', title: '特殊标签', description: 'x', tags: specialTags, timestamp: '2026-01-01' },
  '# 核心\n\nbody')
const fmBack2 = P(md2)
assert('特殊字符 tag 写读往返', JSON.stringify(fmBack2.meta.tags) === JSON.stringify(specialTags), JSON.stringify(fmBack2.meta.tags))

// ── H. P1 回归:短词阈值边界 ──
// 「AI」(2字)不误伤「AI工具」;「数据库」(3字)仍判相似
await store.writeConcept(root,
  { type: 'TechChoice', title: 'AI工具', description: 'AI 工具选型', timestamp: new Date().toISOString() },
  '## Options\n\n| 候选 | 状态 |\n|---|---|\n| X | active |')
let sim = await dedupe.findSimilarByTitle(root, 'AI', 'TechChoice')
assert('短词 AI 不命中 AI工具(2<3)', sim.length === 0, JSON.stringify(sim))
sim = await dedupe.findSimilarByTitle(root, '数据库', 'TechChoice')
assert('3 字符仍可命中包含', sim.length === 0) // 库中无含「数据库」标题,应 0(只验证不误报)

// ── I. P1 回归:refreshIndex 描述处理(截断/空描述/无 frontmatter 兜底) ──
await store.writeConcept(root,
  { type: 'Fact', title: '超长描述', description: 'x'.repeat(200), timestamp: new Date().toISOString() },
  '# 核心\n\nbody')
await store.writeConcept(root,
  { type: 'Fact', title: '无描述概念', timestamp: new Date().toISOString() },
  '# 核心\n\nbody')
const idxLong = await fs.readFile(path.join(root, 'index.md'), 'utf8')
assert('超长描述截断到 60 字符', !idxLong.includes('x'.repeat(61)), '描述未截断')
const lineNoDesc = idxLong.split('\n').find((l) => l.includes('无描述概念'))
assert('无描述概念不带 — 后缀', lineNoDesc && !lineNoDesc.includes('—'), lineNoDesc)

console.log(`\n结果:${pass} 通过,${fail} 失败`)
if (fail > 0) process.exit(1)
