/**
 * schema-check.js — 递归检查所有工具 schema 的 object 节点是否显式声明 additionalProperties。
 * dsh schema 编译器硬要求:任何 object 节点必须有 additionalProperties: true|false。
 * 用法:node scripts/schema-check.js
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(__dirname, '..', 'lib')

// mock ctx 捕获工具定义
const registered = []
const ctx = {
  settings: {},
  tools: { register: (d) => registered.push(d) },
  provide() {},
  on() {},
  systemPrompt: { add() {} },
}

const mod = await import(pathToFileURL(path.join(lib, 'index.js')).href)
await mod.apply(ctx)

/** 递归检查 schema:所有 object 节点必须显式 additionalProperties */
function checkNode(node, nodePath, problems) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'object' && !('additionalProperties' in node)) {
    problems.push(`${nodePath}: object 节点缺少 additionalProperties`)
  }
  if (Array.isArray(node.type) && node.type.includes('object') && !('additionalProperties' in node)) {
    problems.push(`${nodePath}: object 联合节点缺少 additionalProperties`)
  }
  // properties
  if (node.properties && typeof node.properties === 'object') {
    for (const [k, v] of Object.entries(node.properties)) {
      checkNode(v, `${nodePath}.properties.${k}`, problems)
    }
  }
  // items(数组元素)
  if (node.items) checkNode(node.items, `${nodePath}.items`, problems)
  // additionalProperties 子节点
  if (node.additionalProperties && typeof node.additionalProperties === 'object' && node.additionalProperties.type) {
    checkNode(node.additionalProperties, `${nodePath}.additionalProperties`, problems)
  }
}

let problems = []
for (const tool of registered) {
  if (tool.output?.schema) checkNode(tool.output.schema, `${tool.name}.output.schema`, problems)
  if (tool.parameters) checkNode(tool.parameters, `${tool.name}.parameters`, problems)
}

if (problems.length > 0) {
  console.log(`✗ ${problems.length} 处 schema 问题:`)
  for (const p of problems) console.log('  ' + p)
  process.exit(1)
}
console.log(`✓ ${registered.length} 个工具的 schema 全部显式声明 additionalProperties,无嵌套缺失`)
