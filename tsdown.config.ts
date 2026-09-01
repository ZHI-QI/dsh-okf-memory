import { defineConfig, type UserConfig } from "tsdown";

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

// server 半:保留现有 lib/index.js(EJS 源码,无需构建)
// 这里只输出 client。server 端仍用 src 之外的 lib/ (现有实现)。此配置只构建前端。
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

export default defineConfig([client]);
