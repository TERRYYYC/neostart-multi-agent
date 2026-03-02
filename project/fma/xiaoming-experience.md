# 小明的经验手册 / Xiaoming's Experience Manual

> **命名说明**：「小明」是中国式「别人家孩子」的代称——那个永远考满分、不走弯路的假想对手。这本手册收录的，是小明从不需要亲身踩坑就能掌握的经验。你可能不是小明，但你可以用小明的眼光看问题。

> **使用方式**：本文不是施工图（那是 `future-structure.md`），而是**判断框架**。当你在两种方案之间纠结时，来这里找依据。

---

## 第一章：Multi-Agent 的本质误区

### ❌ 误区 1：Multi-Agent = 更多 Agent

新手的本能反应是：任务太复杂？加个 Agent。结果变成「Agent 通货膨胀」——十几个 Agent 各自为政，协调成本远高于收益。

**正确认知**：Agent 数量是成本，不是能力。每增加一个 Agent：
- 延迟增加（至少一次 LLM 调用）
- 上下文传递出错的概率增加
- 调试复杂度以指数级上升

**小明的标准**：一个 Agent 的职责必须能用一句话说清楚，且不与其他 Agent 重叠。FMA 的 Planner / Coder / Reviewer 三个 Agent 均满足此标准。

---

### ❌ 误区 2：System Prompt 是配置，不是产品

大多数人把 system prompt 当成「设置一次就忘」的东西。小明知道：**system prompt 是 Agent 的灵魂，是产品的核心竞争力**。

质量差的 system prompt 症状：
- Agent 越界：Planner 开始写代码（职责污染）
- 输出格式不稳定：有时是 Markdown，有时是纯文本
- 幻觉率高：Agent 编造不存在的函数

**小明的标准**：
1. System prompt 必须有**边界条款**（「你的 ONLY job 是...」「Do NOT...」）
2. 输出格式必须**显式规定**（`## Goal / ## Steps / ## Decisions`）
3. System prompt 要像代码一样**版本化**，每次修改记录原因
4. 可量化：改 system prompt 后必须 benchmark，不能凭感觉判断好坏

**来源**：p001 skill-creator 的 eval loop 方法论、p006 lesson-03 meta-rules

---

### ❌ 误区 3：线性流水线能解决所有问题

线性流水线的致命缺陷：**没有反馈机制**。Reviewer 发现 P1 bug，只能打印出来，无法自动让 Coder 修复。这在现实中意味着：你构建了一个「只能成功，不能自我修复」的脆弱系统。

**小明的标准**：任何 multi-agent 系统，早晚需要**条件边**（conditional edges）：
- `如果 Reviewer 发现 P1 问题 → 回到 Coder`
- `如果重试 3 次仍失败 → 升级到 Human`
- `如果 Tester 全部通过 → 结束`

这不是高级功能，这是基本需求。MVP 可以不实现，但必须在架构上为它留位置。

**来源**：LangGraph 的核心设计哲学、p006 lesson-04（A2A 路由的 Path Unification）

---

## 第二章：上下文工程（Context Engineering）

> Boris Tane（p003）把这个叫做「AI 时代最核心的工程师技能」。他是对的。

### 原则 1：上下文是资产，不是开销

大多数人把「压缩 prompt 省 token」当成优化目标。小明知道：**上下文质量决定输出质量**，过度压缩等于「给外科医生蒙眼做手术」。

**核心矛盾**：LLM 有上下文窗口限制，但有效的 Agent 需要足够的背景信息。

**正确解法**：不是压缩，是**分层加载**（参考 p001 的三层 Progressive Disclosure）：
```
Layer 1（始终加载）：任务描述 + 当前 Agent 职责（< 200 tokens）
Layer 2（按需加载）：相关的历史决策 + ADR（< 1000 tokens）
Layer 3（按需加载）：完整的上下文文件（> 1000 tokens，谨慎使用）
```

