// ============================================================
// reviewer.ts — Reviewer Agent（代码审查员）
// Reviewer Agent — reviews code and outputs the final version
// ============================================================
//
// 职责：客观审查代码质量，输出 P1/P2/P3 分级问题 + 最终代码
// Role: objectively review code quality, output tiered issues + final code
//
// [p006 借鉴] 审查必须客观 (p006 lesson-03 meta-rules):
//   - P1 阻断性问题（必须修复）
//   - P2 重要建议（强烈推荐）
//   - P3 小优化（可选）
//   禁止表演性赞同 ("Great code!")
// [p006 lesson-03] Review must be objective with P1/P2/P3 triage
//
// ============================================================

import { runAgent } from '../core/agent.js';
import type { AgentResult, AgentRunOptions } from '../core/types.js';

// ── 模型配置 / Model configuration ──────────────────────────
// Reviewer 做结构化审查 → 使用 haiku（结构化任务，省成本）
// Reviewer does structured review → use haiku (structured task, saves cost)
// 可通过环境变量 REVIEWER_PROVIDER / REVIEWER_MODEL 覆盖
// Override via env vars REVIEWER_PROVIDER / REVIEWER_MODEL
const REVIEWER_OPTIONS: AgentRunOptions = {
  provider: (process.env.REVIEWER_PROVIDER as AgentRunOptions['provider']) ?? 'claude',
  model: process.env.REVIEWER_MODEL ?? 'haiku',
};

const SYSTEM_PROMPT = `\
You are a senior code reviewer on a 3-person coding team.

You will receive: the original task, the implementation plan, and the code to review.

Review the code on these dimensions:
1. Correctness — does it implement the plan correctly?
2. Type safety — proper TypeScript types, no implicit \`any\`?
3. Error handling — are edge cases handled?
4. Security — any obvious vulnerabilities?
5. Clarity — is it readable and well-commented?

Output format (strictly follow this):
## Review

### P1 — Blocking Issues (must fix)
- [issue] → [fix]

### P2 — Important Suggestions (strongly recommended)
- [issue] → [fix]

### P3 — Minor Improvements (optional)
- [issue] → [fix]

## Final Code
(Provide the corrected, final version of the code here. If no changes needed, repeat the original.)

Rules:
- Be objective, not performative. No "Great code!" comments.
- If there are no issues in a category, write "None."
- Always output the Final Code section, even if unchanged.`;

/**
 * Reviewer Agent 入口
 * Reviewer Agent entry point
 *
 * @param task  原始任务 / original task
 * @param plan  Planner 计划 / Planner's plan
 * @param code  Coder 产出 / Coder's output
 */
export async function runReviewer(
  task: string,
  plan: string,
  code: string
): Promise<AgentResult> {
  console.log('\n🔍  [Reviewer] Reviewing code...');

  const result = await runAgent(
    'Reviewer',
    SYSTEM_PROMPT,
    `## Original Task\n${task}\n\n## Implementation Plan\n${plan}\n\n## Code to Review\n${code}`,
    REVIEWER_OPTIONS,
  );

  console.log(`✅  [Reviewer] Done in ${result.durationMs}ms`);
  return result;
}
