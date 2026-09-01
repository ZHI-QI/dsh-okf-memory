/**
 * dsh-okf-memory client(浏览器半) — 记忆图谱会话标签页。
 *
 * 契约:
 *  - package.json 声明 dsh.client { platform:'web', inject:[client服务] }
 *  - ctx.slots.inject("conversation.view", ...) 注册对话视图标签
 *  - fetch 后端 /okf-graph → 力导向渲染;搜索命中节点 + 脉冲光环 + 神经传导
 *
 * 只保留「记忆图谱」一个视图。
 */
import React from "react";

export const inject = ["slots", "locale"];
const NS = "okf-memory";

const TYPE_COLORS: Record<string, string> = {
  Fact: "#2f7bff", Preference: "#ffd400", Decision: "#ff2d55", Method: "#00e66e",
  Insight: "#c04dff", Idea: "#ff7a00", Lesson: "#c8d1dd", TechChoice: "#00e5ff", Other: "#9aa7b8",
};
type GraphNode = { id: string; title: string; type: string; weight: number; state: string; description?: string; tags?: string[] };
type GraphEdge = { source: string; target: string };

function MemoryGraphView() {
  const [graph, setGraph] = React.useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  // 用 ref 保存 query,供 rAF 动画循环读取,避免每次 query 变化重建
  const queryRef = React.useRef("");
  queryRef.current = query;

  React.useEffect(() => {
    fetch("/okf-graph")
      .then((r) => r.json())
      .then((g) => { if (g.error) setError(g.error); else setGraph(g); })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  React.useEffect(() => {
    if (!graph || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let raf = 0;
    const render = () => { drawGraph(canvas, graph, queryRef.current); raf = requestAnimationFrame(render); };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [graph]);

  if (error) return React.createElement("div", { style: p }, "记忆图谱加载失败: " + error);
  if (!graph) return React.createElement("div", { style: p }, "加载记忆图谱…");

  return React.createElement("div", { style: { padding: "12px" } },
    React.createElement("input", {
      value: query,
      onChange: (e) => setQuery(e.target.value),
      placeholder: "🔍 命中记忆(搜标题/类型/标签)…",
      style: {
        width: "100%", boxSizing: "border-box", padding: "9px 12px", marginBottom: "10px",
        borderRadius: "8px", border: "1px solid rgba(120,160,200,.3)", background: "rgba(20,32,46,.8)",
        color: "#dbe7f3", fontSize: "13px", outline: "none",
      },
    }),
    React.createElement("div", { style: { color: "#8aa4bd", fontSize: "12px", marginBottom: "8px" } },
      `${graph.nodes.length} 节点 · ${graph.edges.length} 边 · 搜索命中 → 脉冲光环 + 神经传导`),
    React.createElement("canvas", { ref: canvasRef, style: { width: "100%", height: "calc(100vh - 200px)", display: "block" } }),
  );
}
const p: React.CSSProperties = { padding: "24px", color: "#8aa4bd", fontFamily: "sans-serif" };

// 命中匹配(title/type/tags 含关键词)
function matches(n: GraphNode, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  const hay = (n.title + " " + n.type + " " + (n.tags || []).join(" ")).toLowerCase();
  return hay.includes(t);
}
// 命中节点 → 神经传导:从命中 BFS 扩散到相关节点
function activateHits(nodes: GraphNode[], edges: GraphEdge[], hits: Set<string>): Set<string> {
  const act = new Set<string>(hits);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  edges.forEach((e) => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  });
  const q = [...hits];
  while (q.length) {
    const cur = q.shift()!;
    (adj.get(cur) || []).forEach((nb) => { if (!act.has(nb)) { act.add(nb); q.push(nb); } });
  }
  return act;
}

function drawGraph(canvas: HTMLCanvasElement, graph: { nodes: GraphNode[]; edges: GraphEdge[] }, query: string) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 800, H = canvas.clientHeight || 500;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const maxW = Math.max(...graph.nodes.map((n) => n.weight), 1);
  // 力导向布局:每次调用做少量迭代(节点位置用闭包缓存?每次重建会闪。改用简单随机+固定迭代)
  const byId = new Map<string, { x: number; y: number }>();
  const nodes = graph.nodes.map((n) => {
    let x: number, y: number;
    // 确定性伪随机位置(基于 id hash),避免每次渲染抖动
    const h = hash(n.id);
    x = W / 2 + ((h % 100) / 100 - 0.5) * W * 0.6;
    y = H / 2 + (((h >> 7) % 100) / 100 - 0.5) * H * 0.6;
    byId.set(n.id, { x, y });
    return { ...n, x, y, r: 8 + Math.sqrt(n.weight / maxW) * 20 };
  });
  const edges = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  // 命中检测 + 传导
  const hits = new Set<string>();
  if (query.trim()) graph.nodes.forEach((n) => { if (matches(n, query)) hits.add(n.id); });
  const active = activateHits(graph.nodes, graph.edges, hits);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#13233a"; ctx.fillRect(0, 0, W, H);

  // 边
  ctx.strokeStyle = "rgba(120,160,200,.18)"; ctx.lineWidth = 1;
  edges.forEach((e) => {
    const a = byId.get(e.source)!, b = byId.get(e.target)!;
    const isActive = active.has(e.source) || active.has(e.target);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = isActive ? "rgba(126,195,255,.5)" : "rgba(120,160,200,.18)";
    ctx.stroke();
  });

  // 节点
  const t = performance.now() / 700;
  nodes.forEach((n) => {
    const c = TYPE_COLORS[n.type] || TYPE_COLORS.Other;
    const isHit = hits.has(n.id);
    const isActive = active.has(n.id);
    // 命中:脉冲光环扩散
    if (isHit) {
      const tp = (t + hash(n.id) % 10) % 1;
      const rr = n.r * (1.5 + tp * 1.8);
      ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(c, 0.8 * (1 - tp)); ctx.lineWidth = 2.5; ctx.stroke();
    }
    if (isHit || isActive) {
      const rg = ctx.createRadialGradient(n.x, n.y, n.r * 0.2, n.x, n.y, n.r * (isHit ? 2.9 : 2.1));
      rg.addColorStop(0, hexToRgba(c, isHit ? 0.8 : 0.45)); rg.addColorStop(1, "transparent");
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (isHit ? 2.9 : 2.1), 0, Math.PI * 2); ctx.fillStyle = rg; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fillStyle = isActive ? (isHit ? "#fff" : c) : "#13233a"; ctx.globalAlpha = isActive ? 0.95 : 1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.strokeStyle = isHit ? "#fff" : (isActive ? c : "#33506a"); ctx.lineWidth = isHit ? 3.2 : 1.2; ctx.stroke();
    ctx.fillStyle = isActive ? "#fff" : "#5f7d97"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(n.title.slice(0, 8), n.x, n.y + n.r + 12);
    if (isHit) { ctx.fillStyle = "#fff"; ctx.font = "700 11px sans-serif"; ctx.fillText("⚡命中", n.x, n.y - n.r - 9); }
  });
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function hexToRgba(hex: string, a: number): string {
  const c = hex.replace("#", ""); const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function apply(ctx: { slots: { inject: (name: string, factory: () => unknown) => void; register: (spec: Record<string, unknown>, component: unknown) => unknown }; locale: { bind: (ns: string) => (key: string) => string } }): void {
  ctx.locale.bind(NS);
  ctx.slots.inject("conversation.view", () =>
    ctx.slots.register(
      { name: "conversation.view", id: "okf-memory", order: 30, locale: NS, label: () => "记忆图谱" },
      MemoryGraphView,
    ),
  );
}
