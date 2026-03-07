# FMA 差距与整体计划

## 1. 目标

本文用于回答三个问题：

1. `FMA` 当前已经做到什么程度？
2. `cat-cafe` 目标能力相对 `FMA` 还缺什么？
3. 接下来项目应按什么顺序推进，才能既保留已有资产，又避免返工？

结论先行：

- `FMA` 已经具备可复用的运行底座，但还不是 `cat-cafe` 所需的完整多代理协作工作台。
- `cat-cafe` 的核心不是“把聊天 UI 做复杂”，而是建立一套稳定的多代理运行时对象模型与可见性模型。
- 下一步不应直接进入页面复刻，而应先完成共享底座定义，再做最小垂直切片。

---

## 2. 当前开发状态标注

## 2.1 FMA 当前状态

`FMA` 当前可以视为：

- 一个可运行的多模型 Agent Pipeline
- 一个可运行的 Web Chat + SSE 工作台雏形
- 一个有基本可观测性与持久化能力的本地 AI runtime

### 已完成

- 顺序 Pipeline：`Planner -> Coder -> Reviewer`
- 独立 Agent prompt 与角色边界
- CLI subprocess 多模型调用：Claude / Codex / Gemini
- Web Chat 模式
- Web Pipeline 模式
- SSE 流式输出
- 基础 Conversation 持久化（JSON）
- 基础结构化日志、token usage、timing、重试、超时、进程清理

### 当前定位

`FMA` 更像：

- “单会话聊天 + 固定流水线 Agent 工具”

而不是：

- “多代理协作操作系统”

### 当前限制

- 核心对象仍以 `Conversation / Message / TaskContext` 为主
- 没有 `Thread / Invocation / Session / Handoff / Visibility` 的一等建模
- 没有真正的 A2A 路由
- 没有公开消息与私有执行日志隔离
- 没有右侧运行态工作台
- 没有配置治理中心

---

## 2.2 cat-cafe 当前状态

`cat-cafe` 当前仍处于“分析与定义阶段”，不是实现阶段。

### 已完成

- 关键截图与 DEMO 的拆解分析
- 对主要模块的逆向理解
- 对核心实体的候选建模
- 对模块依赖关系与开发顺序的初步判断

### 未完成

- v1 统一数据模型
- v1 统一事件模型
- v1 API / 服务边界
- v1 session 策略定稿
- v1 可见性策略定稿
- 任意一条完整的实现链路

### 当前阶段判断

项目现在属于：

- `Phase A: Architecture Definition`

还不属于：

- `Phase B: Feature Implementation`

---

## 3. FMA 与 cat-cafe 的核心差距

## 3.1 对象模型差距

FMA 当前核心对象偏简单：

- `Conversation`
- `Message`
- `TaskContext`

cat-cafe 需要的核心对象更完整：

- `Thread`
- `Message`
- `AgentProfile`
- `AgentInvocation`
- `AgentSession`
- `SessionHandoff`
- `EventLog`
- `Visibility`
- `WorkspaceBinding`

这意味着差距不在“多几个字段”，而在“产品的真实骨架不同”。

---

## 3.2 调度模型差距

FMA 当前是固定线性链：

- 用户输入
- Planner
- Coder
- Reviewer

cat-cafe 需要的是可动态路由的多代理协作：

- 用户 `@猫猫`
- 生成 invocation
- 允许 A2A 子调用
- 允许结果回流
- 允许状态追踪

因此，FMA 的 orchestrator 需要升级为 runtime scheduler。

---

## 3.3 会话模型差距

FMA 当前有 conversation 持久化，但没有按代理拆开的 session 生命周期。

cat-cafe 明确需要：

- 每只猫在每个 Thread 中拥有独立 session
- session 可处于 `ACTIVE / SEALED`
- context 接近阈值时触发 handoff
- 新 session 接收旧 session 摘要
- 右栏展示 Session Chain

所以 `session` 在 cat-cafe 中不是实现细节，而是一等能力。

---

## 3.4 可见性模型差距

FMA 当前基本只有“可公开展示的输出流”。

cat-cafe 明确要求区分：

- `public`
- `private`
- `system-summary`

