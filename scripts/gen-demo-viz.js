/**
 * gen-demo-viz.js — 生成 DSH 风格的综合记忆展示页(说明/记忆图谱/记忆流/学习热力)。
 * 数据取自演示库真实存储,产出零依赖自包含 HTML,供 UI 设计评审。
 * 输出:docs/记忆展示-演示.html
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(__dirname, '..', 'lib')
const demoDir = process.env.OKF_MEMORY_ROOT || path.join(os.homedir(), '.dsh', 'memory-demo')

// --sim 模式:用丰富模拟数据(多主题簇/网状边/幂律权重)生成"好看"的演示,便于定 UI;
// 不带 --sim 时用演示库真实存储。
const USE_SIM = process.argv.includes('--sim')

const store = await import(pathToFileURL(path.join(lib, 'store.js')).href)
const concept = await import(pathToFileURL(path.join(lib, 'concept.js')).href)
const learning = await import(pathToFileURL(path.join(lib, 'learning.js')).href)

// ── 模拟数据生成器(仅 --sim) ──
function buildSimData() {
  const TYPES = ['Fact', 'Preference', 'Decision', 'Method', 'Insight', 'Idea', 'Lesson', 'TechChoice']
  // 5 个主题锚点,每个主题一批概念,簇内高密连边 + 少量跨簇桥
  const themes = [
    { name: '脑科学与认知', seed: ['前额叶执行功能', '工作记忆容量', '注意力网络', '多巴胺编码', '海马巩固', 'fNIRS 血氧', 'EEG 节律', 'tDCS 刺激', '神经耦合建模', '表征相似度'] },
    { name: '前端与工程', seed: ['React 渲染', 'Vite 构建', '状态管理', '组件可复用', '性能优化', '类型系统', 'CSS 布局', '微前端', '打包体积', '并发调度'] },
    { name: '后端与数据', seed: ['MCP 服务', 'SQL 建模', '缓存层', '消息队列', '索引优化', '分库分表', 'APM 监控', '优雅降级', '幂等设计', '数据血缘'] },
    { name: '产品与设计', seed: ['用户画像', 'AB 实验', '留存漏斗', '行为埋点', '信息架构', '交互闭环', '竞品拆解', '北极星指标'] },
    { name: 'AI 与智能体', seed: ['RAG 检索', '语义路由', 'Agent 记忆', '工具编排', '向量索引', '幻觉抑制', '多步推理', '上下文压缩', '自我校验', '强化反馈'] },
  ]
  const nodes = []
  const edges = []
  const seen = new Set()
  let n = 0
  const wrand = () => +(0.5 + Math.random() * 4).toFixed(1)
  for (let t = 0; t < themes.length; t++) {
    const th = themes[t]
    // 每个主题一个中枢枢纽 + 多个边缘概念
    for (let i = 0; i < th.seed.length; i++) {
      const type = TYPES[Math.floor(Math.random() * TYPES.length)]
      const id = `concept-${n++}`
      nodes.push({
        id, title: th.seed[i], type, tags: [th.name, type], description: `${th.name}相关的${type}`,
        weight: i === 0 ? +(6 - t * 0.5).toFixed(1) : wrand(), state: Math.random() < 0.12 ? 'archived' : 'active',
      })
      // 簇内连到主题锚点(高密度)
      const anchor = `concept-${t * 10}`
      for (const c of nodes) if (c.id === anchor && c.id !== id) {
        const k = [id, c.id].sort().join('||')
        if (!seen.has(k)) { seen.add(k); edges.push({ source: id, target: c.id }) }
      }
      if (i > 0 && Math.random() < 0.5) {
        const prev = `concept-${n - 2}`
        const k = [id, prev].sort().join('||')
        if (!seen.has(k)) { seen.add(k); edges.push({ source: id, target: prev }) }
      }
    }
  }
  // 跨主题桥(稀疏,让图谱连成一片)
  const bridges = [[0, 4], [1, 4], [2, 3], [0, 2], [3, 4]]
  for (const [a, b] of bridges) {
    const s = `concept-${a * 10}`, t = `concept-${b * 10}`
    const k = [s, t].sort().join('||')
    if (!seen.has(k)) { seen.add(k); edges.push({ source: s, target: t }) }
  }
  const timeline = nodes.slice(0, 24).map((n, i) => ({
    id: n.id, weight: n.weight, state: n.state, lastAccessed: new Date(Date.now() - i * 86400000).toISOString(),
    accessCount: Math.floor(Math.random() * 6),
  }))
  return { nodes, edges, timeline }
}

let nodes, edges, timeline
let concepts, weights
if (USE_SIM) {
  const sim = buildSimData()
  nodes = sim.nodes; edges = sim.edges; timeline = sim.timeline
} else {
  concepts = await store.scanBundle(demoDir)
  weights = await learning.loadMeta(demoDir)
}

if (!USE_SIM) {
// ── 节点(概念)+ 权重 ──
for (const c of concepts) {
  const text = await fs.readFile(c.filePath, 'utf8')
  const { meta } = concept.parseFrontmatter(text)
  const w = weights.entries[c.conceptId]
  nodes.push({
    id: c.conceptId, title: meta?.title || c.conceptId.replace(/^[^/]+\//, ''),
    type: meta?.type || 'Other', tags: Array.isArray(meta?.tags) ? meta.tags : [],
    description: meta?.description || '', weight: w ? +w.weight.toFixed(2) : 1.0, state: w?.state || 'active',
  })
  byId.set(c.conceptId, c.conceptId)
}
// ── 边(交叉链接)──
const seen = new Set()
for (const c of concepts) {
  const text = await fs.readFile(c.filePath, 'utf8')
  const { meta, body } = concept.parseFrontmatter(text)
  const re = /\((\/[^)]+\.md)\)/g
  let m
  while ((m = re.exec(body || '')) !== null) {
    let targetId = m[1].replace(/^\//, '').replace(/\.md$/, '')
    if (!byId.has(targetId)) { const k = Object.keys(byId).find(x => x.toLowerCase() === targetId.toLowerCase()); if (k) targetId = k }
    if (targetId && targetId !== c.conceptId) {
      const k = [c.conceptId, targetId].sort().join('||')
      if (!seen.has(k)) { seen.add(k); edges.push({ source: c.conceptId, target: targetId }) }
    }
  }
}
// ── 权重时间线(学习热力用)──
for (const [id, e] of Object.entries(weights.entries || {})) {
  timeline.push({ id, weight: +e.weight.toFixed(2), state: e.state, lastAccessed: e.lastAccessed, accessCount: e.accessCount || 0 })
}
}

const DATA = { nodes, edges, timeline }
console.log(`节点 ${nodes.length},边 ${edges.length},时间线 ${timeline.length}`)

const TYPE_COLORS = {
  Fact: '#2f7bff', Preference: '#ffd400', Decision: '#ff2d55', Method: '#00e66e',
  Insight: '#c04dff', Idea: '#ff7a00', Lesson: '#c8d1dd', TechChoice: '#00e5ff', Other: '#9aa7b8',
}
const TYPE_ORDER = ['Fact','Preference','Decision','Method','Insight','Idea','Lesson','TechChoice']

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-okf-memory · 记忆展示(评审)</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    background:#0d1621;color:#dbe7f3;height:100vh;overflow:hidden}
  #top{height:52px;display:flex;align-items:center;padding:0 20px;background:rgba(13,22,32,.9);
    border-bottom:1px solid rgba(120,160,200,.14)}
  #top .logo{font-weight:700;font-size:15px;letter-spacing:.3px;margin-right:18px;display:flex;align-items:center;gap:8px}
  .tabs{display:flex;gap:2px;flex:1}
  .tab{padding:8px 18px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;color:#8aa4bd;border-bottom:2px solid transparent}
  .tab.on{color:#fff;background:rgba(38,56,76,.35);border-bottom-color:#4e9af1}
  .tab:hover{color:#dbe7f3}
  #badge{font-size:12px;color:#6f8ba5;margin-left:auto}
  .panel{display:none;height:calc(100vh - 52px);padding:18px 22px}
  .panel.on{display:block}
  /* ① 说明 */
  .hero{max-width:660px;margin:30px auto 0;text-align:center}
  .eyebrow{font-size:11px;letter-spacing:3px;color:#6f8ba5;font-weight:600;margin-bottom:12px}
  .hero h2{font-size:30px;line-height:1.32;margin:0 0 14px;font-weight:800;letter-spacing:.5px;
    background:linear-gradient(120deg,#7ec3ff,#c04dff 60%,#ff7a00);-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero h2 b{font-weight:800}
  .tagline{color:#a9c4dd;font-size:14px;line-height:1.9;margin:0 0 16px;max-width:600px;margin-left:auto;margin-right:auto}
  .tagline b{color:#eaf3fb;font-weight:600}
  .pills{display:flex;justify-content:center;gap:10px}
  .pills span{background:rgba(38,56,76,.55);border:1px solid rgba(120,160,200,.25);border-radius:20px;
    padding:6px 14px;font-size:12px;color:#d3e4f3}
  .more{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:760px;margin:26px auto 0}
  .mcol{background:rgba(22,34,48,.6);border:1px solid rgba(120,160,200,.16);border-radius:14px;padding:16px;text-align:left}
  .mcol h4{margin:0 0 8px;font-size:13px;color:#7ec3ff;font-weight:700}
  .mcol p{margin:0;font-size:12.5px;line-height:1.8;color:#9db8cf}
  .mcol p b{color:#eaf3fb;font-weight:600}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:760px;margin:26px auto 0}
  .card{background:rgba(22,34,48,.7);border:1px solid rgba(120,160,200,.18);border-radius:12px;padding:16px;text-align:center}
  .card .n{font-size:30px;font-weight:700;color:#7ec3ff;letter-spacing:.5px}
  .card .l{font-size:12px;color:#8aa4bd;margin-top:6px}
  .steps{max-width:560px;margin:26px auto 0;background:rgba(22,34,48,.5);border:1px solid rgba(120,160,200,.14);
    border-radius:14px;padding:18px 22px}
  .steps h4{margin:0 0 12px;font-size:13px;color:#8aa4bd;font-weight:700}
  .srow{display:flex;gap:10px;align-items:baseline;margin-bottom:11px;font-size:13px}
  .srow b{color:#eaf3fb;white-space:nowrap;font-weight:700}
  .srow span{color:#9db8cf;line-height:1.7}
  /* ①② 记忆图谱(含搜索命中 + 神经传导) */
  #graphWrap{height:100%;border:1px solid rgba(120,160,200,.12);border-radius:12px;background:#0a121b;overflow:hidden;display:flex}
  .gSide{width:210px;border-right:1px solid rgba(120,160,200,.14);padding:12px;overflow-y:auto;flex:none}
  .gMain{flex:1;position:relative;min-width:0}
  canvas#gc{display:block}
  .fSideTitle{font-size:12px;color:#8aa4bd;font-weight:700;margin-bottom:10px}
  .fSearch{width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:12px;border-radius:8px;border:1px solid rgba(120,160,200,.3);
    background:rgba(20,32,46,.8);color:#dbe7f3;font-size:13px;outline:none}
  .fSearch:focus{border-color:#4e9af1}
  .finfo{position:absolute;left:16px;top:12px;z-index:5}
  .finfo .fTitle{font-size:15px;font-weight:700;color:#eaf3fb}
  .finfo .fSub{font-size:11px;color:#8aa4bd;margin-top:3px}
  .nStage{display:inline-block;margin-top:7px;font-size:12px;color:#cfe0f0;padding:4px 10px;border-radius:14px;background:rgba(38,56,76,.5)}
  .nStage.live{background:rgba(78,154,241,.35);color:#fff}
  .nHint{position:absolute;left:16px;bottom:12px;font-size:11px;color:#6f8ba5}
  .nEmpty{font-size:12px;color:#6f8ba5;text-align:center;margin-top:40px;line-height:1.7}
  .nCard{background:rgba(20,32,46,.7);border:1px solid rgba(120,160,200,.16);border-radius:10px;padding:9px 11px;margin-bottom:8px}
  .nCard .ct{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#eaf3fb;font-weight:600}
  .nCard .ct .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .nCard .m{font-size:11px;color:#9db8cf;margin-top:4px;line-height:1.6}
  .nCard .s{font-size:10px;color:#6f8ba5;margin-top:5px}
  .nCard .s b{color:#7ec3ff;font-weight:700}
  /* ③ 学习热力 */
  #learnWrap{height:100%;display:flex;gap:18px}
  .box{flex:1;background:rgba(22,34,48,.55);border:1px solid rgba(120,160,200,.14);border-radius:12px;padding:18px;overflow:auto}
  .box h4{margin:0 0 14px;font-size:13px;color:#8aa4bd;font-weight:600}
  .bar{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:12px}
  .bar .lbl{width:210px;color:#9db8cf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar .track{flex:1;height:14px;background:rgba(120,160,200,.12);border-radius:7px;overflow:hidden}
  .bar .fill{height:100%;border-radius:7px;transition:width .5s}
  .bar .val{width:42px;text-align:right;color:#dbe7f3;font-weight:600}
  /* ③ 神经触发 */
  #neuroWrap{height:100%;display:flex;gap:14px}
  .nMain{flex:1;position:relative;border:1px solid rgba(120,160,200,.12);border-radius:12px;background:#0a121b;overflow:hidden}
  .nHead{position:absolute;left:16px;top:12px;z-index:5}
  .nHead .nTitle{font-size:15px;font-weight:700;color:#eaf3fb}
  .nHead .nStage{font-size:12px;color:#cfe0f0;margin-top:5px;padding:4px 10px;border-radius:14px;background:rgba(38,56,76,.5);display:inline-block}
  .nHead .nStage.live{background:rgba(78,154,241,.35);color:#fff}
  .nHint{position:absolute;left:16px;bottom:12px;font-size:11px;color:#6f8ba5}
  canvas#nc{display:block}
  .nAside{width:280px;flex:none;border:1px solid rgba(120,160,200,.12);border-radius:12px;background:rgba(22,34,48,.5);padding:14px;overflow-y:auto}
  .nAsideTitle{font-size:13px;color:#8aa4bd;font-weight:700;margin-bottom:12px}
  .nEmpty{font-size:12px;color:#6f8ba5;text-align:center;margin-top:40px;line-height:1.7}
  .nCard{background:rgba(20,32,46,.7);border:1px solid rgba(120,160,200,.16);border-radius:10px;padding:10px 12px;margin-bottom:9px}
  .nCard .ct{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#eaf3fb;font-weight:600}
  .nCard .ct .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .nCard .m{font-size:11px;color:#9db8cf;margin-top:4px;line-height:1.6}
  .nCard .s{font-size:10px;color:#6f8ba5;margin-top:5px}
  .nCard .s b{color:#7ec3ff;font-weight:700}
</style>
</head>
<body>
<div id="dbgcount" style="position:fixed;top:0;right:0;background:#222;color:#4f4;font:11px monospace;padding:3px 6px;z-index:998">none</div>
<div id="top">
  <div class="logo">🧠 dsh-okf-memory</div>
  <div class="tabs">
    <div class="tab on" data-t="overview">说明</div>
    <div class="tab" data-t="graph">记忆图谱</div>
    <div class="tab" data-t="learn">学习热力</div>
  </div>
  <div id="badge"></div>
</div>

<div class="panel on" id="p-overview">
  <div class="hero">
    <div class="eyebrow">MEMORY · LONG-TERM · SELF-LEARNING</div>
    <h2>替你记住<b>关键信息</b>,<br><span>下次自动想起来</span></h2>
    <p class="tagline">对话里说过的重点、拍板的决定、用的技术选型——这个插件帮你<b>自动沉淀为长期记忆</b>,在之后的相关话题里<b>自动唤起</b>,不用你记、也不用你找。</p>
    <div class="pills"><span>✓ 自动沉淀</span><span>✓ 自动唤起</span><span>✓ 越用越准</span></div>
  </div>

  <div class="more">
    <div class="mcol">
      <h4>它是做什么的</h4>
      <p>把零散的会话内容,整理成可检索的<b>长期记忆</b>。重点从"手动记笔记"变成"插件替你记、到时自动想起"。</p>
    </div>
    <div class="mcol">
      <h4>怎么运作</h4>
      <p>每次对话,插件识别<b>值得沉淀</b>的信息→写成<b>结构化知识</b>→按<b>权重</b>排序,常用记忆优先唤起、长期不用自动归档。</p>
    </div>
    <div class="mcol">
      <h4>为什么好用</h4>
      <p><b>相关性 × 权重 × 近因</b>排序:你越常用的记忆越靠前;纠正/拍板会<strong>强化</strong>,长期不用会<strong>衰减归档</strong>——记忆库不膨胀、不跑偏。</p>
    </div>
  </div>

  <div class="cards" id="cards"></div>

  <div class="steps"><h4>上手方式</h4>
    <div class="srow"><b>① 正常用</b><span>插件自动判断什么值得记,你不用管</span></div>
    <div class="srow"><b>② 想手动</b><span>说「记住 XX」或「查下记忆里关于XX的」</span></div>
    <div class="srow"><b>③ 看效果</b><span>切到「记忆图谱 / 神经环路 / 学习热力」页签</span></div>
  </div>
</div>

<div class="panel" id="p-graph">
  <div id="graphWrap">
    <div class="gSide">
      <input id="gQuery" class="fSearch" placeholder="🔍 命中记忆…" autocomplete="off">
      <div class="fSideTitle">命中结果</div>
      <div id="gResults"><div class="nEmpty">输入关键词,命中记忆并触发神经传导</div></div>
    </div>
    <div class="gMain">
      <div class="finfo">
        <div class="fTitle" id="gTitle">⚡ 记忆图谱 · 神经传导</div>
        <div class="fSub" id="gSub">输入关键词命中,神经信号沿图谱传导到相关记忆</div>
        <div class="nStage" id="gStage">💤 待机 — 输入关键词或点击节点</div>
      </div>
      <button id="btn">↻ 重播</button>
      <canvas id="gc"></canvas>
      <div class="nHint">🖱 点击节点触发 · 命中带脉冲光环,传导沿边点亮</div>
    </div>
  </div>
</div>

<div class="panel" id="p-learn">
  <div id="learnWrap">
    <div class="box"><h4>权重分布(节点大小依据)</h4><div id="bars"></div></div>
    <div class="box"><h4>类型 × 活跃度</h4><div id="heat"></div></div>
  </div>
</div>

<script>
window.onerror=function(msg,src,line){try{var p=document.getElementById('errbar');if(!p){p=document.createElement('div');p.id='errbar';p.style.cssText='position:fixed;bottom:0;left:0;right:0;background:rgba(200,40,60,.95);color:#fff;font:12px monospace;padding:6px 10px;z-index:999;white-space:pre-wrap';document.body.appendChild(p);}p.textContent='JS错误: '+msg+' (行'+line+')';}catch(e){}};
// hex 颜色 + alpha → 安全 RGBA(处理 3/6 位 hex,避免 '#fff'+'88' 这种非法拼接)
function alpha(hex,a){var c=String(hex||'#fff').replace('#','');if(c.length===3)c=c.split('').map(function(x){return x+x;}).join('');if(c.length!==6)return 'rgba(255,255,255,'+a+')';var r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);return 'rgba('+r+','+g+','+b+','+a+')';}
const D=${JSON.stringify(DATA)}, COL=${JSON.stringify(TYPE_COLORS)}, TO=${JSON.stringify(TYPE_ORDER)};

// tab 切换
document.querySelectorAll('.tab').forEach(t=>{
  t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('on'));
    t.classList.add('on'); document.getElementById('p-'+t.dataset.t).classList.add('on');
    if(t.dataset.t==='graph') restartGraph();
    if(t.dataset.t==='flow'){ flowSetup(); }   // 关键:面板由 display:none→block,必须重算尺寸
  };
});
document.getElementById('badge').textContent=D.nodes.length+' 概念 · '+D.edges.length+' 关系';

// 概况卡片
const maxW=Math.max(...D.nodes.map(n=>n.weight));
const cnt={}; D.nodes.forEach(n=>cnt[n.type]=(cnt[n.type]||0)+1);
const cards=document.getElementById('cards');
[['概念',D.nodes.length],['关系',D.edges.length],['类型',Object.keys(cnt).length],['唤起',D.timeline.reduce((s,e)=>s+e.accessCount,0)]]
.forEach(([l,n])=>{const c=document.createElement('div');c.className='card';c.innerHTML='<div class="n">'+n+'</div><div class="l">'+l+'</div>';cards.appendChild(c);});

// ── 记忆图谱(合并:完整图谱 + 搜索命中 + 神经传导 + 命中特殊动画) ──
const gc=document.getElementById('gc'), gctx=gc.getContext('2d');
let gW,gH, nnodes=[], nlook={}, nactive={}, npulses=[], hits=[], hitsSet=new Set();
function gsize(){const m=document.getElementById('p-graph').querySelector('.gMain');const r=m?m.getBoundingClientRect():null;
  const w=Number.isFinite(r&&r.width)?r.width:640, h=Number.isFinite(r&&r.height)?r.height:(innerHeight-90);
  gW=gc.width=Math.max(520,w); gH=gc.height=Math.max(300,h);}
let nedges=[];
function initGraph(){const W=Number.isFinite(gW)?gW:640, H=Number.isFinite(gH)?gH:400;
  nnodes=D.nodes.map(n=>{const w=Number(n.weight);const ww=Number.isFinite(w)?w:1;return {...n,x:0,y:0,vx:0,vy:0,r:8+Math.sqrt(ww/maxW)*20};});
  nnodes.forEach((n,i)=>nlook[n.id]=i);
  nnodes.forEach(n=>{n.x=W/2+(Math.random()-.5)*W*.5;n.y=H/2+(Math.random()-.5)*H*.5;});
  nedges=D.edges.filter(e=>nlook[e.source]!=null&&nlook[e.target]!=null).map(e=>({s:nlook[e.source],t:nlook[e.target]}));}
function setStage(txt,live){var el=document.getElementById('gStage');if(el){el.textContent=txt;el.classList.toggle('live',!!live);}}
function renderHits(){var box=document.getElementById('gResults');if(!hits.length){box.innerHTML='<div class="nEmpty">输入关键词,命中记忆并触发神经传导</div>';return;}box.innerHTML=hits.map(function(n){return '<div class="nCard" style="border-color:'+(COL[n.type]||COL.Other)+'"><div class="ct"><span class="dot" style="background:'+(COL[n.type]||COL.Other)+'"></span>'+n.title+' <span style="font-size:10px;color:#6f8ba5">· '+n.type+'</span></div><div class="m">'+n.description+'</div><div class="s">权重 <b>'+n.weight+'</b></div></div>';}).join('');}
function trigger(srcIds){var ETA=0.55,q=[],visited=new Set();srcIds.forEach(function(id){if(!visited.has(id)){visited.add(id);q.push({id:id,strength:1,depth:0});}});nactive={};srcIds.forEach(function(id){nactive[id]=1;});npulses=[];var acts=[],guard=0;while(q.length&&guard++<400){var cur=q.shift();var i=nlook[cur.id];if(i==null)continue;for(var k=0;k<nedges.length;k++){var e=nedges[k];var nb=e.s===i?e.t:e.t===i?e.s:-1;if(nb<0||nb===i)continue;var nid=nnodes[nb].id;if(visited.has(nid))continue;visited.add(nid);var s=+(cur.strength*ETA*(0.7+nnodes[nb].weight/4)).toFixed(3);acts.push({id:nid,strength:s,depth:cur.depth+1});npulses.push({s:e.s,t:e.t,prog:0,spd:.02+cur.depth*.006,strength:s});q.push({id:nid,strength:s,depth:cur.depth+1});}}var byDepth={};acts.forEach(function(a){(byDepth[a.depth]=byDepth[a.depth]||[]).push(a);});Object.keys(byDepth).sort(function(a,b){return a-b;}).forEach(function(d){setTimeout(function(){byDepth[d].forEach(function(a){nactive[a.id]=a.strength;});},d*140);});setStage('⚡ 传导中 — 命中 '+srcIds.length+' 个,扩散 '+acts.length+' 个相关节点',true);setTimeout(function(){setStage('✅ 完成 — 激活 '+acts.length+' 个相关记忆',true);},1200);}
function search(q){var t=String(q).trim().toLowerCase();if(!t){hits=[];hitsSet=new Set();setStage('💤 待机 — 输入关键词',false);renderHits();return;}hits=D.nodes.filter(function(n){var hay=(n.title+' '+n.description+' '+(n.tags||[]).join(' ')).toLowerCase();return hay.indexOf(t)>=0;});hitsSet=new Set(hits.map(function(n){return n.id;}));setStage('🔍 命中 '+hits.length+' 个记忆',true);renderHits();trigger(hits.map(function(n){return n.id;}));}
function gtick(){var rep=3600,spring=.016;for(var i=0;i<nnodes.length;i++)for(var j=i+1;j<nnodes.length;j++){var a=nnodes[i],b=nnodes[j],dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy+.01,d=Math.sqrt(d2),f=rep/d2,fx=f*dx/d,fy=f*dy/d;a.vx-=fx;a.vy-=fy;b.vx+=fx;b.vy+=fy;}nnodes.forEach(function(n){n.vx+=(gW/2-n.x)*.0006;n.vy+=(gH/2-n.y)*.0006;});nedges.forEach(function(e){var a=nnodes[e.s],b=nnodes[e.t],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+.01,f=(d-120)*spring;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;});nnodes.forEach(function(n){n.vx*=.85;n.vy*=.85;n.x+=n.vx;n.y+=n.vy;});}
function gdraw(){gtick();gctx.clearRect(0,0,gW,gH);gctx.strokeStyle='rgba(120,160,200,.05)';gctx.lineWidth=1;for(var g=0;g<gW;g+=42){gctx.beginPath();gctx.moveTo(g,0);gctx.lineTo(g,gH);gctx.stroke();}for(var g2=0;g2<gH;g2+=42){gctx.beginPath();gctx.moveTo(0,g2);gctx.lineTo(gW,g2);gctx.stroke();}nedges.forEach(function(e){var a=nnodes[e.s],b=nnodes[e.t];gctx.beginPath();gctx.moveTo(a.x,a.y);gctx.lineTo(b.x,b.y);gctx.strokeStyle='rgba(120,160,200,.18)';gctx.lineWidth=1.1;gctx.stroke();});npulses.forEach(function(p){p.prog+=p.spd;if(p.prog>1){npulses.splice(npulses.indexOf(p),1);return;}var a=nnodes[p.s],b=nnodes[p.t],x=a.x+(b.x-a.x)*p.prog,y=a.y+(b.y-a.y)*p.prog,col=COL[nnodes[p.s].type]||COL.Other;gctx.beginPath();gctx.arc(x,y,2.6+Math.min(5,p.strength*3),0,Math.PI*2);gctx.fillStyle=col;gctx.globalAlpha=.9;gctx.fill();gctx.globalAlpha=1;});nnodes.forEach(function(n){if(!Number.isFinite(n.x)||!Number.isFinite(n.y)||!Number.isFinite(n.r))return;var isHit=hitsSet.has(n.id),act=nactive[n.id]>0,c=COL[n.type]||COL.Other;if(isHit){var tp=((performance.now()/700+(n.x%1))%1);var rr=n.r*(1.6+tp*1.8);gctx.beginPath();gctx.arc(n.x,n.y,rr,0,Math.PI*2);gctx.strokeStyle=alpha(c,0.8*(1-tp));gctx.lineWidth=2.5;gctx.stroke();}if(isHit||act){var rg=gctx.createRadialGradient(n.x,n.y,n.r*.2,n.x,n.y,n.r*(isHit?2.9:2.1));rg.addColorStop(0,alpha(c,isHit?0.8:0.45));rg.addColorStop(1,'transparent');gctx.beginPath();gctx.arc(n.x,n.y,n.r*(isHit?2.9:2.1),0,Math.PI*2);gctx.fillStyle=rg;gctx.fill();}gctx.beginPath();gctx.arc(n.x,n.y,n.r,0,Math.PI*2);gctx.fillStyle=act?(isHit?'#fff':c):'#13233a';gctx.globalAlpha=act?.95:1;gctx.fill();gctx.globalAlpha=1;gctx.beginPath();gctx.arc(n.x,n.y,n.r,0,Math.PI*2);gctx.strokeStyle=isHit?'#fff':(act?c:'#33506a');gctx.lineWidth=isHit?3.2:(act?2:1.2);gctx.stroke();gctx.textAlign='center';gctx.fillStyle=act?'#fff':'#5f7d97';gctx.font='10px sans-serif';gctx.fillText(n.title.slice(0,7),n.x,n.y+n.r+11);if(isHit){gctx.fillStyle='#fff';gctx.font='700 12px sans-serif';gctx.fillText('⚡命中',n.x,n.y-n.r-9);}});requestAnimationFrame(gdraw);}
function restartGraph(){gsize();}
var gq=document.getElementById('gQuery');var gTimer=null;gq.addEventListener('input',function(){clearTimeout(gTimer);gTimer=setTimeout(function(){search(gq.value);},220);});gq.addEventListener('keydown',function(e){if(e.key==='Enter'){clearTimeout(gTimer);search(gq.value);}});
gc.addEventListener('mousedown',function(e){var m=document.getElementById('p-graph').querySelector('.gMain');var wx=e.clientX-m.offsetLeft,wy=e.clientY-m.offsetTop;for(var i=nnodes.length-1;i>=0;i--){var n=nnodes[i],dx=n.x-wx,dy=n.y-wy;if(dx*dx+dy*dy<(n.r+10)*(n.r+10)){hits=[n];hitsSet=new Set([n.id]);renderHits();trigger([n.id]);break;}}});
(function(){var b=document.getElementById('btn');if(b)b.onclick=function(){if(hits.length)trigger(hits.map(function(n){return n.id;}));};})();
gsize();initGraph();gdraw();addEventListener('resize',function(){gsize();});
search('记忆');

// ── 学习热力 ──
const barsEl=document.getElementById('bars');
const ranked=[...D.timeline].sort((a,b)=>b.weight-a.weight);const maxWt=Math.max(...ranked.map(e=>e.weight));
ranked.forEach(e=>{const node=D.nodes.find(n=>n.id===e.id)||{title:e.id,type:'Other'};
  const d=document.createElement('div');d.className='bar';d.innerHTML='<span class="lbl">'+node.title+'</span><span class="track" style="position:relative"><span class="fill" style="width:'+(e.weight/maxWt*100)+'%;background:'+(COL[node.type]||COL.Other)+'"></span></span><span class="val">'+e.weight+'</span>';
  barsEl.appendChild(d);});
const heatEl=document.getElementById('heat');
const typeCnt={};D.nodes.forEach(n=>typeCnt[n.type]=(typeCnt[n.type]||0)+1);
const maxTc=Math.max(...Object.values(typeCnt));
Object.keys(typeCnt).forEach(t=>{const d=document.createElement('div');d.className='bar';d.innerHTML='<span class="lbl">'+t+'</span><span class="track"><span class="fill" style="width:'+(typeCnt[t]/maxTc*100)+'%;background:'+(COL[t]||COL.Other)+'"></span></span><span class="val">'+typeCnt[t]+'</span>';heatEl.appendChild(d);});

// 自动验证钩子:?auto=1 时切到记忆图谱并触发搜索,便于 headless 捕获点击后错误
if(location.search.indexOf('auto=1')>=0){
  setTimeout(function(){
    var tabs=document.querySelectorAll('.tab');
    for(var i=0;i<tabs.length;i++){if(tabs[i].dataset.t==='graph')tabs[i].click();}
    setTimeout(function(){var q=document.getElementById('gQuery');if(q){q.value='记忆';search('记忆');}},300);
  },600);
}
</script>
</body>
</html>`

const outPath = path.join(__dirname, '..', 'docs', '记忆展示-演示.html')
await fs.writeFile(outPath, html, 'utf8')
console.log('已生成:', outPath)
