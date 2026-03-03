# Meiyong Plan — 两份文档的关系与使用指南

> **命名来由**：「没用」——不是真的没用，而是提醒自己：计划本身没有价值，执行才有。这个文件存在的意义，是让两份计划文档都能被真正「用上」，而不是写完就放进抽屉。

---

## 一句话总结两份文档的关系

```
future-structure.md  =  施工图（What to build next, step by step）
xiaoming-experience.md  =  导师手册（How to think when you build it）
```

它们是**互补关系，不是替代关系**。单独看任何一份，都只有一半的价值。

---

## 详细关系说明

### future-structure.md — 施工图

**性质**：近期可执行的演进计划，有明确的 Phase 编号、预估工作量、具体改动文件。

**使用时机**：
- 开始一个新 Phase 时，先看这里确认目标
- 评估 PR 时，对照这里检查「这个改动是否在计划内」
- 项目回顾时，更新各 Phase 的完成状态

**局限性**：
- **有时效性**——6 个月后可能部分内容已经过时
- **不解释 Why**——只说「Phase 4 加入图编排」，不解释为什么图编排比线性好
- **不覆盖意外情况**——当遇到文档没想到的问题，它帮不了你

---

### xiaoming-experience.md — 导师手册

**性质**：从业界最佳实践和一手踩坑经验提炼的判断框架，适用于任何 Phase。

**使用时机**：
- 遇到两个方案都说得通，不知道选哪个
- system prompt 写完感觉不对，但不知道哪里有问题
- 新 Agent 加进来，不确定职责边界在哪里
- 感觉系统「脆」，但说不清楚脆在哪里

**局限性**：
- **不给具体代码**——是框架，不是实现
- **有一定门槛**——需要对照实际问题才能发挥价值，不适合「随机翻阅」
- **会随经验积累而更新**——它不是圣经，欢迎质疑和补充

---

## 使用流程 / Usage Flow

```
开始一个新 Phase 时：
  1. 读 future-structure.md → 明确目标和改动范围
  2. 读 xiaoming-experience.md 相关章节 → 预判风险点
  3. 动手实现
  4. 遇到问题 → 回 xiaoming-experience.md 找判断框架
  5. Phase 完成 → 更新 future-structure.md 的完成状态
  6. 有新踩坑 → 补充到 xiaoming-experience.md

发现两份文档矛盾时：
  → 具体问题看 future-structure.md（更具体、更新）
  → 设计原则看 xiaoming-experience.md（更基础、更稳定）
  → 如果原则本身有问题，说明 xiaoming-experience.md 需要更新
```

---

## 优先级矩阵 / Priority Matrix

| 场景 | 主要参考 | 辅助参考 |
|------|----------|----------|
| 决定下一步做什么 | future-structure.md | — |
| 技术方案选型 | xiaoming-experience.md | future-structure.md（看该 Phase 约束） |
| System prompt 设计 | xiaoming-experience.md Ch.1 | — |
| 数据安全方案 | xiaoming-experience.md Ch.3 | future-structure.md（Phase 5 三层防御） |
| 成本超预期 | xiaoming-experience.md Ch.5 | — |
| Agent 行为异常 | xiaoming-experience.md Ch.2 | — |
| 估算工作量 | future-structure.md | — |
| 新成员 onboarding | xiaoming-experience.md（先读） | future-structure.md（后读） |
| AI Agent onboarding | AGENTS.md（先读） | core/types.ts + CHANGELOG.md |
| 回滚某次变更 | CHANGELOG.md | — |
| 遇到已知报错 | TROUBLESHOOTING.md | — |

---

## 文档更新策略 / Update Strategy

**future-structure.md 的更新节奏：**
- 每个 Phase 完成时，把状态从「目标」改为「✅ 完成」，记录实际用时
- 当计划与现实出现重大偏差时，在对应 Phase 下加「⚠️ 实际」说明
- 重大架构调整时，在顶部「本次设计亮点」增加条目

**xiaoming-experience.md 的更新节奏：**
- 踩了文档没有预警的坑 → 立即补充
- 发现某条原则在实际中不适用 → 增加「⚠️ 边界条件」说明
- 不轻易删除内容（历史教训有历史价值）

**meiyong-plan.md（本文档）的更新节奏：**
- 两份文档的关系发生实质变化时才更新
- 否则保持稳定，作为「元文档」

---

## 文档全景图 / Document Map

```
README.md              ← 对外：项目介绍、快速开始、当前版本
AGENTS.md              ← 对内：AI Agent 快速上下文文件（2 分钟了解项目全貌）
future-structure.md    ← 对内：演进计划、Phase 目标（施工图）
xiaoming-experience.md ← 对内：判断框架、设计原则（导师手册）
meiyong-plan.md        ← 对内：以上文档的索引和使用说明（元文档）
CHANGELOG.md           ← 对内：每次变更的详细记录，含回滚方式（变更日志）
TROUBLESHOOTING.md     ← 对内：开发踩坑记录和解决方案（排障手册）
```

新人读文档顺序建议：
```
README.md → meiyong-plan.md（本文）→ future-structure.md → xiaoming-experience.md
（CHANGELOG.md 和 TROUBLESHOOTING.md 按需查阅）
```

AI Agent 读文档顺序建议：
```
AGENTS.md（快速上下文）→ core/types.ts → chat/types.ts → CHANGELOG.md → 动手
（详细设计参考 future-structure.md 和 xiaoming-experience.md）
```

---

## 这份计划最终会「没用」的风险

诚实地说，计划文档最常见的失败模式：

1. **写完不看**：文档存在，但没有人在做决策时想到要查它
2. **更新不及时**：现实已经 Phase 4，文档还停在 Phase 2
3. **太精细太死板**：过度详细的计划让人不敢偏离，失去灵活性
4. **太模糊太空泛**：没有可执行的 action，变成愿景文档

**对抗措施**：
- 每次开始新 Phase 时，强制先打开 future-structure.md
- 完成 Phase 后，强制更新状态（5 分钟的事）
- 把两份文档都保持在「够用就好」的详细程度，不追求完美
- 定期（每季度）回顾，删除过时内容，比增加新内容更重要

---

> 最后一句话：计划是为了服务行动，不是为了本身的完整性。如果计划妨碍了行动，舍弃计划。

*版本：v1.2 | 日期：2026-03-03*
*v1.2 更新：补充 AGENTS.md 到文档索引，新增 AI Agent 阅读顺序建议*
*v1.1 更新：补充 CHANGELOG.md 和 TROUBLESHOOTING.md 到文档索引*