这决定了：

- 主聊天流展示什么
- 状态栏展示什么
- 审计日志展示什么
- A2A 内部工具日志是否进入聊天区

这是底层事件总线设计问题，不是前端隐藏逻辑问题。

---

## 3.5 工作台形态差距

FMA 已有侧栏和主内容区，但仍偏聊天产品。

cat-cafe 目标工作台是：

- 左栏：Thread 列表与管理
- 中栏：公开消息流
- 右栏：当前调用、消息统计、Session Chain、审计入口

也就是说，右栏不是附属信息，而是核心运行视图。

---

## 3.6 配置治理差距

FMA 当前配置主要来自环境变量和少量 UI 下拉选择。

cat-cafe 目标中，配置中心至少要承载：

- 每猫模型与预算
- 每猫人格与权限
- 系统 A2A 策略
- session 策略
- 环境与文件视图
- 帮助与命令入口

但这部分不应过早全量实现，应分层推进。

---

## 4. 总体策略

总体策略应为：

- 复用 FMA 的底层可运行资产
- 不复用 FMA 当前过于简化的上层对象模型

### 可直接复用的部分

- CLI runner
- 多模型适配方式
- SSE 流式机制
- 基础结构化日志
- 超时 / 重试 / 子进程治理

### 需要重构或升级的部分

- `Conversation` 升级为 `Thread`
- `TaskContext` 升级为 invocation/session/event 模型
- 线性 orchestrator 升级为多代理 runtime
- 聊天消息流与运行态事件流分离
- 前端从 chat UI 升级为三栏工作台

---

## 5. 项目整体计划

建议将项目分成六个阶段，每个阶段都有明确状态标注。

## Phase 0：架构定义

### 状态

- 当前阶段

### 目标

- 定义 v1 共享底座
- 锁定核心实体、事件、可见性、Thread 边界
- 输出后续实现基线，避免功能各自生长

### 交付物

- v1 数据模型
- v1 事件模型
- v1 可见性模型
- v1 API / 服务边界草图
- v1 session 策略说明
- v1 A2A 最小闭环说明

### 完成标准

- 对 `Thread / Invocation / Session / Visibility` 的含义没有歧义
- 所有后续模块能映射到同一共享底座

---

## Phase 1：运行时底座改造

### 状态

- 未开始

### 目标

- 基于 FMA 现有底座，建立 cat-cafe 所需 runtime 骨架

### 重点任务

- 新建 `Thread` 资源与持久化
- 建立 `AgentInvocation` 模型
- 建立 `AgentSession` 模型
- 建立 `EventLog` 与 `Visibility`
- 将公开消息与运行态事件分流
- 保留现有 CLI runner 和 SSE

### 完成标准

- 一次用户输入可生成 invocation
- invocation 产生可追踪事件
- 公开消息与私有日志能被正确分离

---

## Phase 2：最小垂直切片

### 状态

- 未开始

### 目标

- 做出第一条真正接近 cat-cafe 的端到端链路

### 范围

- 左栏 Thread 列表
- 中栏公开消息流
- 右栏基础状态栏
- 支持 `@猫猫` 召唤
- 支持单跳 A2A
- 支持最小审计摘要

### 不做

- 完整 Hub
- 语音
- 通知
- 长期记忆
- 富文本复杂块

### 完成标准

- 用户可以创建 Thread
- 用户可以 `@` 指定猫猫执行
- 右栏可看到当前调用和基础 session 状态
- A2A 结果能回流到公开消息流

---

## Phase 3：Session Chain 闭环

### 状态

- 未开始

### 目标

- 补齐 cat-cafe 的核心差异能力之一：session handoff

### 重点任务

- 为每只猫维护独立 session
- 定义预算阈值
- 触发 `handoff / sealed / new session`
- 生成 handoff 摘要
- 在右栏展示 Session Chain

### 完成标准

- session 生命周期可追踪
- handoff 对用户可见但不打断主流程
- 旧 session 与新 session 的边界清晰

---

## Phase 4：治理中心最小版

### 状态

- 未开始

### 目标

- 只做最必要的治理能力，不做完整 Hub 复刻

### 范围

