# dsh-okf-memory

[English](README.en.md) | 简体中文

**会话记忆 → OKF 知识沉淀插件(神经自我学习驱动)**

把会话中高价值内容按 [OKF v0.1](https://github.com/open-knowledge-format) 规范自动沉淀为长期记忆,跨会话自动唤起。Agent 越用越准:每次选择、跳过、纠错都是学习信号,记忆权重持续更新。

**Session-to-OKF memory plugin with neuro-self-learning: predictive recall, uncertainty-driven capture, reinforcement feedback, consolidation & forgetting.**

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
```

插件零运行时依赖(peer 依赖 `@deepseek-ai/cordis` 由 dsh 运行时提供),安装即用,无需构建脚本。

## 快速使用

插件注册 4 个工具(`okf_remember` / `okf_search` / `okf_read` / `okf_forget`)并注入"记忆纪律"系统提示。Agent 在会话中自主调用:

```
用户: 记住,我的三家门店是韶山/湘乡/塘厦,共用局域网共享文件夹
Agent: okf_remember(title="门店布局", type="Fact", content="# 核心\n\n三家门店共用局域网共享文件夹…", tags=["门店"])
       → 已沉淀记忆 fact/门店布局

用户: 前端用什么?(此前未定)
Agent: okf_search(query="前端", type="TechChoice") → 未命中 → 无记忆,按三档规则直接询问用户
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
node scripts/smoke.js        # 核心模块功能验证(19 项)
node scripts/integration.js  # mock dsh ctx 集成验证(24 项)
```

## License

MIT
