// ============================================================
// agent.ts — 底层 Agent 运行器（封装 Anthropic SDK 调用）
// Base agent runner (wraps Anthropic SDK calls)
// ============================================================
//
// [架构笔记] 为什么这里用 SDK 而不是 CLI？
// [Architecture note] Why SDK here instead of CLI?
//
//   MVP 阶段：SDK 代码最简洁，对新手友好
//   MVP stage: SDK code is cleanest, beginner-friendly
//
//   Phase 2（可迭代升级）：把这个文件替换成 CLI runner
//   Phase 2 (upgradeable): Replace this file with CLI runner
//   参考 p006 的 lesson-01 ADR-001，CLI 支持 OAuth 和多模型
//   See p006 lesson-01 ADR-001: CLI supports OAuth & multi-model
//
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { AgentResult } from './types.js';

// 单例客户端 — 复用 TCP 连接，避免重复建连开销
// Singleton client — reuse TCP connection, avoid reconnect overhead
const client = new Anthropic();

/**
 * 运行一个 Agent：发送 system prompt + user message，返回 Agent 输出
 * Run one agent: send system prompt + user message, return agent output
 */
export async function runAgent(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  model = 'claude-opus-4-5-20251101'  // 可替换为 haiku 降低成本 / swap to haiku to reduce cost
): Promise<AgentResult> {
  const startMs = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error(`[${agentName}] Unexpected response block type: ${block.type}`);
  }

  return {
    agentName,
    output: block.text,
    durationMs: Date.now() - startMs,
  };
}
