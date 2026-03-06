// ============================================================
// planner.ts — Planner Agent（规划师）
// Planner Agent — breaks task into implementation steps
// ============================================================
//
// 职责：接收原始任务，输出结构化执行计划
// Role: receive raw task, output a structured implementation plan
//
// [p006 借鉴] 类似 cat-café 里的「架构猫」角色
// [p006 lesson] Similar to the "architect cat" role in cat-café
//
// ============================================================

import { runAgent } from '../core/agent.js';
import type { AgentResult, AgentRunOptions } from '../core/types.js';

// ── 模型配置 / Model configuration ──────────────────────────
// Planner 需要深度推理能力 → 使用 opus（最强推理模型）
// Planner needs deep reasoning → use opus (strongest reasoning model)
// 可通过环境变量 PLANNER_PROVIDER / PLANNER_MODEL 覆盖
// Override via env vars PLANNER_PROVIDER / PLANNER_MODEL
const PLANNER_OPTIONS: AgentRunOptions = {
  provider: (process.env.PLANNER_PROVIDER as AgentRunOptions['provider']) ?? 'claude',
  model: process.env.PLANNER_MODEL ?? 'opus',
};

// Agent 的人格与边界 — system prompt 是 Agent 最重要的参数
// Agent personality & boundaries — system prompt is the most critical parameter
const SYSTEM_PROMPT = `\
You are a senior software architect on a 3-person coding team.

Your ONLY job is to analyze a coding task and produce a clear implementation plan.
Do NOT write any actual code. Plans only.

Output format (strictly follow this):
## Goal
One sentence describing what we're building.

## Implementation Steps
1. [Step] — [why this step]
2. ...

## Key Decisions
- [Any important technical choices or trade-offs]

Keep the plan concise (under 200 words). Be specific about file names, function names, and data shapes.`;

/**
 * Planner Agent 入口
 * Planner Agent entry point
 *
 * @param task 用户的原始任务描述 / raw task from user
 */
export async function runPlanner(task: string): Promise<AgentResult> {
  console.log('\n🧠  [Planner] Analyzing task...');

  const result = await runAgent(
    'Planner',
    SYSTEM_PROMPT,
    `Please create an implementation plan for the following task:\n\n${task}`,
    PLANNER_OPTIONS,
  );

  console.log(`✅  [Planner] Done in ${result.durationMs}ms`);
  return result;
}
