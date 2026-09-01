/**
 * dsh-okf-memory client(浏览器半) — 记忆图谱会话标签页。
 *
 * 契约:
 *  - package.json 声明 dsh.client { platform:'web', inject:[client服务] }
 *  - 本文件 export { inject, apply },构建为 lib/client.js
 *  - ctx.slots.inject("conversation.view", () => ctx.slots.register({id,order,label}, Component))
 *  - 组件 fetch 后端 /okf-graph 渲染力导向记忆图谱(节点=权重大小、颜色=type、边=交叉链接)
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
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    fetch("/okf-graph")
      .then((r) => r.json())
      .then((g) => {
        if (g.error) setError(g.error);
        else setGraph(g);
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  React.useEffect(() => {
    if (!graph || !canvasRef.current) return;
    drawGraph(canvasRef.current, graph);
  }, [graph]);

  if (error) return React.createElement("div", { style: p }, "记忆图谱加载失败: " + error);
  if (!graph) return React.createElement("div", { style: p }, "加载记忆图谱…");

  return React.createElement("div", { style: { padding: "12px" } },
    React.createElement("div", { style: { color: "#8aa4bd", fontSize: "12px", marginBottom: "8px" } },
      `${graph.nodes.length} 节点 · ${graph.edges.length} 边 · 节点大小=权重,颜色=类型`),
    React.createElement("canvas", { ref: canvasRef, style: { width: "100%", height: "calc(100vh - 160px)", display: "block" } }),
  );
}

const p: React.CSSProperties = { padding: "24px", color: "#8aa4bd", fontFamily: "sans-serif" };

// 简约力导向布局(节点=weight 半径,颜色=type,边=交叉链接)
function drawGraph(canvas: HTMLCanvasElement, graph: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 800, H = canvas.clientHeight || 500;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!; ctx.scale(dpr, dpr);

  const byId = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const maxW = Math.max(...graph.nodes.map((n) => n.weight), 1);
  const nodes: Array<GraphNode & { x: number; y: number; vx: number; vy: number; r: number }> = graph.nodes.map((n) => ({
    ...n, x: W / 2 + (Math.random() - 0.5) * 200, y: H / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0, r: 8 + Math.sqrt(n.weight / maxW) * 20,
  }));
  nodes.forEach((n) => byId.set(n.id, n));
  const edges = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  for (let it = 0; it < 120; it++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2), f = 3800 / d2;
      const fx = f * dx / d, fy = f * dy / d; a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
    nodes.forEach((n) => { n.vx += (W / 2 - n.x) * 0.0006; n.vy += (H / 2 - n.y) * 0.0006; });
    edges.forEach((e) => { const a = byId.get(e.source)!, b = byId.get(e.target)!; const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01, f = (d - 120) * 0.016; a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; });
    nodes.forEach((n) => { n.vx *= 0.85; n.vy *= 0.85; n.x += n.vx; n.y += n.vy; });
  }

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#13233a"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(120,160,200,.18)"; ctx.lineWidth = 1;
  edges.forEach((e) => { const a = byId.get(e.source)!, b = byId.get(e.target)!; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
  nodes.forEach((n) => {
    const c = TYPE_COLORS[n.type] || TYPE_COLORS.Other;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(n.title.slice(0, 10), n.x, n.y + n.r + 12);
  });
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
