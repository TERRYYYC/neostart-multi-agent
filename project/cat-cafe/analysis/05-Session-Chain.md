# 05 Session Chain

## A. 观察事实
- 右侧 `Session Chain` 模块显示多个 session 卡片，含 `ACTIVE` 和 `SEALED` 两类状态。
- 每张卡片带有 session 编号、短 ID、猫猫标签、启动时间、token / cache 数值、百分比进度条。
- 已封存的 session 卡片文案中出现 `threshold`，说明封存与阈值触发有关。
- `DEMO.md` 说明当 context 接近上限时系统自动 handoff 到新 session，并向新 session 注入前一个 session 的摘要。
- 文档还说明 handoff / compress / hybrid 策略可配置。

## B. 推断
1. 推断: `Session Chain` 不是历史列表，而是同一 agent 在同一 Thread 内的上下文接力链。
   - 证据: 文档明确使用 `Session 1 -> Session 2 -> Session 3` 的交接描述。
   - Confidence: high
   - Validation needed: 确认不同猫的 session 是否彼此独立成链。
2. 推断: `SEALED` 表示旧 session 不再接收新消息，但仍保留供追溯。
   - 证据: 命名为 sealed 而非 archived/deleted。
   - Confidence: high
   - Validation needed: 确认 sealed session 是否还能被引用或查看详情。
3. 推断: handoff 触发器至少考虑 token 阈值，可能还考虑缓存比例和压缩次数。
   - 证据: 卡片展示 token/cache；文档提到阈值和压缩次数配置。
   - Confidence: medium
   - Validation needed: 需要查看具体策略配置页或日志。

## C. 待确认问题
- Session Chain 是按猫独立维护，还是一个 Thread 内共用一条链？
- handoff 后旧 session 的哪些内容会被摘要，哪些会被丢弃？
- 用户是否能手动触发 handoff 或压缩？
- 新 session 的可见性对用户是否完全无感，还是会有系统提示？

## D. v1 范围建议
- v1 优先做“自动 handoff + 摘要注入 + 右栏链式展示”。
- 若成本太高，降级为“阈值预警 + 手动压缩”也可接受，但要提前声明这不是最终能力。
- 不建议把策略配置全做出来；先固定一套默认阈值与 handoff 策略即可。

## E. 架构建议
- Presentation layer: `Session Chain` 保持右栏卡片式展示，提供最小必要信息，不要把完整 session 细节塞进主聊天流。
- Interaction layer: 当 session 接近阈值时，系统创建 `SessionHandoff`，生成摘要并切换后续 invocation 的目标 session。
- Capability layer: 需要独立的摘要生成与交接策略模块，不能散落在每个 provider 适配器里。
- 跨层推断: 既然每只猫可能独立 handoff，那么 `Thread -> AgentSession` 是一对多关系，且 session 选择逻辑必须由编排器统一决定。

## F. 下一步决策
- 最有价值的下一步输入是：补充 `F33` 策略配置截图，或说明你希望首版采用 `handoff / compress / hybrid` 中哪一种作为默认策略。