- 每猫基础配置
- 系统基础配置
- 只读帮助区

### 暂缓项

- 语音
- 通知
- 长期记忆
- 环境变量写入与复杂系统管理

### 完成标准

- 能修改模型、预算、人格、权限等关键配置
- 能区分即时生效配置和需重建 session 的配置

---

## Phase 5：审计与研发闭环

### 状态

- 未开始

### 目标

- 让系统从“能跑”升级为“能追踪、能排查、能演进”

### 重点任务

- invocation / session / event 聚合视图
- 审计日志入口
- 事件计数与过滤
- 调试模式可见性开关

### 完成标准

- 出问题时能定位到 invocation 和 session
- 不需要把内部日志直接塞进聊天区

---

## Phase 6：完整工作台增强

### 状态

- 远期规划

### 目标

- 在共享底座稳定后，逐步补全增强能力

### 候选内容

- 更完整的 Hub
- Rich blocks
- 导出
- PWA
- GitHub / 自闭环研发
- 语音
- 长期记忆

### 原则

- 所有增强能力都应消费既有底座
- 不允许再反向定义新的核心模型

---

## 6. 近期执行计划

为了让项目从“分析态”进入“实现态”，建议最近三步按下面执行。

## 第一步：输出 v1 架构基线

内容应包括：

- 核心实体定义
- 事件类型定义
- visibility 规则
- Thread / Session / Invocation 关系图
- 最小 API 草图

这是当前最优先事项。

---

## 第二步：用 FMA 底座做 runtime 升级

目标不是重写一套新项目，而是：

- 复用 FMA runner / SSE / logging
- 把上层对象替换为 cat-cafe 需要的运行时模型

这是最快形成真实进展的路径。

---

## 第三步：实现最小垂直切片

建议首个切片只覆盖：

- 新建 Thread
- `@猫猫`
- 单跳 A2A
- 公开消息流
- 右栏当前调用
- 基础 session 状态

这样可以最快验证产品骨架是否正确。

---

## 7. 当前状态与未来计划总表

| 模块 | 当前状态 | 说明 | 计划阶段 |
|------|----------|------|----------|
| 截图逆向分析 | 已完成初版 | 已形成模块级分析与边界判断 | Phase 0 |
| v1 共享数据模型 | 未完成 | 仍需统一定义 | Phase 0 |
| v1 事件与可见性模型 | 未完成 | 是最关键缺口之一 | Phase 0 |
| FMA 底层 runner 复用评估 | 已完成 | 已确认可复用 | Phase 1 |
| Thread 模型 | 未开始 | 需替换 Conversation 中心模型 | Phase 1 |
| Invocation 模型 | 未开始 | A2A 与状态栏前提 | Phase 1 |
| Session 模型 | 未开始 | Session Chain 前提 | Phase 1 |
| 消息与日志分流 | 未开始 | 输出隔离前提 | Phase 1 |
| 三栏工作台最小版 | 未开始 | 先做主骨架 | Phase 2 |
| `@猫猫` 召唤 | 未开始 | 首个关键交互 | Phase 2 |
| 单跳 A2A | 未开始 | 首个协作能力闭环 | Phase 2 |
| 当前调用面板 | 未开始 | 右栏关键能力 | Phase 2 |
| Session Chain | 未开始 | 第二阶段核心增强 | Phase 3 |
| 最小配置中心 | 未开始 | 治理能力最小闭环 | Phase 4 |
| 审计日志入口 | 未开始 | 调试与追踪能力 | Phase 5 |
| 完整 Hub / 语音 / 通知 / 长期记忆 | 远期 | 不进入首轮实现 | Phase 6 |

---

## 8. 最终判断

当前项目最需要的不是继续加分析碎片，也不是立刻开始堆页面，而是：

- 把 `cat-cafe v1` 的共享底座定义清楚
- 明确哪些 FMA 能复用，哪些必须升级
- 以“最小垂直切片”验证架构，而不是以“页面数量”衡量进度

下一份最应该产出的文档，不是 UI 草图，而是：

- `cat-cafe v1 架构基线`

它将作为后续实现、排期、状态标注和风险控制的统一依据。
