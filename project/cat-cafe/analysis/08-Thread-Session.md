# 08 Thread & Session

## A. 观察事实
- 左侧栏是对话列表，含搜索框、`+新对话` 按钮、分组、置顶标记、最近活跃时间。
- 当前页面 URL 形如 `/thread/thread_...`，说明 Thread 有独立路由。
- 中间仍是主消息流，说明 Thread 是整个工作台的主容器，而不是一个轻量标签。
- 右侧状态栏在本组截图里新增或更明确展示了四类信息：`当前调用`、`消息统计`、`Session Chain`、`对话信息/审计日志`。
- `当前调用` 卡片显示正在执行的猫、阶段、耗时，以及 session / invocation 的短 ID。
- `Session Chain` 继续显示多 session，包含 ACTIVE / SEALED 状态与预算占比。
- `对话信息` 模块显示当前 Thread 标识、模式信息、切换游戏/其他动作按钮。
- `审计日志` 模块显示“在 VSCode 中打开”入口，以及“773 条事件 + 13 个日志文件”。
- `DEMO.md` 文字说明补充了 Thread 支持重命名、归档、删除、Markdown 导出，并按最近活跃排序。

## B. 推断
1. 推断: Thread 是产品的一等资源，承载消息、代理状态、模式、审计记录和导出边界。
   - 证据: 独立路由、左侧列表、右侧“对话信息”、文档中的重命名/归档/导出。
   - Confidence: high
   - Validation needed: 确认导出是否以 Thread 为唯一单位，还是可按 session / 时间范围切片。
2. 推断: Session 不是 Thread 的替代，而是 Thread 内按代理维度维护的执行上下文分片。
   - 证据: 文档明确写“每个 Thread 里每只猫有独立的 session 状态”；右侧同一 Thread 下同时显示多猫 session。
   - Confidence: high
   - Validation needed: 确认一个猫在同一 Thread 中是否始终只有一条活跃 session 链。
3. 推断: 系统内部已经存在 invocation 级追踪链路。
   - 证据: `当前调用` 卡片直接显示 `invocation:` 和 `session:` 短 ID。
   - Confidence: high
   - Validation needed: 确认 invocation 是否与单条公开消息一一对应。
4. 推断: `审计日志` 与 `04 A2A 输出隔离` 是互补关系。
   - 证据: 聊天主区未展示全部内部日志，但右栏提供事件数与日志文件入口。
   - Confidence: high
   - Validation needed: 确认审计日志默认用户可见，还是开发模式专属。
5. 推断: Thread 管理不是纯前端列表功能，而是会影响存储、索引、导出和状态恢复。
   - 证据: 具备归档、删除、导出、排序这些生命周期操作。
   - Confidence: high
   - Validation needed: 确认删除是软删除还是硬删除。

## C. 待确认问题
- Thread 重命名、归档、删除的入口在当前 UI 哪一层出现？左侧 hover、右键菜单，还是详情面板？
- 审计日志是否按 Thread 存储，还是按 session / invocation 分文件再聚合？
- `在 VSCode 中打开` 打开的是 Thread 导出文件、审计目录，还是项目工作区中的关联文件？
- `模式` 与 Thread 的关系是什么：Thread 级状态、一次性执行模式，还是全局模式？
- 导出 Markdown 是否只导出公开消息，还是包含系统摘要与 session 链信息？

## D. v1 范围建议
- v1 应把 `Thread` 定义成一级对象，并明确生命周期：创建、列表、切换、重命名、归档。
- `删除` 可以延后，优先做归档，降低数据不可恢复风险。
- `审计日志` v1 可先做只读入口和事件计数，不必一开始就支持“在 VSCode 中打开”。
- `当前调用` 是值得提前纳入的，因为它把 `状态栏` 从“统计面板”升级为“可调试工作台”。

## E. 架构建议
- Presentation layer: 左侧 Thread 列表、中部消息流、右侧运行态/审计栏是稳定骨架，Thread 应作为页面级路由资源。
- Interaction layer: 切换 Thread 时，需要同时切换消息流、当前调用、session chain、审计摘要，而不是只切中间内容。
- Capability layer: 建议显式建模 `Thread`、`AgentSession`、`AgentInvocation`、`AuditLogIndex` 四类资源。
- 存储建议:
  - `Thread` 元数据入主库。
  - 公开消息入消息表。
  - `AgentInvocation` / `AgentSession` 入运行态表。
  - 审计日志正文可落文件或对象存储，库里只存索引。
- 跨层推断: `08` 说明这个产品本质上更像“可追踪的代理协作 IDE”，而不是普通聊天应用，因此 Thread 不能仅按 chat conversation 去建模。

## F. 下一步决策
- 最有价值的下一步输入是：补一张 Thread 重命名/归档/导出入口的截图，或者说明你希望首版把 Thread 管理做到什么深度。
