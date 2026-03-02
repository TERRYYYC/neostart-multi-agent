// ============================================================
// types.ts — 所有 Agent 共享的数据结构
// Shared data structures for all agents
// ============================================================

/**
 * 每个 Agent 执行后的标准输出格式
 * Standard output format after each agent executes
 */
export interface AgentResult {
  agentName: string;   // Agent 名称
  output: string;      // Agent 的输出内容
  durationMs: number;  // 执行耗时（毫秒）
}

/**
 * 在 Agent 之间流转的任务上下文（核心数据载体）
 * Task context flowing between agents (core data carrier)
 *
 * 设计原则：不可变追加（每个 Agent 只能添加，不能修改之前的字段）
 * Design principle: immutable append (each agent can only add, never modify previous fields)
 */
export interface TaskContext {
  task: string;         // 原始任务描述（来自用户）
  plan?: string;        // Planner 生成的执行计划
  code?: string;        // Coder 生成的代码
  review?: string;      // Reviewer 的审查结论与最终代码
}
