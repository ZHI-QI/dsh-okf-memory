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

console.log(`\n结果:${pass} 通过,${fail} 失败`)
if (fail > 0) process.exit(1)
