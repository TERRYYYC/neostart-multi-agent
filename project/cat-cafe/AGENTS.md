# AGENTS
> Purpose: Give any AI agent a clear, execution-oriented brief for rebuilding a closed-source product by learning from screenshots and observed behavior, without jumping into UI coding too early.
> 目的：给任何 AI agent 一份可执行的项目说明，用于基于截图和使用观察来复刻闭源产品能力，但在方向未明确前不直接进入 UI 编码。

---

## Core Principle / 核心原则

Do **not** start by writing interface code.
Start by clarifying **what is being replicated**, **why**, and **which parts matter**.

**Never treat screenshots as a signal to immediately code pages.**
Screenshots are inputs for reverse-engineering product structure, interaction logic, and capability boundaries.
(Exception: Throwaway exploratory code or "Spikes" are allowed solely to validate API boundaries, test complex interactions, or verify data models. This code must not be used as the foundation for the final UI.)

不要一开始就写界面代码。
先明确：**要复刻什么、为什么复刻、哪些部分最重要**。

**不要把截图当作“立刻开写页面”的信号。**
截图首先用于逆向产品结构、交互逻辑和能力边界。
（例外：允许编写用完即弃的探索性代码即“探针/Spike”，目的仅限于验证 API 边界、测试复杂交互或验证数据模型。此类代码绝不能作为最终 UI 的基础。）

---

## Project Goal / 项目目标

The near-term goal is to build a **clear architectural direction** for a project inspired by a non-open-source product.

The first phase is **analysis and definition**, not implementation.

Current priority order:
1. Reverse-engineer the product
2. Define scope and boundaries
3. Design architecture and data model
4. Plan phased implementation
5. Only then start coding

当前近期目标是：为一个参考闭源产品的项目建立**清晰的架构方向**。

第一阶段是**分析和定义**，不是实现。

当前优先级顺序：
1. 逆向理解产品
2. 定义范围与边界
3. 设计架构与数据模型
4. 规划分阶段实现
5. 最后才进入编码

---

## What To Reverse-Engineer / 要逆向的内容

Separate the target product into three layers:

### 1. Presentation Layer / 表现层
What the product looks like:
- Layout
- Visual hierarchy
- Typography
- Spacing
- Color system
- Components
- Motion style

### 2. Interaction Layer / 交互层
How the product behaves:
- Navigation flow
- User actions
- State transitions
- Loading behavior
- Error handling
- Empty states
- Progressive disclosure

### 3. Capability Layer / 能力层
What the product actually does:
- Core user jobs
- Data flow
- Backend responsibilities
- AI/system responsibilities
- Inputs and outputs
- Persistence model
- Constraints and assumptions

Agent should **analyze these three layers separately first**, then explicitly map relationships across layers in the architecture stage.
Do not confuse direct observations with cross-layer inferences.
Any recommendation should explicitly state which layer it belongs to, and cross-layer conclusions must be labeled as inference.

Agent 在分析时应**先将这三层分开陈述**，再在架构阶段明确建立跨层映射关系。
不要把直接观察事实与跨层推断混为一谈。
任何建议都应明确说明属于哪一层；凡是跨层结论，必须标注为推断。

---

## Required Inputs / 所需输入

The user may provide any of the following:
- 1 to 5 key screenshots
- A sequence of screenshots showing step-by-step transitions in one flow
- A written walkthrough of the product flow
- Notes describing user actions, system feedback, and completion states
- Screenshots of loading, empty, and error states when available
- A description of the core capability
- A target outcome: demo, MVP, or long-term product

If screenshots are provided, the agent should extract from them:
- Page structure
- Component inventory
- Visible states
- Likely interaction flows
- Possible data entities
- Areas of uncertainty

如果用户提供截图，agent 需要从截图中提取：
- 页面结构
- 组件清单
- 可见状态
- 可能的交互流
- 可能的数据实体
- 不确定区域

---

## Deliverables Before Any Coding / 编码前必须产出的内容

Before implementation begins, produce these four artifacts:

### 1. Scope Definition / 范围定义
Must answer:
- What exactly is being replicated?
- What is in scope for v1?
- What is explicitly out of scope?
- Is the goal visual similarity, workflow similarity, or capability similarity?

### 2. Information Architecture / 信息架构
Must include:
- Page map
- Major views
- Dialogs / side panels / settings areas
- Navigation relationships

### 3. Core Data Model / 核心数据模型
Must define likely entities such as:
- User
- Session / conversation
- Task
- Message
- File
- Result
- Tool/action record

These are example entities only.
Prefer domain-native entities that match the target product.
Do not force chat/task/tool abstractions onto products that do not naturally use them.

以上仅为候选示例实体。
应优先使用符合目标产品领域的原生实体。
如果目标产品并不天然采用 chat/task/tool 这类抽象，不得强行套用。

For each entity, describe:
- Purpose
- Key fields
- Relationships
- Lifecycle

### 4. Technical Architecture Draft / 技术架构草图
Must clarify:
- Frontend boundaries
- Backend boundaries
- Storage strategy
- Sync vs streaming behavior
- API/service boundaries
- Future extensibility

在进入实现前，必须先产出以上四份内容。
如果这四项不完整，不要开始界面开发。

---

## Recommended Working Sequence / 推荐工作顺序

### Phase 0: Product Framing / 产品定位
Define:
- Who the user is
- What job the product solves
- Why this product is worth replicating
- Whether the goal is learning, internal tooling, MVP, or production

### Phase 1: Screenshot-Based Reverse Engineering / 基于截图的逆向分析
For each screenshot:
- Identify page purpose
- List visible modules
- Infer layout structure
- Infer state and transitions
- Mark unknown behavior

