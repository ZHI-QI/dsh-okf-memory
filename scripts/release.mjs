/**
 * release.mjs — npm 发布脚本:构建 → dry-run 校验 → 发布 → 验证。
 *
 * 用法(需先 npm login 或设置 NPM_TOKEN 环境变量):
 *   node scripts/release.mjs          # 发布当前版本
 *   node scripts/release.mjs patch    # bump patch 后发布
 *   node scripts/release.mjs minor    # bump minor 后发布
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`)
  return execSync(cmd, { cwd: root, stdio: 'inherit', ...opts })
}

function checkLogin() {
  try {
    run('npm whoami', { stdio: ['ignore', 'pipe', 'pipe'] })
    console.log('✓ 已登录 npm')
  } catch {
    console.error('\n✗ 未登录 npm。请先:')
    console.error('  1) 注册 https://www.npmjs.com/signup (需邮箱验证)')
    console.error('  2) npm login 或 export NPM_TOKEN=npm_xxx (Access Tokens → publish token)')
    process.exit(1)
  }
}

// 1. bump 版本(可选)
const bump = process.argv[2]
if (bump) {
  if (!['patch', 'minor', 'major'].includes(bump)) {
    console.error(`未知 bump: ${bump}(可选 patch/minor/major)`)
    process.exit(1)
  }
  run(`npm version ${bump} --no-git-tag-version`)
}

// 2. 检查登录
checkLogin()

// 3. 构建(TS → lib/)
run('pnpm build')

// 4. dry-run 校验包内容
run('npm publish --dry-run')

// 5. 正式发布
run('npm publish')

// 6. 验证
const pkg = JSON.parse(execSync('node -e "console.log(JSON.stringify(require(\'./package.json\')))"', { cwd: root }).toString())
console.log(`\n✓ 已发布 dsh-okf-memory@${pkg.version} → https://www.npmjs.com/package/dsh-okf-memory`)
