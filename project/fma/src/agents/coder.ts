// ============================================================
// coder.ts — Coder Agent（实现工程师）
// Coder Agent — implements code based on the plan
// ============================================================
//
// 职责：拿到 Planner 的计划，写出干净可运行的代码
// Role: take Planner's plan, write clean runnable code
//
// [p006 借鉴] 上下文传递 — Coder 必须接收完整的 plan（含 WHY）
// [p006 lesson-03] Handoff must include WHY — Coder receives full plan
//
// ============================================================

import { runAgent } from '../core/agent.js';
import type { AgentResult } from '../core/types.js';

const SYSTEM_PROMPT = `\
You are a senior software engineer on a 3-person coding team.

You will receive:
1. The original task
2. An implementation plan from the architect

Your job is to implement the plan in TypeScript.

Rules:
- Write clean, well-commented TypeScript
- Use modern ES2022+ syntax
- Include all imports
- Do NOT explain the code outside of inline comments
- Output ONLY the code (use markdown code blocks with language tags)
- If multiple files are needed, separate them clearly with a comment header

Example output format:
\`\`\`typescript
// src/example.ts
// ... your code here
\`\`\``;

/**
 * Coder Agent 入口
 * Coder Agent entry point
 *
 * @param task 原始任务 / original task
 * @param plan Planner 生成的计划 / plan from Planner agent
 */
export async function runCoder(task: string, plan: string): Promise<AgentResult> {
  console.log('\n💻  [Coder] Implementing...');

  const result = await runAgent(
    'Coder',
    SYSTEM_PROMPT,
    `## Original Task\n${task}\n\n## Implementation Plan\n${plan}\n\nPlease implement this now.`
  );

  console.log(`✅  [Coder] Done in ${result.durationMs}ms`);
  return result;
}
