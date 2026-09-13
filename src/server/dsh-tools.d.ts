/**
 * 可选宿主依赖的环境声明。
 *
 * `@deepseek-ai/dsh-tools` 只在 dsh 运行时提供,本包不将其列为依赖。
 * src/server/index.ts 用动态 import + try/catch 做降级,因此这里声明一个
 * 宽松的模块形状即可,避免 tsc 报「找不到模块」。
 */
declare module '@deepseek-ai/dsh-tools' {
  /** 官方工具定义包装器(缺失时调用方会降级为透传原对象) */
  export const defineTool: ((def: unknown) => unknown) | undefined
}
