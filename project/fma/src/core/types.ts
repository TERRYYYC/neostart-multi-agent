// ============================================================
// types.ts — 所有 Agent 共享的数据结构
// Shared data structures for all agents
// ============================================================

// 从 chat/types.ts 统一导入模型提供商类型
// Reexport ModelProvider from chat/types for unified access
export type { ModelProvider } from '../chat/types.js';

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
 * Agent 运行配置（Phase 2 新增）
 * Agent run options (added in Phase 2)
 *
 * 支持多模型成本分层：Planner=opus, Coder=sonnet, Reviewer=haiku
 * Supports multi-model cost tiers: Planner=opus, Coder=sonnet, Reviewer=haiku
 *
 * 向后兼容：所有字段可选，默认 provider='claude'
 * Backward compatible: all fields optional, default provider='claude'
 */
export interface AgentRunOptions {
  /** 模型提供商 / Model provider (default: 'claude') */
  provider?: 'claude' | 'codex' | 'gemini';
  /** 模型名称 / Model name (provider-specific, e.g. 'opus', 'sonnet', 'haiku') */
  model?: string;
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