---

### 原则 2：Context Cleaner 原则（展示层 ≠ 推理层）

**来自 p006 lesson-07**，这是被真实事故验证的教训。

- 用户看到的：格式化的 Rich Blocks、代码高亮、Markdown 渲染
- AI 接收的：精简的 JSON 摘要、纯文本状态
- **永远不要把 UI 渲染信息传给 AI**

违反这条原则的后果：AI 开始推理 HTML 标签的含义，而不是推理业务逻辑。Token 浪费 50%+，输出质量下降。

```
❌ 错误：把用户界面的完整 HTML 传给 AI
✅ 正确：提取语义信息，制作精简摘要传给 AI

用户看到："```typescript\nfunction validate(email: string) {...}```"
AI 接收：{type: "code", lang: "typescript", function: "validate", purpose: "email validation"}
```

---

### 原则 3：Handoff 必须包含 WHY，不只是 WHAT

**来自 p006 lesson-03**。Agent 间的交接是最容易丢失信息的地方。

❌ 错误的 handoff：
```
给 Coder 的消息："请实现以下功能：email 验证"
```

✅ 正确的 handoff：
```
给 Coder 的消息：
  任务：email 验证
  计划：使用正则 + DNS 验证双重校验（原因：纯正则有 3 个已知边缘案例）
  决策：不使用第三方库（原因：安全审查要求 zero runtime deps）
  约束：必须支持国际域名（原因：用户群体包括中文域名用户）
```

信息越完整，下游 Agent 出错率越低。上下文传递成本 << 重新生成成本。

---

### 原则 4：Session 管理比所有人想象的都难

**来自 p006 lesson-08（5 层 Session Chain）**。

Session 失效的典型场景：
1. 上下文窗口满了，Agent 开始「忘记」早期决策
2. 新 Session 没有继承上一 Session 的关键状态
3. Thread ID 绑定错误，状态污染到其他任务（p006 的血泪教训）

**小明的解法（5 层链）**：
```
1. Detect：监控 context 健康度（剩余 token < 阈值时预警）
2. Seal：主动封存当前 session（不要等到崩溃）
3. Archive：把完整 transcript 写入持久化存储
4. Query：新 session 可以查询历史（MCP 工具形式）
5. Resurrect：新 session 读取摘要 + 关键决策，继承上下文
```

**Thread Affinity 原则**：所有有状态的对象必须显式绑定 threadId。缺少这个绑定，状态会在不同任务间污染。

---

## 第三章：数据安全（Architecture, Not Discipline）

> p006 的 28 秒事故是这个章节的终极论据。

### 核心认知：数据安全是架构问题，不是纪律问题

2026 年 2 月 9-11 日，p006 cat-café 经历了：
- Codex 误删 Redis keys（第一次事故）
- Claude 在隔离 worktree 修改 TS → 文件监听器跨目录触发 → 服务重启 → 28 秒内 307 个 key 缩减到 15 个（第二次事故）

这两次事故的共同原因：**依赖 Agent 的「纪律」，而不是架构的「强制」**。

**三层防御（必须同时存在，缺一不可）：**

```
Layer 1 — 物理隔离（Physical Isolation）
  dev Redis: port 6398
  prod Redis: port 6399
  .env.local 强制指定，进程无法越界

Layer 2 — 结构防火墙（Structural Firewall）
  写入前 schema 校验（zod）
  目录大小上限检查（防止 Agent 乱写文件）
  危险命令黑名单（Redis FLUSHALL / DEL * 等）

Layer 3 — 正确性证明（Property Testing）
  状态机 spec 文档化
  fast-check 500 轮随机测试
  CI 门控：测试不过，不能部署
```

---

## 第四章：可观测性（Observability First）

> 「你无法修复你看不见的问题。」— 分布式系统第一定律

### 原则：可观测性不是后期加的，是从 Day 1 设计的

