# dsh-okf-memory

[English](README.en.md) | 简体中文

**会话记忆 → OKF 知识沉淀插件(神经自我学习驱动)**

把会话中高价值内容按 [OKF v0.1](https://github.com/open-knowledge-format) 规范自动沉淀为长期记忆,跨会话自动唤起。Agent 越用越准:每次选择、跳过、纠错都是学习信号,记忆权重持续更新。

**Session-to-OKF memory plugin with neuro-self-learning: predictive recall, uncertainty-driven capture, reinforcement feedback, consolidation & forgetting.**

[![dshfind](https://dshfind.com/api/card/ZHI-QI/dsh-okf-memory?lang=zh)](https://dshfind.com/zh/plugins/ZHI-QI/dsh-okf-memory?ref=badge)

## 特性

- **记忆四阶段闭环**:捕获 → 概念化 → 沉淀 → 唤起
- **OKF v0.1 合规**:每个概念是标准 Markdown 文档(frontmatter 硬要求 `type`),`index.md` 渐进式目录 + `log.md` 变更历史,交叉链接用包内绝对路径
- **神经自我学习驱动**:预测性唤起(先预测再检索校验)、不确定性量化(置信低扩大探索)、预测误差驱动捕获(用户纠正/首次披露触发写入)、权重衰减+归档(巩固与遗忘)
- **强化反馈回路**:`score = relevance × weight × recency`,用户选中候选权重↑、跳过权重↓
- **技术选型记忆(TechChoice)**:前端/后端/语言/方案/配置 按维度沉淀候选表 + 当前使用;三档选择规则(多候选展示、单候选直用、领域命中按维度)
- **写入许可门**:type 合法性 → 去重(互补不复制,互建交叉链接)→ OKF 符合性校验

## 安装

```sh
# 任意 profile(如 web):
dsh plugin --profile web add dsh-okf-memory
# 或从本地路径:
dsh plugin --profile web add ./dsh-okf-memory
# 或从 GitHub(拉取源码,需 prepare 构建并向用户授权构建):
dsh plugin --profile web add github:ZHI-QI/dsh-okf-memory
# 或发布到 npm 后免构建授权安装:
dsh plugin --profile web add dsh-okf-memory
```

插件零运行时依赖(peer 依赖 `@deepseek-ai/cordis` 由 dsh 运行时提供),安装即用,无需构建脚本。

## 如何使用

装好后你**无需手敲命令**。插件会给 Agent 注入一段「记忆纪律」系统提示,让它在会话里**自主判断**该记什么、该查什么,并调用下面的工具完成。你也可以随时显式地说「记住XX」或「查一下记忆里关于XX的」来主动触发。

### 4 个工具一览

| 工具 | 作用 | 什么时候用 |
|---|---|---|
| `okf_remember` | 写入一条记忆(自动去重、校验、落盘) | 有值得沉淀的新知识时 |
| `okf_search` | 按关键词召回,按权重/近因排序 | 开场预取、回答前找相关记忆 |
| `okf_read` | 精读某条全量(含交叉链接),并记录一次使用反馈 | 需要完整细节时 |
| `okf_forget` | 撤回一条记忆 | 记错 / 不需要时 |

### 让它记住(写入)

- **自动(推荐)**:你在对话里披露新事实、拍板决策、纠正 Agent、提到技术选型时,Agent 会**自己判断**是否值得记,不用你开口。
- **手动**:直接说「记住…」即可触发,例如 `记住,我的三家门店是韶山/湘乡/塘厦,共用局域网共享文件夹`。

**什么才算「值得记」**:新背景事实/偏好、决策及理由、可复用方法论/流程/经验教训、用户纠正、被确认的反直觉结论、技术选型。
**不记**:寒暄、单轮临时任务、已有记忆的重复内容、未验证的猜测(猜测归入 `Idea`,等成熟再沉淀)。

### 让它回忆(召回)

- 你问相关问题时,Agent 会先 `okf_search` 召回再作答。
- 也可显式说「查一下记忆里关于XX的」。
- **检索不到会明确告诉你「记忆库没有」,不会编造**。

### 技术选型怎么用(TechChoice)

针对前端/后端/语言/方案/配置这类选型,插件按「三档规则」处理(细节见下文「技术选型三档规则」专节):命中 2+ 候选 → 全部展示给你选;命中 1 个 → 直接用;你未指定技术但命中维度关键词(如「前端」)→ 按该维度记忆处理;你提出新方案/切换/配置 → 追加式更新,不覆盖旧候选。

### 示例:怎么记、怎么查

```text
// ① 记一条门店事实(Fact)
用户: 记住,我的三家门店是韶山/湘乡/塘厦,共用局域网共享文件夹
Agent: okf_remember(title="门店布局", type="Fact",
        content="# 核心\n\n三家门店共用局域网共享文件夹…", tags=["门店"])
       → 已沉淀记忆 fact/门店布局

// ② 记住前端方案(TechChoice)
用户: 前端就用 React 18 + Vite 吧
Agent: okf_remember(type="TechChoice", title="前端方案",
        content="## Options\n\n| 候选 | 状态 |\n|---|---|\n| React 18 + Vite | active |",
        tags=["前端","技术选型"])

// ③ 问数据库时先召回(而不是去翻本地文件)
用户: 帮我查询数据库
Agent: okf_search(query="查询数据库")
       → 命中「鼎赞数据统一用 mcp-dezensaas-mysql」
       → 按该记忆走 mcp-dezensaas-mysql 服务
```

## 记忆库结构

默认 `~/.dsh/memory/`(环境变量 `OKF_MEMORY_ROOT` 覆盖):

```
~/.dsh/memory/
├── index.md              ← 渐进式目录(okf_version: "0.1")
├── log.md                ← 变更历史(## YYYY-MM-DD)
├── fact/                 ← Fact 背景事实
├── preference/           ← Preference 用户偏好
├── decision/             ← Decision 决策(三段式:数据/分析/结论)
├── method/               ← Method 方法论
├── insight/              ← Insight 洞察
├── idea/                 ← Idea 未成型灵感
├── lesson/               ← Lesson 经验教训
├── techchoice/           ← TechChoice 技术选型(Options 候选表 + Active)
└── .meta/weights.json    ← 学习权重元数据(不污染 OKF 符合性)
```

## 技术选型三档规则(用户既定协议)

1. 命中 2+ 候选 → **全部展示给用户选择**,不擅自决定
2. 命中 1 个候选 → 直接使用
3. 用户未指定技术但命中维度关键词(如"前端")→ 按该维度记忆处理
4. 用户说出新技术/切换/配置 → 追加式更新,不覆盖旧候选(保留 v1→vN 迭代轨迹)

## 配置

| 项 | 方式 | 默认 |
|---|---|---|
| 记忆库根目录 | 环境变量 `OKF_MEMORY_ROOT` 或 settings `okfMemory.root` | `~/.dsh/memory/` |
| 学习参数 | `lib/learning.js` 中 `PARAMS`(衰减天数/归档阈值等) | 见文件 |

## 开发与测试

```sh
npm test                      # 全量测试(smoke + integration + schema + concurrency)
node scripts/smoke.js         # 核心模块功能验证(含并发写锁断言)
node scripts/integration.js   # mock dsh ctx 集成验证(含错误路径断言)
node scripts/schema-check.js  # 工具 schema 合规
node scripts/concurrency.js   # 写锁并发压测(50 并行写 / 20 并行反馈)
```

## License

MIT
