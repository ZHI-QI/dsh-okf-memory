/**
 * gen-banner.js — 生成 README 宣传横幅(纯图谱 canvas,节点丰富 + 命中效果)。
 * 基于 gen-demo-viz 的模拟数据(48节点/5主题簇),去掉 UI 栏/调试计数,
 * 只渲染图谱 + 预置命中,便于 Chrome headless 截图成 PNG。
 * 输出:docs/okf-memory-banner.html(由外部?banner=1 截图)
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 模拟数据(与 gen-demo-viz 一致,保证节点丰富) ──
function buildSimData() {
  const TYPES = ['Fact', 'Preference', 'Decision', 'Method', 'Insight', 'Idea', 'Lesson', 'TechChoice']
  const themes = [
    { name: '脑科学与认知', seed: ['前额叶执行功能', '工作记忆容量', '注意力网络', '多巴胺编码', '海马巩固', 'fNIRS 血氧', 'EEG 节律', 'tDCS 刺激', '神经耦合建模', '表征相似度'] },
    { name: '前端与工程', seed: ['React 渲染', 'Vite 构建', '状态管理', '组件可复用', '性能优化', '类型系统', 'CSS 布局', '微前端', '打包体积', '并发调度', '响应式设计'] },
    { name: '后端与数据', seed: ['MCP 服务', 'SQL 建模', '缓存层', '消息队列', '索引优化', '分库分表', 'APM 监控', '优雅降级', '幂等设计', '数据血缘', '灰度发布'] },
    { name: '产品与设计', seed: ['用户画像', 'AB 实验', '留存漏斗', '行为埋点', '信息架构', '交互闭环', '竞品拆解', '北极星指标', '体验度量'] },
    { name: 'AI 与智能体', seed: ['RAG 检索', '语义路由', 'Agent 记忆', '工具编排', '向量索引', '幻觉抑制', '多步推理', '上下文压缩', '自我校验', '强化反馈', '多智能体'] },
  ]
  const nodes = [], edges = [], seen = new Set()
  let n = 0
  const wrand = () => +(0.5 + Math.random() * 4).toFixed(1)
  for (let t = 0; t < themes.length; t++) {
    const th = themes[t]
    for (let i = 0; i < th.seed.length; i++) {
      const type = TYPES[Math.floor(Math.random() * TYPES.length)]
      const id = `concept-${n++}`
      nodes.push({ id, title: th.seed[i], type, tags: [th.name, type], description: `${th.name}相关的${type}`, weight: i === 0 ? +(6.5 - t * 0.6).toFixed(1) : wrand(), state: Math.random() < 0.1 ? 'archived' : 'active' })
      const anchor = `concept-${t * 10}`
      if (anchor !== id && !seen.has([id, anchor].sort().join('||'))) { seen.add([id, anchor].sort().join('||')); edges.push({ source: id, target: anchor }) }
      if (i > 0 && Math.random() < 0.45) { const prev = `concept-${n - 2}`; if (!seen.has([id, prev].sort().join('||'))) { seen.add([id, prev].sort().join('||')); edges.push({ source: id, target: prev }) } }
    }
  }
  const bridges = [[0, 4], [1, 4], [2, 3], [0, 2], [3, 4], [1, 3]]
  for (const [a, b] of bridges) { const s = `concept-${a * 10}`, t = `concept-${b * 10}`; if (!seen.has([s, t].sort().join('||'))) { seen.add([s, t].sort().join('||')); edges.push({ source: s, target: t }) } }
  return { nodes, edges }
}

const { nodes, edges } = buildSimData()
// 预置命中:命中最强的"工作记忆容量"
const HIT_TITLE = '工作记忆容量'
const TYPE_COLORS = { Fact: '#2f7bff', Preference: '#ffd400', Decision: '#ff2d55', Method: '#00e66e', Insight: '#c04dff', Idea: '#ff7a00', Lesson: '#c8d1dd', TechChoice: '#00e5ff', Other: '#9aa7b8' }

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box} body{background:linear-gradient(140deg,#0b1622,#0a121b);overflow:hidden;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
#wrap{position:relative;width:1280px;height:720px}
canvas{display:block}
#slogan{position:absolute;left:28px;top:20px;z-index:9;background:rgba(11,22,34,.72);border:1px solid rgba(120,160,200,.2);border-radius:14px;padding:14px 20px;backdrop-filter:blur(4px)}
#slogan h1{font-size:30px;color:#eaf3fb;font-weight:800;letter-spacing:.5px}
#slogan h1 span{background:linear-gradient(120deg,#7ec3ff,#c04dff);-webkit-background-clip:text;background-clip:text;color:transparent}
#slogan .sub{font-size:14px;color:#9db8cf;margin-top:8px;line-height:1.7}
#badge{position:absolute;right:30px;top:26px;z-index:9;font-size:14px;color:#7ec3ff;background:rgba(38,56,76,.5);border:1px solid rgba(120,160,200,.3);border-radius:20px;padding:6px 14px}
#search{position:absolute;left:28px;top:150px;z-index:9;width:300px;background:rgba(11,22,34,.8);border:1px solid rgba(120,160,200,.45);border-radius:12px;padding:12px 14px;backdrop-filter:blur(4px)}
#search .lbl{font-size:11px;color:#8aa4bd;margin-bottom:6px;letter-spacing:.5px}
#search .row{display:flex;align-items:center;gap:8px;background:rgba(20,32,46,.9);border-radius:8px;padding:8px 12px;border:1px solid rgba(120,160,200,.25)}
#search .mag{font-size:15px;color:#7ec3ff}
#search .kw{font-size:17px;color:#fff;font-weight:700;min-width:120px}
#search .caret{width:2px;height:18px;background:#7ec3ff;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
</style></head><body>
<div id="wrap"><div id="slogan"><h1>🧠 记忆图谱 <span>· 神经自我学习</span></h1><div class="sub">会话 → 概念化 → 长期记忆 → 自动唤起<br>节点=权重 · 颜色=类型 · 交叉链接成网</div></div>
<div id="search"><div class="lbl">🔍 搜索命中 · 输入关键词</div><div class="row"><span class="mag">⌕</span><span class="kw" id="kw"></span><span class="caret"></span></div></div>
<div id="badge">48 概念 · 60 关系</div><canvas id="cv"></canvas></div>
<script>
window.onerror=function(m,s,l){var d=document.createElement('div');d.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#c0283c;color:#fff;font:12px monospace;padding:6px;z-index:999;white-space:pre-wrap';d.textContent='JSERR: '+m+' @'+l;document.body.appendChild(d);};
const NODES=${JSON.stringify(nodes)}, EDGES=${JSON.stringify(edges)}, HIT='${HIT_TITLE}';
const COL=${JSON.stringify(TYPE_COLORS)};
const cv=document.getElementById('cv'),ctx=cv.getContext('2d');
const W=cv.width=1280,H=cv.height=720;
const maxW=Math.max(...NODES.map(x=>x.weight));
const byId=new Map();
const nds=NODES.map((n,i)=>{const h=hash(n.id);const ang=(i/NODES.length)*Math.PI*2;const r=Math.min(300,150+NODES.length*4)*(0.55+((h%100)/100)*0.5);
  const o={...n,x:W/2+Math.cos(ang)*r,y:H*0.58+Math.sin(ang)*r,vx:0,vy:0,rr:8+Math.sqrt(n.weight/maxW)*22};byId.set(n.id,o);return o;});
const eds=EDGES.filter(e=>byId.has(e.source)&&byId.has(e.target));
function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h}
// 力导向迭代(收敛布局)
for(let it=0;it<160;it++){for(let i=0;i<nds.length;i++)for(let j=i+1;j<nds.length;j++){const a=nds[i],b=nds[j];let dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy+.01,d=Math.sqrt(d2),f=6800/d2,fx=f*dx/d,fy=f*dy/d;a.vx-=fx;a.vy-=fy;b.vx+=fx;b.vy+=fy;}
  nds.forEach(o=>{o.vx+=(W/2-o.x)*.0006;o.vy+=(H*0.58-o.y)*.0006;});
  eds.forEach(e=>{const a=byId.get(e.source),b=byId.get(e.target);const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+.01,f=(d-150)*.012;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;});
  nds.forEach(o=>{o.vx*=.82;o.vy*=.82;o.x+=o.vx;o.y+=o.vy;});}
// 命中:BFS 传导
const hitSet=new Set(nds.filter(o=>o.title===HIT).map(o=>o.id));
const adj=new Map();eds.forEach(e=>{if(!adj.has(e.source))adj.set(e.source,[]);if(!adj.has(e.target))adj.set(e.target,[]);adj.get(e.source).push(e.target);adj.get(e.target).push(e.source);});
const act=new Set(hitSet);const q=[...hitSet];while(q.length){const c=q.shift();(adj.get(c)||[]).forEach(x=>{if(!act.has(x)){act.add(x);q.push(x);}});}
function draw(){ctx.clearRect(0,0,W,H);
  // 背景网格
  ctx.strokeStyle='rgba(120,160,200,.04)';ctx.lineWidth=1;for(let g=0;g<W;g+=46){ctx.beginPath();ctx.moveTo(g,0);ctx.lineTo(g,H);ctx.stroke();}for(let g=0;g<H;g+=46){ctx.beginPath();ctx.moveTo(0,g);ctx.lineTo(W,g);ctx.stroke();}
  eds.forEach(e=>{const a=byId.get(e.source),b=byId.get(e.target);const on=act.has(e.source)||act.has(e.target);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=on?'rgba(126,195,255,.4)':'rgba(120,160,200,.16)';ctx.lineWidth=on?1.4:1;ctx.stroke();});
  // 命中词打字机动画:每~120ms 出一个字符,驱动 kw DOM
  const tNow=performance.now();
  const typed=Math.max(1,Math.floor((tNow-T0)/120));
  const kwEl=document.getElementById('kw');if(kwEl)kwEl.textContent=HIT.slice(0,typed);
  // 命中脉冲相位随打字进度:输入完成时恰有一次扩散
  const t=tNow/700;
  nds.forEach(o=>{const c=COL[o.type]||COL.Other;const isHit=hitSet.has(o.id),isAct=act.has(o.id);
    if(isHit){const tp=(t+hash(o.id)%10)%1;const pr=o.rr*(1.4+tp*1.7);ctx.beginPath();ctx.arc(o.x,o.y,pr,0,Math.PI*2);ctx.strokeStyle=rgba(c,.8*(1-tp));ctx.lineWidth=2.5;ctx.stroke();}
    if(isHit||isAct){const rg=ctx.createRadialGradient(o.x,o.y,o.rr*.2,o.x,o.y,o.rr*(isHit?3:2.1));rg.addColorStop(0,rgba(c,isHit?.85:.4));rg.addColorStop(1,'transparent');ctx.beginPath();ctx.arc(o.x,o.y,o.rr*(isHit?3:2.1),0,Math.PI*2);ctx.fillStyle=rg;ctx.fill();}
    ctx.beginPath();ctx.arc(o.x,o.y,o.rr,0,Math.PI*2);ctx.fillStyle=isAct?(isHit?'#fff':c):'#13233a';ctx.globalAlpha=isAct?0.96:1;ctx.fill();ctx.globalAlpha=1;
    ctx.beginPath();ctx.arc(o.x,o.y,o.rr,0,Math.PI*2);ctx.strokeStyle=isHit?'#fff':(isAct?c:'#33506a');ctx.lineWidth=isHit?3.4:1.2;ctx.stroke();
    ctx.fillStyle=isAct?'#fff':'#5f7d97';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText(o.title.slice(0,9),o.x,o.y+o.rr+12);
    if(isHit){ctx.fillStyle='#fff';ctx.font='700 12px sans-serif';ctx.fillText('⚡命中',o.x,o.y-o.rr-10);}
  });
  requestAnimationFrame(draw);}
function rgba(h,a){const c=h.replace('#','');return 'rgba('+parseInt(c.slice(0,2),16)+','+parseInt(c.slice(2,4),16)+','+parseInt(c.slice(4,6),16)+','+a+')'}
const T0=performance.now();
draw();
</script></body></html>`

const outPath = path.join(__dirname, '..', 'docs', 'okf-memory-banner.html')
await fs.writeFile(outPath, html, 'utf8')
console.log('已生成横幅页:', outPath)
console.log(`nodes=${nodes.length} edges=${edges.length}`)