p006 的事故之所以能在 28 秒内被发现，是因为有 Redis key 数量监控。没有这个监控，事故可能持续数小时。

**三个可观测性层次：**

```
Level 1 — 结构化日志（从 Phase 3 开始）
  每条日志包含：timestamp, taskId, agentName, eventType, durationMs
  格式：JSON，不是 console.log 字符串
  好处：可查询，可过滤，可告警

Level 2 — 事件流（Phase 5 开始）
  每个 Agent 的 start / complete / error 是事件
  SSE 推到前端，用户看到实时进度
  存储到 Redis，支持历史回放

Level 3 — 追踪（Phase 6+）
  任务的完整调用链（类似 OpenTelemetry）
  可以回放一次任务的完整执行过程
  调试 Agent 行为时的杀手锏
```

---

## 第五章：成本工程（Cost Engineering）

> 不懂成本的 AI 产品，要么死在 API 账单上，要么死在用户等待上。

### 原则 1：模型分层，不是所有任务都要 Opus

| 任务类型 | 推荐模型 | 理由 |
|----------|----------|------|
| 深度推理、架构规划（Planner） | claude-opus-4-5 | 推理质量决定整体成本 |
| 代码生成（Coder） | claude-sonnet-4-5 | 平衡质量与速度 |
| 结构化审查（Reviewer） | claude-haiku-4-5 | 格式固定，不需要深度推理 |
| 快速分类、路由决策 | claude-haiku-4-5 | 最便宜，延迟最低 |

**经验数据**：合理分层可降低 60-70% API 成本，质量损失 < 5%。

### 原则 2：Token 使用必须可量化

- 每次 Agent 调用记录：input tokens + output tokens + cost（USD）
- 任务级别汇总：这个任务花了多少钱？
- 周/月统计：成本趋势是否可控？

不量化就不知道优化方向。

### 原则 3：缓存是第一性的成本优化

相同的 Planner system prompt + 相似的 task → 大概率相似的输出 → 值得缓存。

Anthropic 的 Prompt Caching 可以对 system prompt 部分缓存（命中时 token 成本降低 90%）。这是 Phase 2 就应该加入的优化。

---

## 第六章：测试策略（Testing Strategy）

> 「Unit testing agents is like testing a random number generator with fixed seeds。」

### 原则：Property Testing > Unit Testing，针对 Agent

LLM 输出本质上是非确定性的。固定输入 → 固定输出的 unit test 对 Agent 意义有限。

**正确策略（参考 p006 的 fast-check 应用）：**

```
Level 1 — 结构断言（Structure Assertions）
  断言输出 format 是否符合规定（有 ## Goal / ## Steps 吗？）
  不断言内容，断言结构
  成本：低，可跑在 CI

Level 2 — 行为 Property Testing
  100+ 随机任务输入 → 断言输出的不变式
  例如："Planner 的输出永远不含代码块"
  例如："Reviewer 的输出永远包含 P1/P2/P3 章节"
  成本：中，按天跑

Level 3 — 端到端 Golden Dataset
  20-50 个「黄金任务」（已知期望输出）
  定期跑，检测 system prompt 退化
  比较新旧版本输出质量
  成本：高，按版本跑
```

---

## 第七章：人机协作（Human-in-the-Loop）

### 原则：Human-in-Loop 是设计，不是降级

很多人把「需要人工介入」当成系统的弱点。小明知道：**在正确的地方加人工确认，是提升可靠性的主动选择**。

**正确的 Human-in-Loop 放置点：**
```
✅ 正确位置：
  - Reviewer 发现 P1 问题超过阈值（影响关键路径的决策）
  - Agent 重试 N 次仍失败（系统无法自主恢复）
  - 任务涉及不可逆操作（删除文件、发布代码）
  - 成本超过阈值（这次任务预计花 $5，继续吗？）

❌ 错误位置：
  - 每次 API 调用都确认（用户体验灾难）
  - 只在最后输出时确认（问题发现太晚）
  - 没有 Human checkpoint（完全自动化的脆弱系统）
```

