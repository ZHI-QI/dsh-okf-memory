/**
 * dsh-okf-memory client(浏览器半) — 记忆图谱会话标签页。
 *
 * 契约(参考 dsh-okf 已验证做法 + 官方 client-modules):
 *  - package.json 声明 dsh.client { platform:'web', inject:[client服务] }
 *  - 本文件 export { inject, apply },构建为 lib/client.js(经 window.__ModuleLoader__.load)
 *  - 用 ctx.slots.inject(slot, () => ctx.slots.register(...)) 注册对话视图标签
 *
 * 只保留「记忆图谱」一个视图,没有记忆流/学习热力等其他页面。
 */
import React from "react";

// 注入的 client 服务(简化为最小集;随 DSH 版本可能需调整)
export const inject = ["slots", "locale"];

type ClientApplyContext = {
  slots: {
    inject: (name: string, factory: () => unknown) => void;
    register: (spec: Record<string, unknown>, component: unknown) => unknown;
  };
  locale: {
    register: (ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }) => () => void;
    bind: (ns: string) => (key: string) => string;
  };
};

const NS = "okf-memory";

// 记忆图谱视图:占位,后续接 okf_graph 数据渲染力导向图
function MemoryGraphView() {
  return React.createElement(
    "div",
    { style: { padding: "16px", color: "#dbe7f3", fontFamily: "sans-serif" } },
    React.createElement("h3", null, "🧠 记忆图谱"),
    React.createElement(
      "p",
      null,
      "这里将渲染 okf_graph 导出的记忆图谱(节点/边/权重)。仅此一个视图。",
    ),
  );
}

export function apply(ctx: ClientApplyContext): void {
  const t = ctx.locale.bind(NS);
  void t;
  // 在对话视图注册「记忆图谱」标签(参考 dsh-okf 的 conversation.view 做法)
  ctx.slots.inject("conversation.view", () =>
    ctx.slots.register(
      {
        name: "conversation.view",
        id: "okf-memory",
        order: 30,
        locale: NS,
        label: () => "记忆图谱",
      },
      MemoryGraphView,
    ),
  );
}
