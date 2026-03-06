// ============================================================
// index.ts — Orchestrator（总指挥）
// Orchestrator — coordinates all agents in sequence
// ============================================================
//
// MVP 架构：顺序流水线（Sequential Pipeline）
//
//   用户输入 → [Planner] → [Coder] → [Reviewer] → 输出
//
// 每个 Agent 的输出作为下一个 Agent 的输入上下文
// Each agent's output becomes input context for the next agent
//
// [可扩展点] Phase 2 升级方向：
// [Extensibility] Phase 2 upgrade paths:
//   - 换成 Filesystem Queue（参考 p003 filesystem queue primitive）
//   - 加入并行 Agent（Coder + Tester 同时跑）
//   - 换 CLI runner 支持多模型（参考 p006 ADR-001）
//   - 加 Redis 持久化（参考 p006 three-layer data safety）
//
// ============================================================

import { runPlanner } from './agents/planner.js';
import { runCoder } from './agents/coder.js';
import { runReviewer } from './agents/reviewer.js';
import type { TaskContext, AgentResult } from './core/types.js';

// ── 工具函数 / Utility functions ──────────────────────────────

function printSeparator(label: string): void {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(line);
}

function printResult(result: AgentResult): void {
  printSeparator(`${result.agentName} Output (${result.durationMs}ms)`);
  console.log(result.output);
}

function printSummary(ctx: TaskContext, totalMs: number): void {
  printSeparator('✨  Task Complete');
  console.log(`Task     : ${ctx.task}`);
  console.log(`Total    : ${(totalMs / 1000).toFixed(1)}s`);
  console.log('\nAll agent outputs are printed above.');
  console.log('The final reviewed code is in the [Reviewer Output] section.');
}

// ── 主流程 / Main orchestration flow ─────────────────────────

async function main(): Promise<void> {
  // 从命令行参数读取任务 / Read task from CLI argument
  const task = process.argv.slice(2).join(' ').trim();

  if (!task) {
    console.error('\n❌  Usage: npm start "<your coding task>"\n');
    console.error('   Example: npm start "write a function that validates email addresses"');
    process.exit(1);
  }

  // [Phase 2] API key 不再硬检查 — CLI subprocess 自行处理认证
  // [Phase 2] No more hard API key check — CLI subprocess handles auth
  // Claude CLI 使用 OAuth 或 ANTHROPIC_API_KEY
  // Codex CLI 使用 OPENAI_API_KEY
  // Gemini CLI 使用 Google OAuth

  printSeparator(`🚀  Code Team — Task Received`);
  console.log(`\n  "${task}"\n`);
  console.log('  Agents: Planner → Coder → Reviewer');
  console.log('  Mode: CLI subprocess (multi-model) / CLI 子进程（多模型）');

  const startMs = Date.now();

  // 任务上下文（跟随流水线逐步填充）
  // Task context (filled progressively as it flows through the pipeline)
  const ctx: TaskContext = { task };

  // ── Step 1: Planner ────────────────────────────────────────
  const planResult = await runPlanner(task);
  ctx.plan = planResult.output;
  printResult(planResult);

  // ── Step 2: Coder ──────────────────────────────────────────
  const codeResult = await runCoder(task, ctx.plan);
  ctx.code = codeResult.output;
  printResult(codeResult);

  // ── Step 3: Reviewer ───────────────────────────────────────
  const reviewResult = await runReviewer(task, ctx.plan, ctx.code);
  ctx.review = reviewResult.output;
  printResult(reviewResult);

  // ── Done ───────────────────────────────────────────────────
  printSummary(ctx, Date.now() - startMs);
}

main().catch((err) => {
  console.error('\n❌  Fatal error:', err);
  process.exit(1);
});
