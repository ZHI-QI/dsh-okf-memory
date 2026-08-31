/**
 * seed-demo.js — 生成一份独立的"脑科学/认知神经"演示记忆库(不污染真实库)。
 * 用插件自己的 writeConcept/recordSelect 管线,生成类型齐全、交叉链接成网的演示概念,
 * 供《记忆流程图谱》展示/截图。产物符合 OKF v0.1,含 index/log/weights。
 *
 * 用法:
 *   node scripts/seed-demo.js               # 写入 ~/.dsh/memory-demo(默认)
 *   node scripts/seed-demo.js <dir>         # 写入指定目录
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(__dirname, '..', 'lib')

const demoDir = process.argv[2] || path.join(os.homedir(), '.dsh', 'memory-demo')
// 隔离:脚本永远只写演示库,绝不触碰 ~/.dsh/memory
process.env.OKF_MEMORY_ROOT = demoDir

const store = await import(pathToFileURL(path.join(lib, 'store.js')).href)
const learning = await import(pathToFileURL(path.join(lib, 'learning.js')).href)

console.log('演示记忆库根:', demoDir)
await store.ensureRoot(demoDir)

// ── 脑科学/认知神经 演示概念(type 全覆盖 + 交叉链接成网) ──
// body 里的 ## 相关 链接是 calligraphy.links 提取成"图谱边"的来源,用 /type/title 绝对路径
const DEMO = [
  // Fact
  { type: 'Fact', title: '前额叶执行功能', description: '前额叶皮质负责工作记忆与执行控制', tags: ['脑区', '执行功能'],
    body: '# 核心\n\n前额叶皮质(PFC)是执行功能的核心脑区,负责工作记忆、抑制控制与认知灵活性。\n\n## 证据\n- 损伤PFC损害计划与决策\n\n## 相关\n- [工作记忆容量约7正负2](/fact/工作记忆容量约7正负2.md)\n- [工作记忆与注意力共享神经资源](/insight/工作记忆与注意力共享神经资源.md)' },
  { type: 'Fact', title: '工作记忆容量约7正负2', description: '工作记忆经典容量约 7±2 个组块', tags: ['认知', '容量'],
    body: '# 核心\n\nMiller 提出工作记忆容量约 7±2 个组块,是现代认知容量研究的起点。\n\n## 相关\n- [前额叶执行功能](/fact/前额叶执行功能.md)' },

  // Preference
  { type: 'Preference', title: '研究偏好-闭环实验设计', description: '偏好先做行为-神经闭环再下结论', tags: ['研究偏好'],
    body: '# 偏好\n\n做神经认知研究时,偏好先采集行为与神经信号并做闭环验证,再下因果结论;不轻信单一模态。\n\n## 相关\n- [采用fNIRS而非EEG](/decision/采用fNIRS而非EEG.md)\n- [样本量不足导致统计效力低](/lesson/样本量不足导致统计效力低.md)' },

  // Decision
  { type: 'Decision', title: '采用fNIRS而非EEG', description: '运动伪迹场景下选 fNIRS 而非 EEG', tags: ['决策'],
    body: '# 数据\n\n在户外/运动场景测脑激活,fNIRS 对运动伪迹更稳健,EEG 空间定位弱。\n\n# 分析\n\n任务涉及身体动作,EEG 易受肌电伪迹污染;fNIRS 血氧信号空间分辨率更好。\n\n# 结论\n\n选 fNIRS 作为主成像手段,EEG 作补充时间分辨率。\n\n## 相关\n- [行为-神经耦合分析](/method/行为-神经耦合分析.md)\n- [研究偏好-闭环实验设计](/preference/研究偏好-闭环实验设计.md)' },

  // Method
  { type: 'Method', title: '经颅直流电刺激tDCS流程', description: 'tDCS 标准流程:定位-固定-刺激-对照', tags: ['方法', 'tDCS'],
    body: '# 步骤\n\n1. 定位目标脑区\n2. 固定电极(阳极兴奋/阴极抑制)\n3. 1-2mA,20min\n4. sham 对照\n\n## 相关\n- [前额叶执行功能](/fact/前额叶执行功能.md)\n- [采用fNIRS而非EEG](/decision/采用fNIRS而非EEG.md)' },
  { type: 'Method', title: '行为-神经耦合分析', description: '把行为指标与神经信号做耦合建模', tags: ['方法', '建模'],
    body: '# 核心\n\n将反应时/正确率等行为指标与神经信号(fNIRS/EEG)做耦合回归,量化行为-神经关联。\n\n## 相关\n- [神经成像设备选型](/techchoice/神经成像设备选型.md)' },

  // Insight
  { type: 'Insight', title: '工作记忆与注意力共享神经资源', description: '工作记忆与注意力可能共享 PFC 神经资源', tags: ['洞察', '认知'],
    body: '# 数据\n\n行为与神经证据显示,工作记忆负荷高时注意力捕获下降。\n\n# 分析\n\n二者在 PFC 存在竞争性资源分配。\n\n# 结论\n\n工作记忆与注意力共享部分神经资源,存在容量竞争。\n\n## 相关\n- [工作记忆容量约7正负2](/fact/工作记忆容量约7正负2.md)\n- [跨被试预测模型](/idea/跨被试预测模型.md)' },

  // Idea
  { type: 'Idea', title: '跨被试预测模型', description: '用机器学习做跨被试神经预测', tags: ['灵感', 'AI'],
    body: '# 想法\n\n用表征相似度/机器学习,把单个被试的神经模式泛化到新被试,做跨被试预测。\n\n## 相关\n- [行为-神经耦合分析](/method/行为-神经耦合分析.md)\n- [工作记忆与注意力共享神经资源](/insight/工作记忆与注意力共享神经资源.md)' },

  // Lesson
  { type: 'Lesson', title: '样本量不足导致统计效力低', description: '样本量不足是神经影像常见统计陷阱', tags: ['教训', '统计'],
    body: '# 教训\n\n神经影像研究样本量不足,统计效力低,易出假阳性。应优先保证 N 再谈精细分析。\n\n## 相关\n- [经颅直流电刺激tDCS流程](/method/经颅直流电刺激tDCS流程.md)\n- [研究偏好-闭环实验设计](/preference/研究偏好-闭环实验设计.md)' },

  // TechChoice (Options 表 + Active)
  { type: 'TechChoice', title: '神经成像设备选型', description: '脑成像硬件候选与当前使用', tags: ['技术选型', '设备'],
    body: '## Options\n\n| 候选 | 说明 | 配置要点 | 状态 |\n|---|---|---|---|\n| fNIRS | 运动稳健,空间较准 | 便携/近红外 | active |\n| EEG | 时间分辨率高 | 电极帽/易伪迹 | candidate |\n| fMRI | 全脑三维 | 重/贵 | candidate |\n\n## Active\n\n- 当前使用:fNIRS\n\n## 相关\n- [采用fNIRS而非EEG](/decision/采用fNIRS而非EEG.md)' },
  { type: 'TechChoice', title: '数据分析管线', description: '神经数据处理分析工具链', tags: ['技术选型', '管线'],
    body: '## Options\n\n| 候选 | 说明 | 状态 |\n|---|---|---|\n| MNE-Python | EEG/MEG 标准 | active |\n| Nilearn | fMRI 建模 | candidate |\n| custom MATLAB | 旧脚本 | retired |\n\n## Active\n\n- 当前使用:MNE-Python\n\n## 相关\n- [行为-神经耦合分析](/method/行为-神经耦合分析.md)',
  },
]

let created = 0
for (const c of DEMO) {
  const r = await store.writeConcept(demoDir, {
    type: c.type,
    title: c.title,
    description: c.description,
    tags: c.tags || [],
    timestamp: new Date().toISOString(),
    source: 'demo-seed',
  }, c.body)
  if (r.action === 'created') created++
  else console.log(`  (跳过/更新 ${c.type}/${c.title}: ${r.action})`)
}

// 模拟学习反馈,制造权重差异(让图谱节点大小有区分、learning.timeline 有历史)
await learning.recordSelect(demoDir, 'techchoice/神经成像设备选型', 1.0)
await learning.recordSelect(demoDir, 'insight/工作记忆与注意力共享神经资源', 0.5)
await learning.recordSelect(demoDir, 'fact/前额叶执行功能', 0.3)
await learning.recordSkip(demoDir, 'techchoice/数据分析管线', 0.2)

console.log(`\n演示库生成完成:共 ${DEMO.length} 条,新建 ${created} 条`)
console.log(`根目录: ${demoDir}`)
console.log('(不影响真实 ~/.dsh/memory;图谱切换到该库即可展示)')

// 打印 index 概览
console.log('\n=== index.md ===')
console.log(await fs.readFile(path.join(demoDir, 'index.md'), 'utf8'))
