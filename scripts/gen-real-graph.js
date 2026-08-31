/**
 * gen-real-graph.js — 用插件真实记忆库(~/.dsh/memory)生成 graph.json,验证 M1 okf_graph 数据层。
 * 输出:docs/real-graph.json
 * 用法:node scripts/gen-real-graph.js [记忆库根(默认 ~/.dsh/memory)]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(__dirname, '..', 'lib')
const root = process.argv[2] || path.join(os.homedir(), '.dsh', 'memory')

const graph = await import(pathToFileURL(path.join(lib, 'graph.js')).href)
const g = await graph.buildGraph(root)

const outPath = path.join(__dirname, '..', 'docs', 'real-graph.json')
await fs.writeFile(outPath, JSON.stringify(g, null, 2), 'utf8')
console.log('真实记忆库图谱已生成:', outPath)
console.log(`nodes=${g.nodes.length} edges=${g.edges.length} timeline=${g.timeline.length}`)
console.log('节点示例:', JSON.stringify(g.nodes.slice(0, 3), null, 2))