### Phase 2: User Flow Reconstruction / 用户路径重建
Describe:
- Entry point
- Main task flow
- Alternate paths
- Failure paths
- Completion states

### Phase 3: Domain Modeling / 领域建模
Infer:
- Core entities
- Ownership of state
- Transient vs persistent data
- Which actions mutate which entities

### Phase 4: Architecture Decision / 架构决策
Decide:
- SPA vs multi-page
- Frontend-only vs frontend/backend split
- Local mock vs real backend
- Static responses vs streaming responses
- Single-user vs multi-user assumptions

### Phase 5: Implementation Planning / 实施规划
Break work into:
- Foundation
- Static interface
- Interaction states
- Data integration
- Capability integration

Only after Phase 5 may production UI coding begin. (Exploratory throwaway spikes are permitted earlier to answer specific Phase 3/4 questions).
只有在 Phase 5 完成后才允许进入正式的产品 UI 编码。（为了回答 Phase 3/4 中的特定问题，允许提前编写用完即弃的探索性代码）。

---

## Architectural Questions The Agent Must Answer / Agent 必须回答的架构问题

Before recommending implementation, answer these questions explicitly:

1. Is the target primarily a UI clone, an interaction clone, or a capability clone?
2. Which features are essential for v1?
3. Which features are expensive but non-essential?
4. What entities exist in the system?
5. Which state belongs on the client, and which belongs on the server?
6. Does the product need persistence? If yes, what kind?
7. Is streaming or real-time behavior part of the core experience?
8. Does the system need a task queue, background jobs, or file processing?
9. Is this project a throwaway prototype or a long-lived product?
10. Which decisions must stay flexible because the target is still partially unknown?

如果以上问题没有被明确回答，说明架构方向仍然不清晰。

---

## Rules For Agents / Agent 行为规则

### Do / 应该做
- Ask what the user wants to replicate: appearance, workflow, or capability
- Be critical of the target product's design. Spot anti-patterns, poor UX, or legacy constraints, point them out and propose better alternatives rather than blindly copying them. (批判性地审视目标产品的设计。如果观察到明显的反模式、糟糕的用户体验或历史遗留限制，请指出来并提供更优的替代方案，而不是盲目照搬。)
- Use screenshots as evidence, not as complete truth
- Mark uncertainty clearly
- Separate observation from inference
- Prefer architecture clarity over speed
- Propose phased scope reduction when ambiguity is high
- Keep implementation options open until constraints are clear

### Do Not / 不应该做
- Do not jump directly into React/Vue/component code
- Do not assume backend behavior from UI alone without labeling it as inference
- Do not over-design early infrastructure before core flows are understood
- Do not promise pixel-perfect cloning from a small number of screenshots
- Do not copy protected branding, logos, proprietary text, or copyrighted assets

---

## Language Policy / 语言策略

- The English sections exist primarily to help the agent interpret instructions accurately.
- The Chinese sections define how final user-facing deliverables should be written.
- All final deliverables, architectural proposals, and analysis outputs must be written in Chinese.
- If the English and Chinese versions conflict, the Chinese version takes precedence.

## 语言策略

- 英文部分主要用于帮助 agent 准确理解指令。
- 中文部分用于规定面向用户的最终交付内容如何输出。
- 所有最终交付物、架构建议和分析输出必须使用中文编写。
- 如果英文与中文表述冲突，以中文版本为准。

---

## Output Format For Analysis / 分析输出格式

When the user provides screenshots or product notes, the agent should respond using this structure:

### A. Observations / 观察事实
Only state what is directly visible or explicitly provided.

### B. Inferences / 推断
State likely behavior, architecture, or data assumptions.
Each inference should include:
- Inference
- Evidence
- Confidence: high / medium / low
- Validation needed

### C. Open Questions / 待确认问题
List what remains unclear.

### D. v1 Scope Proposal / v1 范围建议
Define what to build first.

### E. Architecture Proposal / 架构建议
Describe modules, boundaries, and likely tech direction.

### F. Next Decision / 下一步决策
State the single most valuable next input from the user.

---

## Initial Deliverable Template / 初始交付模板

Use this template when starting the project:

```md
# Reverse Engineering Brief

## 1. Product Goal
- Target product:
- Why replicate it:
- Intended outcome: demo / MVP / product

## 2. Replication Target
- Presentation layer:
- Interaction layer:
- Capability layer:

## 3. Known Screens / Known Flows
- Screen A:
- Screen B:
- Flow A:

## 4. Core User Journey
- Entry:
- Main action:
- Feedback:
- Completion:

## 5. Candidate Data Entities
- Entity:
- Purpose:
- Key fields:

## 6. Architecture Draft
- Frontend:
- Backend:
- Storage:
- External services:

## 7. v1 Scope
- In scope:
- Out of scope:

## 8. Risks / Unknowns
- Risk 1:
- Risk 2:

## 9. Next Input Needed
- Need from user:
```

---

## Success Criteria / 成功标准

This phase is successful if:
- The project direction is clear
- The replication boundary is explicit
- The core entities and flows are identified
- The technical architecture is understandable
- The first implementation phase is small and controlled
- The main user flow has been identified
- v1 in-scope and out-of-scope boundaries are explicit
- The key entities and state ownership are described
- The top 3 to 5 critical unknowns are listed
- At least one recommended approach and one fallback approach are provided

If the output is only “looks like X page, use React to build it”, the analysis is insufficient.

如果产出只是“像某个页面，用 React 做出来”，说明分析不合格。

---

## Final Instruction / 最终指令

When in doubt, slow down and clarify the structure of the product.
The objective is not fast imitation.
The objective is to build a project with a clear architecture and a defensible direction.

如果存在不确定性，优先放慢速度、澄清产品结构。
目标不是快速模仿。
目标是建立一个方向清晰、架构站得住的项目。
