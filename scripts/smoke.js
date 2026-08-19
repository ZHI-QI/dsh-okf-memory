/**
 * 功能验证脚本(临时,不随插件发布):直接测核心模块,模拟 dsh 工具调用。
 * 用法:node scripts/smoke.js [临时记忆库路径]
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(__dirname, '..', 'lib')

// 注入待测模块(绕过 index.js 的 dsh 依赖,直接测核心逻辑)
async function load(moduleName) {
  return import(pathToFileURL(path.join(lib, moduleName)).href)
}

const root = process.argv[2] || path.join(os.tmpdir(), `okf-smoke-${Date.now()}`)
console.log('记忆库根:', root)

const store = await load('store.js')
const concept = await load('concept.js')
const dedupe = await load('dedupe.js')
const learning = await load('learning.js')
const recall = await load('recall.js')

let pass = 0
let fail = 0
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

// 1. 初始化骨架
await store.ensureRoot(root)
let idx = await fs.readFile(path.join(root, 'index.md'), 'utf8')
assert('初始化 index.md', idx.includes('okf_version'))
let log = await fs.readFile(path.join(root, 'log.md'), 'utf8')
assert('初始化 log.md', log.includes('变更历史'))

// 2. 写入普通概念(Fact)
let r = await store.writeConcept(root,
  { type: 'Fact', title: '门店布局', description: '三家门店:韶山/湘乡/塘厦', tags: ['门店'], timestamp: new Date().toISOString() },
  '# 核心\n\n三家门店共用局域网共享文件夹。\n\n## 细节\n- 韶山店\n- 湘乡店\n- 塘厦店')
assert('写入 Fact', r.action === 'created' && r.conceptId === 'fact/门店布局')
idx = await fs.readFile(path.join(root, 'index.md'), 'utf8')
assert('index 更新', idx.includes('fact/门店布局'))
log = await fs.readFile(path.join(root, 'log.md'), 'utf8')
assert('log 记录', log.includes('created'))

// 3. 决策三段式(Decision)
r = await store.writeConcept(root,
  { type: 'Decision', title: '数据源确定', description: '美团为经营确定源', timestamp: new Date().toISOString() },
  concept.buildDecisionBody({
    data: '美团 API / 企微报账 / 财务本地 三个数据源。',
    analysis: '美团是经营确定源,企微需对账去重。',
    conclusion: '以美团为经营确定源,企微与美团对账去重。',
  }))
assert('写入 Decision 三段式', r.action === 'created' && r.conceptId === 'decision/数据源确定')

// 4. TechChoice 候选表
r = await store.writeConcept(root,
  { type: 'TechChoice', title: '前端方案', description: '前端技术选型候选', tags: ['前端', '技术选型'], timestamp: new Date().toISOString() },
  concept.buildTechChoiceBody({
    options: [
      { name: 'React 18 + Vite', desc: '主力前端', config: 'node22/pnpm', status: 'active' },
      { name: 'Vue 3', desc: '旧项目遗留', config: '维护中', status: 'candidate' },
    ],
    active: 'React 18 + Vite',
  }))
assert('写入 TechChoice', r.action === 'created' && r.conceptId === 'techchoice/前端方案')

// 5. 检索命中
const hits = await dedupe.search(root, '门店')
assert('检索命中关键词', hits.length >= 1 && hits[0].conceptId.includes('门店'))
const tcHits = await dedupe.search(root, '前端', { type: 'TechChoice' })
assert('TechChoice 检索', tcHits.length === 1 && tcHits[0].type === 'TechChoice')

// 6. 去重:标题相同 → 更新/跳过
const similar = await dedupe.findSimilarByTitle(root, '门店布局', 'Fact')
assert('标题去重命中', similar.length === 1)
const decision = await dedupe.decide(root, { title: '门店布局', type: 'Fact', body: '简短' })
assert('去重决策(内容少→skip)', decision.action === 'skip' || decision.action === 'update')

// 7. 学习权重:选中 React → 权重上升
const w1 = await learning.recordSelect(root, 'techchoice/前端方案', 1.0)
const meta = await learning.loadMeta(root)
assert('记录选择反馈', meta.entries['techchoice/前端方案'].weight > 1.0)
assert('recordSelect 返回权重', w1 > 1.0)

// 8. 巩固:未使用衰减(模拟旧时间)
const meta2 = await learning.loadMeta(root)
meta2.entries['fact/门店布局'] = { weight: 1.0, accessCount: 0, lastAccessed: new Date(Date.now() - 90 * 86400000).toISOString(), state: 'active' }
await learning.saveMeta(root, meta2)
await learning.consolidate(root)
const meta3 = await learning.loadMeta(root)
assert('衰减生效', meta3.entries['fact/门店布局'].weight < 1.0)
assert('归档判定', meta3.entries['fact/门店布局'].state === 'active' || meta3.entries['fact/门店布局'].state === 'inactive')

// 9. 唤起评分排序
const ranked = await learning.rank(root, [
  { conceptId: 'fact/门店布局', score: 4 },
  { conceptId: 'techchoice/前端方案', score: 3 },
])
assert('rank 排序返回', ranked.length === 2 && typeof ranked[0].score === 'number')

// 10. 精读 + 交叉链接提取
const r2 = await store.writeConcept(root,
  { type: 'Method', title: '对账流程', description: '企微与美团对账', timestamp: new Date().toISOString() },
  '# 核心\n\n对账步骤。\n\n## 相关\n\n- [数据源确定](/decision/数据源确定.md)')
const recalled = await recall.recall(root, 'method/对账流程')
assert('交叉链接提取', recalled.links.length >= 1 && recalled.links[0].conceptId === 'decision/数据源确定')

// 11. 符合性校验
const check = concept.validateConcept('# no frontmatter')
assert('符合性校验(无 frontmatter→fail)', check.ok === false)
const check2 = concept.validateConcept('---\ntype: Fact\ntitle: X\n---\n\nbody')
assert('符合性校验(合规→ok)', check2.ok === true)

console.log(`\n结果:${pass} 通过,${fail} 失败`)
if (fail > 0) process.exit(1)
console.log('记忆库内容:')
console.log(await fs.readFile(path.join(root, 'index.md'), 'utf8'))
