/**
 * 并发压测:验证写锁(withLock)串行化下,并行写入/反馈不丢更新。
 * 用法:node scripts/concurrency.js [临时记忆库路径]
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

const root = process.argv[2] || path.join(os.tmpdir(), `okf-conc-${Date.now()}`)
console.log('记忆库根:', root)

const store = await load('store.js')
const learning = await load('learning.js')

let pass = 0
let fail = 0
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

await store.ensureRoot(root)

// 1. 50 个并行写概念 → index 全部收录、log 全部记录
const N = 50
const titles = Array.from({ length: N }, (_, i) => `并行概念${i}`)
await Promise.all(titles.map((t) =>
  store.writeConcept(root, { type: 'Fact', title: t, description: t, timestamp: new Date().toISOString() }, `# 核心\n\n${t}`)))
const idx = await fs.readFile(path.join(root, 'index.md'), 'utf8')
let allIn = true
for (const t of titles) if (!idx.includes(`fact/${t}`)) { allIn = false; break }
assert(`并发 ${N} 写全部入索引`, allIn)
const log = await fs.readFile(path.join(root, 'log.md'), 'utf8')
const createdCount = (log.match(/created/g) || []).length
assert(`log 含 ${N} 次 created`, createdCount >= N)

// 2. 5 个并行 recordSelect 同一概念 → 权重无丢失(每次 +1.0,期望 1 + 5 = 6;
//    注意 recordSelect 有权重上限 10,故用小批量避免触顶)
const M = 5
await Promise.all(Array.from({ length: M }, () => learning.recordSelect(root, 'fact/并行概念0', 1.0)))
const meta = await learning.loadMeta(root)
const w = meta.entries['fact/并行概念0'].weight
assert(`并行 ${M} 次反馈权重无丢失(期望 ${1 + M})`, Math.abs(w - (1 + M)) < 1e-9, `实际 ${w}`)

console.log(`\n结果:${pass} 通过,${fail} 失败`)
if (fail > 0) process.exit(1)
