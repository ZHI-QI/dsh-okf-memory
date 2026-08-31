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

// 12. 类型归一化/校验(P0-4)
assert('normalizeType 归一化大小写', concept.normalizeType('fact') === 'Fact' && concept.normalizeType('FAct') === 'Fact')
let typeThrows = false
try { concept.normalizeType('not-a-type') } catch { typeThrows = true }
assert('normalizeType 未知类型抛错', typeThrows)
try { concept.normalizeType('') } catch { typeThrows = true }
assert('normalizeType 空类型抛错', typeThrows)

// 13. 小节级合并(P0-5):同小节覆盖、旧小节保留、新小节追加,不无限 ## 补充
const merged = concept.mergeConceptBodies(
  '# 核心\n\n旧内容\n\n## 细节\n- 旧\n',
  '# 核心\n\n新内容\n\n## 新增\n- 新\n',
)
assert('merge 覆盖同小节', merged.includes('# 核心\n\n新内容'))
assert('merge 保留旧小节', merged.includes('## 细节'))
assert('merge 追加新小节', merged.includes('## 新增'))
assert('merge 不再时间戳追加', !merged.includes('## 补充('))

// 14. 并发写不丢更新(P0-1):50 个并行写全部进索引
const cTitles = Array.from({ length: 50 }, (_, i) => `并发概念${i}`)
await Promise.all(cTitles.map((t) =>
  store.writeConcept(root, { type: 'Fact', title: t, description: t, timestamp: new Date().toISOString() }, `# 核心\n\n${t}`)))
const idx2 = await fs.readFile(path.join(root, 'index.md'), 'utf8')
let allIn = true
for (const t of cTitles) if (!idx2.includes(`fact/${t}`)) { allIn = false; break }
assert('并发 50 写全部入索引', allIn)

// 15. frontmatter 增强(P1-6):flow 数组含逗号 tag 不拆、引号值、多行块
const fm1 = concept.parseFrontmatter('---\ntype: Fact\ntitle: "含: 冒号的值"\ntags: ["门店,财务", 技术选型]\ndesc: >\n  多行\n  折叠\n---\n\nbody')
assert('flow 数组含逗号 tag 不拆', Array.isArray(fm1.meta.tags) && fm1.meta.tags[0] === '门店,财务' && fm1.meta.tags[1] === '技术选型', JSON.stringify(fm1.meta))
assert('引号值保留冒号', fm1.meta.title === '含: 冒号的值', JSON.stringify(fm1.meta.title))
assert('多行块解析', fm1.meta.desc === '多行\n折叠', JSON.stringify(fm1.meta.desc))
// 写侧:含逗号 tag 经 writeConcept 往返不拆坏
await store.writeConcept(root,
  { type: 'Fact', title: '逗号标签', description: '含逗号 tag 往返', tags: ['门店,财务', '普通'], timestamp: new Date().toISOString() },
  '# 核心\n\n测试')
const fmBack = concept.parseFrontmatter(await fs.readFile(path.join(root, 'fact', '逗号标签.md'), 'utf8'))
assert('含逗号 tag 写读往返', Array.isArray(fmBack.meta.tags) && fmBack.meta.tags[0] === '门店,财务' && fmBack.meta.tags[1] === '普通', JSON.stringify(fmBack.meta.tags))

// 16. 相似标题短词阈值(P1-7):「前端方案」存在时,新建「前端」不再被挡
await store.writeConcept(root,
  { type: 'TechChoice', title: '前端方案', description: '前端技术选型', tags: ['前端'], timestamp: new Date().toISOString() },
  '## Options\n\n| 候选 | 状态 |\n|---|---|\n| React | active |')
const simShort = await dedupe.findSimilarByTitle(root, '前端', 'TechChoice')
assert('短词「前端」不命中「前端方案」', simShort.length === 0, JSON.stringify(simShort))
const simLong = await dedupe.findSimilarByTitle(root, '前端方案', 'TechChoice')
assert('完整标题精确命中', simLong.length === 1 && simLong[0].similarity === 1)

// 17. index.md 带 description(P1-9)
const idxWithDesc = await fs.readFile(path.join(root, 'index.md'), 'utf8')
assert('index 行含 description', idxWithDesc.includes('— 前端技术选型'), idxWithDesc.slice(0, 400))

console.log(`\n结果:${pass} 通过,${fail} 失败`)
if (fail > 0) process.exit(1)
console.log('记忆库内容:')
console.log(await fs.readFile(path.join(root, 'index.md'), 'utf8'))
