# dsh-okf-memory

[简体中文](README.zh.md) | English

**Session-to-OKF memory plugin with neuro-self-learning: predictive recall, uncertainty-driven capture, reinforcement feedback, consolidation & forgetting.**

Turn high-value content from your conversations into persistent long-term memory, organized as [OKF v0.1](https://github.com/open-knowledge-format) knowledge documents. The agent gets smarter the more you use it — every selection, skip, and correction is a learning signal that updates memory weights.

## Features

- **Four-stage memory loop**: Capture → Concept-ize (OKF) → Consolidate → Recall
- **OKF v0.1 compliant**: every concept is a standard Markdown document (frontmatter hard-requires `type`), `index.md` progressive catalog + `log.md` change history, cross-links use bundle-absolute paths
- **Neuro-self-learning driver**: predictive recall (predict first, then verify by retrieval), uncertainty-driven exploration (expand search when confidence is low), prediction-error-driven capture (user corrections / first-time disclosures / counter-intuitive conclusions trigger writes), weight decay + archiving (consolidation & forgetting)
- **Reinforcement feedback loop**: `score = relevance × weight × recency`; selecting a candidate raises its weight, skipping lowers it
- **TechChoice memory**: frontend / backend / language / approach / config — one concept per dimension with an options table + active choice; three-tier selection rule (show all candidates, use the only candidate, or follow the matched dimension)
- **Write permission gate**: type validity → dedup (complement, never duplicate, cross-link) → OKF compliance check

## Install

```sh
# Any profile (e.g. web):
dsh plugin --profile web add dsh-okf-memory
# Or from a local path:
dsh plugin --profile web add ./dsh-okf-memory
```

Zero runtime dependencies (peer dependency `@deepseek-ai/cordis` is provided by the dsh runtime). Install and use — no build step, no build-script approval needed.

## Quick Start

The plugin registers 4 tools (`okf_remember` / `okf_search` / `okf_read` / `okf_forget`) and injects a "memory discipline" system prompt. The agent calls them autonomously during the session:

```
User:  Remember, my three stores are Shaoshan/Xiangxiang/Tanggxia, sharing a LAN folder
Agent: okf_remember(title="门店布局", type="Fact", content="# 核心\n\n三家门店共用局域网共享文件夹…", tags=["门店"])
       → Memory saved: fact/门店布局

User:  What frontend stack should we use? (not yet decided)
Agent: okf_search(query="前端", type="TechChoice") → no hit → no memory yet → ask the user per the three-tier rule
```

## Memory Library Layout

Default `~/.dsh/memory/` (overridable via `OKF_MEMORY_ROOT`):

```
~/.dsh/memory/
├── index.md              ← Progressive catalog (okf_version: "0.1")
├── log.md                ← Change history (## YYYY-MM-DD)
├── fact/                 ← Fact
├── preference/           ← Preference
├── decision/             ← Decision (three-section: Data / Analysis / Conclusion)
├── method/               ← Method
├── insight/              ← Insight
├── idea/                 ← Idea
├── lesson/               ← Lesson
├── techchoice/           ← TechChoice (Options table + Active)
└── .meta/weights.json    ← Learning weights (does not affect OKF compliance)
```

## TechChoice Three-Tier Rule (user-defined protocol)

1. **2+ candidates** matched → present **all** candidates to the user; never decide on your own
2. **1 candidate** → use it directly
3. No specific technology mentioned but a dimension keyword is hit (e.g. "frontend") → resolve via that dimension's memory
4. New technology / switch / config details → append-only update, never overwrite old candidates (keeps v1→vN evolution history)

## Configuration

| Item | How | Default |
|---|---|---|
| Memory root | env `OKF_MEMORY_ROOT` or settings `okfMemory.root` | `~/.dsh/memory/` |
| Learning params | `PARAMS` in `lib/learning.js` (decay days / archive threshold / …) | see file |

## Development & Testing

```sh
node scripts/smoke.js        # Core module functional tests (19 checks)
node scripts/integration.js  # Mock dsh ctx integration tests (24 checks)
```

## License

MIT