**`--auto-approve` 模式**：CI 环境下必须支持跳过所有 human check，但必须有完整日志记录所有跳过的决策点。

---

## 第八章：多模型策略（Multi-Model Strategy）

**来自 p006 ADR-001 + lesson-01 的核心教训：**

### 为什么需要多模型？

1. **冗余**：Claude API 有时延迟高或故障，Gemini 可以接管
2. **成本优化**：某些任务用 GPT-3.5/Haiku 足够，不必 Opus
3. **能力互补**：Codex 在代码补全上有独特优势
4. **订阅 vs API**：Claude Plus 订阅无法通过 SDK 使用，只能 CLI

### CLI > SDK 的边界条件

| 情况 | 推荐 |
|------|------|
| 只用 Claude，有 API Key | SDK（代码简洁） |
| 需要 Claude Plus 订阅（无 API Key） | CLI |
| 需要 Gemini 或 Codex | CLI（SDK 不支持多模型） |
| 生产系统，需要重试/超时控制 | CLI（更细粒度控制） |
| 快速原型，单模型 | SDK |

FMA 当前在 SDK，Phase 2 切换 CLI，这是正确的演进顺序。

---

## 第九章：架构哲学

### 定律 1：「Run first, optimize later」——但要知道优化什么

p003 引用的原则，经常被误解为「不要设计」。正确理解是：**先有可运行的系统，再基于实测数据优化，不要基于假设优化**。

FMA 的演进就是这个原则的体现：先有能跑的 v0.1，再根据实际使用中暴露的问题决定 Phase 2 的方向。

### 定律 2：「可插拔层」是扩展性的核心

所有架构决策中，「可插拔层」是最重要的一条。`core/agent.ts` 是当前 FMA 最关键的可插拔层——它上面是稳定的 Agent 接口，它下面是可替换的 SDK/CLI 实现。

判断一个层是否真正「可插拔」的标准：**换掉它，上层代码需要修改多少行？如果是 0 行，设计正确。**

### 定律 3：「复杂度预算」

每个系统都有有限的复杂度预算。把预算花在核心差异化能力上（Agent 质量、图编排逻辑），而不是花在基础设施重复造轮子上（用成熟的 Redis、Fastify、Next.js）。

FMA 的复杂度预算应该花在：
- 高质量的 system prompt 设计
- 图编排的条件边逻辑
- Context Cleaner 的精准实现

不应该花在：
- 自研数据库
- 自研 UI 框架
- 自研消息队列（Phase 3 用 Filesystem Queue 就够）

### 定律 4：「博伊斯工作流」的核心是留下书面痕迹

Boris Tane 的方法论（p003）最关键的洞察：**所有重要的思考必须落成文字（Research.md / Plan.md / ADR）**，因为：
- 文字是可审查的（Code Review 的本质）
- 文字是可追溯的（为什么做这个决定？）
- 文字迫使思维清晰化（「如果我解释不清楚，说明我没想清楚」）

FMA 的 `future-structure.md` / `xiaoming-experience.md` / ADR 体系，就是这个原则的实践。

---

## 速查卡 / Quick Reference Card

```
当你在两个方案之间纠结时，问以下问题：

1. 哪个方案可观测性更好？ → 选那个
2. 哪个方案的可插拔层更干净？ → 选那个
3. 哪个方案失败时更容易调试？ → 选那个
4. 哪个方案上层代码改动更少？ → 选那个
5. 哪个方案能让新人 30 分钟看懂？ → 选那个

如果两个方案在以上都相同，选更简单的那个。
```

---

*版本：v1.0 | 日期：2026-03-01*
*来源：p003 Boris Tane + p006 cat-café + p004 swarm-ide + LangGraph / AutoGen / CrewAI 最佳实践*
