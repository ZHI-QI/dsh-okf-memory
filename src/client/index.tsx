/**
 * dsh-okf-memory client(浏览器半) — 记忆图谱会话标签页。
 *
 * 契约:
 *  - package.json 声明 dsh.client { platform:'web', inject:[client服务] }
 *  - ctx.slots.inject("conversation.view", ...) 注册对话视图标签
 *  - fetch 后端 /okf-graph → 力导向渲染
 *  - 交互:滚轮缩放 / 拖拽平移 / 拖节点 / 悬停显示详情 / 搜索命中+神经传导
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

type LayoutNode = GraphNode & { x: number; y: number; vx: number; vy: number; r: number };

function MemoryGraphView() {
  const [graph, setGraph] = React.useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const layoutRef = React.useRef<LayoutNode[]>([]);
  const viewRef = React.useRef({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = React.useRef<{ id: string | null; offX: number; offY: number; panning: boolean; lastX: number; lastY: number }>({ id: null, offX: 0, offY: 0, panning: false, lastX: 0, lastY: 0 });
  const hoverRef = React.useRef<string | null>(null);
  const [, forceRender] = React.useState(0); // 触发 tooltip 更新

  const queryRef = React.useRef("");
  queryRef.current = query;

  React.useEffect(() => {
    fetch("/okf-graph")
      .then((r) => r.json())
      .then((g) => { if (g.error) setError(g.error); else setGraph(g); })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  // 初始化布局(一次,稳定):世界坐标以(0,0)为中心,节点分布半径随数量自适应
  React.useEffect(() => {
    if (!graph || layoutRef.current.length) return;
    const maxW = Math.max(...graph.nodes.map((n) => n.weight), 1);
    const n = graph.nodes.length;
    const R = Math.max(120, Math.min(300, 60 + n * 30));
    layoutRef.current = graph.nodes.map((node, i) => {
      const h = hash(node.id);
      const ang = (i / n) * Math.PI * 2; // 环形均布 + 轻微抖动
      const r = R * (0.6 + ((h % 100) / 100) * 0.5);
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      return { ...node, x, y, vx: 0, vy: 0, r: 8 + Math.sqrt(node.weight / maxW) * 20 };
    });
  }, [graph]);

  // 缩放画布尺寸变化时重置 zoom
  React.useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const fit = () => { viewRef.current = { zoom: 1, panX: 0, panY: 0 }; };
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [graph]);

  // rAF 动画循环
  React.useEffect(() => {
    if (!graph || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let raf = 0;
    const render = () => { drawGraph(canvas, graph, queryRef.current, layoutRef, viewRef, hoverRef); raf = requestAnimationFrame(render); };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [graph]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const v = viewRef.current;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    v.zoom = Math.min(4, Math.max(0.3, v.zoom * factor));
    forceRender((x) => x + 1);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left), py = (e.clientY - rect.top);
    const cw = canvas.clientWidth || rect.width, ch = canvas.clientHeight || rect.height;
    const hit = hitTest(px, py, layoutRef.current, viewRef.current, cw, ch);
    if (hit) { dragRef.current = { id: hit.id, offX: hit.x - px, offY: hit.y - py, panning: false, lastX: px, lastY: py }; }
    else { dragRef.current = { id: null, offX: 0, offY: 0, panning: true, lastX: px, lastY: py }; }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left), py = (e.clientY - rect.top);
    const cw = canvas.clientWidth || rect.width, ch = canvas.clientHeight || rect.height;
    const d = dragRef.current;
    if (d.id) {
      const n = layoutRef.current.find((x) => x.id === d.id);
      if (n) {
        // 拖节点:用世界坐标(逆变换),offX 为世界坐标内偏移
        const wx = (px - cw / 2 - viewRef.current.panX) / viewRef.current.zoom;
        const wy = (py - ch / 2 - viewRef.current.panY) / viewRef.current.zoom;
        n.x = wx + d.offX; n.y = wy + d.offY; n.vx = 0; n.vy = 0;
      }
    } else if (d.panning) {
      viewRef.current.panX += px - d.lastX; viewRef.current.panY += py - d.lastY;
      d.lastX = px; d.lastY = py;
    }
    const hover = hitTest(px, py, layoutRef.current, viewRef.current, cw, ch)?.id ?? null;
    if (hover !== hoverRef.current) { hoverRef.current = hover; forceRender((x) => x + 1); }
  };
  const onMouseUp = () => { dragRef.current = { id: null, offX: 0, offY: 0, panning: false, lastX: 0, lastY: 0 }; };

  if (error) return React.createElement("div", { style: p }, "记忆图谱加载失败: " + error);
  if (!graph) return React.createElement("div", { style: p }, "加载记忆图谱…");

  const hover = layoutRef.current.find((n) => n.id === hoverRef.current);
  return React.createElement("div", { style: { padding: "12px", position: "relative" } },
    React.createElement("input", {
      value: query, onChange: (e) => setQuery(e.target.value),
      placeholder: "🔍 命中记忆(搜标题/类型/标签)…",
      style: { width: "100%", boxSizing: "border-box", padding: "9px 12px", marginBottom: "10px", borderRadius: "8px", border: "1px solid rgba(120,160,200,.3)", background: "rgba(20,32,46,.8)", color: "#dbe7f3", fontSize: "13px", outline: "none" },
    }),
    React.createElement("div", { style: { color: "#8aa4bd", fontSize: "12px", marginBottom: "8px" } },
      `${graph.nodes.length} 节点 · ${graph.edges.length} 边 · 滚轮缩放 · 拖拽平移 · 悬停查看详情 · 搜索命中→神经传导`),
    React.createElement("canvas", { ref: canvasRef, onWheel, onMouseDown, onMouseMove, onMouseUp, onMouseLeave: () => { hoverRef.current = null; forceRender((x) => x + 1); }, style: { width: "100%", height: "calc(100vh - 200px)", display: "block", cursor: "crosshair" } }),
    hover
      ? React.createElement("div", { style: { position: "absolute", left: "12px", bottom: "12px", background: "rgba(10,18,28,.95)", border: "1px solid " + (TYPE_COLORS[hover.type] || "#3b5a77"), borderRadius: "8px", padding: "9px 12px", fontSize: "12px", color: "#eaf3fb", maxWidth: "300px", boxShadow: "0 6px 20px rgba(0,0,0,.4)", zIndex: 5 } },
          React.createElement("b", null, hover.title), React.createElement("span", { style: { fontSize: "10px", padding: "1px 6px", borderRadius: "8px", background: (TYPE_COLORS[hover.type] || "#66") + "66", color: "#fff", marginLeft: "6px" } }, hover.type),
          React.createElement("div", { style: { color: "#9db8cf", marginTop: "4px" } }, "权重 " + hover.weight + " · " + hover.state),
          hover.description ? React.createElement("div", { style: { color: "#8aa4bd", marginTop: "3px" } }, hover.description) : null,
          (hover.tags && hover.tags.length) ? React.createElement("div", { style: { color: "#6f8ba5", marginTop: "3px", fontSize: "11px" } }, hover.tags.map((x) => "#" + x).join(" ")) : null,
        )
      : null,
  );
}
const p: React.CSSProperties = { padding: "24px", color: "#8aa4bd", fontFamily: "sans-serif" };

function matches(n: GraphNode, q: string): boolean {
  const t = q.trim().toLowerCase(); if (!t) return false;
  return (n.title + " " + n.type + " " + (n.tags || []).join(" ")).toLowerCase().includes(t);
}
function activateHits(nodes: GraphNode[], edges: GraphEdge[], hits: Set<string>): Set<string> {
  const act = new Set<string>(hits);
  const adj = new Map<string, string[]>();
  edges.forEach((e) => { if (!adj.has(e.source)) adj.set(e.source, []); if (!adj.has(e.target)) adj.set(e.target, []); adj.get(e.source)!.push(e.target); adj.get(e.target)!.push(e.source); });
  const q = [...hits];
  while (q.length) { const cur = q.shift()!; (adj.get(cur) || []).forEach((nb) => { if (!act.has(nb)) { act.add(nb); q.push(nb); } }); }
  return act;
}

function hitTest(px: number, py: number, nodes: LayoutNode[], view: { zoom: number; panX: number; panY: number }, canvasW: number, canvasH: number) {
  // 屏幕坐标 → 世界坐标(世界原点在画布中心 W/2,H/2)
  const wx = (px - canvasW / 2 - view.panX) / view.zoom, wy = (py - canvasH / 2 - view.panY) / view.zoom;
  for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i]; const dx = n.x - wx, dy = n.y - wy; if (dx * dx + dy * dy < (n.r + 6) * (n.r + 6)) return n; }
  return null;
}

function drawGraph(canvas: HTMLCanvasElement, graph: { nodes: GraphNode[]; edges: GraphEdge[] }, query: string, layoutRef: React.MutableRefObject<LayoutNode[]>, viewRef: React.MutableRefObject<{ zoom: number; panX: number; panY: number }>, hoverRef: React.MutableRefObject<string | null>) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 800, H = canvas.clientHeight || 500;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const view = viewRef.current;

  const maxW = Math.max(...graph.nodes.map((n) => n.weight), 1);
  const nodes = layoutRef.current;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  const hits = new Set<string>();
  if (query.trim()) graph.nodes.forEach((n) => { if (matches(n, query)) hits.add(n.id); });
  const active = activateHits(graph.nodes, graph.edges, hits);

  // 世界原点在画布中心:tx(x)=W/2 + x*zoom + panX
  const tx = (x: number) => W / 2 + x * view.zoom + view.panX;
  const ty = (y: number) => H / 2 + y * view.zoom + view.panY;

  ctx.fillStyle = "#13233a"; ctx.fillRect(0, 0, W, H);

  // 边
  edges.forEach((e) => {
    const a = byId.get(e.source)!, b = byId.get(e.target)!;
    const isActive = active.has(e.source) || active.has(e.target);
    ctx.beginPath(); ctx.moveTo(tx(a.x), ty(a.y)); ctx.lineTo(tx(b.x), ty(b.y));
    ctx.strokeStyle = isActive ? "rgba(126,195,255,.5)" : "rgba(120,160,200,.18)"; ctx.lineWidth = 1 / view.zoom; ctx.stroke();
  });

  const t = performance.now() / 700;
  nodes.forEach((n) => {
    const c = TYPE_COLORS[n.type] || TYPE_COLORS.Other;
    const isHit = hits.has(n.id), isActive = active.has(n.id);
    const rr = n.r * view.zoom;
    const x = tx(n.x), y = ty(n.y);
    if (isHit) {
      const tp = (t + hash(n.id) % 10) % 1;
      const pr = rr * (1.5 + tp * 1.8);
      ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.strokeStyle = hexToRgba(c, 0.8 * (1 - tp)); ctx.lineWidth = 2.5 / view.zoom; ctx.stroke();
    }
    if (isHit || isActive) {
      const rg = ctx.createRadialGradient(x, y, rr * 0.2, x, y, rr * (isHit ? 2.9 : 2.1));
      rg.addColorStop(0, hexToRgba(c, isHit ? 0.8 : 0.45)); rg.addColorStop(1, "transparent");
      ctx.beginPath(); ctx.arc(x, y, rr * (isHit ? 2.9 : 2.1), 0, Math.PI * 2); ctx.fillStyle = rg; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fillStyle = isActive ? (isHit ? "#fff" : c) : "#13233a"; ctx.globalAlpha = isActive ? 0.95 : 1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.strokeStyle = isHit ? "#fff" : (isActive ? c : "#33506a"); ctx.lineWidth = (isHit ? 3.2 : 1.2) / view.zoom; ctx.stroke();
    ctx.globalAlpha = 1;
    // 标签(缩放时字号随 zoom 微调,避免太小)
    ctx.fillStyle = isActive ? "#fff" : "#5f7d97"; ctx.font = `${11 * Math.min(1.4, Math.max(0.8, view.zoom))}px sans-serif`; ctx.textAlign = "center";
    ctx.fillText(n.title.slice(0, 10), x, y + rr + 12);
    if (isHit) { ctx.fillStyle = "#fff"; ctx.font = `700 ${11 * Math.max(0.8, view.zoom)}px sans-serif`; ctx.fillText("⚡命中", x, y - rr - 9); }
  });
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function hexToRgba(hex: string, a: number): string { const c = hex.replace("#", ""); const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16); return `rgba(${r},${g},${b},${a})`; }

export function apply(ctx: { slots: { inject: (name: string, factory: () => unknown) => void; register: (spec: Record<string, unknown>, component: unknown) => unknown }; locale: { bind: (ns: string) => (key: string) => string } }): void {
  ctx.locale.bind(NS);
  ctx.slots.inject("conversation.view", () =>
    ctx.slots.register(
      { name: "conversation.view", id: "okf-memory", order: 30, locale: NS, label: () => "记忆图谱" },
      MemoryGraphView,
    ),
  );
}
