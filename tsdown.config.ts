import { defineConfig, type UserConfig } from "tsdown";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ID = "dsh-okf-memory";

// 浏览器平台模块(DSH web bundle 提供,不打包)
const PLATFORM_MODULES = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-web-react",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-attachment",
  "@deepseek-ai/dsh-client-schema-form",
] as const;

// ── server 半:src/server/*.ts → lib/*.js(多入口 ESM,保持模块结构兼容测试脚本) ──
const SERVER_ENTRIES = {
  "index": "src/server/index.ts",
  "store": "src/server/store.ts",
  "concept": "src/server/concept.ts",
  "dedupe": "src/server/dedupe.ts",
  "graph": "src/server/graph.ts",
  "learning": "src/server/learning.ts",
  "recall": "src/server/recall.ts",
  "capture": "src/server/capture.ts",
} as const;

const server: UserConfig = {
  name: PACKAGE_ID,
  entry: SERVER_ENTRIES,
  outDir: "lib",
  format: ["esm"],
  platform: "node",
  target: "es2022",
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: false,
  alias: {
    "@": path.resolve(root, "./src"),
  },
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^node:/],
  },
};

// ── client 半:src/client/index.tsx → lib/client.js ──
const client: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: "src/client/index.tsx" },
  outDir: "lib",
  format: "cjs",
  platform: "browser",
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [...PLATFORM_MODULES],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
    "import.meta.env.MODE": JSON.stringify(process.env.NODE_ENV ?? "production"),
    "import.meta.env": JSON.stringify({ MODE: process.env.NODE_ENV ?? "production" }),
  },
  outputOptions: {
    entryFileNames: "client.js",
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: "return module.exports; } });",
    intro: "var module = { exports: {} }; var exports = module.exports;",
  },
};

export default defineConfig([server, client]);
