// ============================================================
// chat/types.ts — 聊天模块的类型定义
// Type definitions for the chat module
// ============================================================

/**
 * 单条消息
 * A single chat message
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * 一段对话（包含多条消息）
 * A conversation (contains multiple messages)
 */
export interface Conversation {
  id: string;
  messages: Message[];
  createdAt: number;
  modelProvider: string;
}

/**
 * 客户端发来的聊天请求
 * Chat request from the client
 */
export interface ChatRequest {
  conversationId?: string;
  message: string;
}

/**
 * CLI Runner 的流式输出事件
 * Streaming output event from CLI Runner
 *
 * claude --output-format stream-json 的输出格式参考：
 * Each line is a JSON object with varying structures.
 * We normalize to this union type.
 */
export interface StreamEvent {
  type: 'text' | 'error' | 'done' | 'usage';
  content?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * 支持的 CLI 模型提供商
 * Supported CLI model providers
 */
export type ModelProvider = 'claude' | 'codex' | 'gemini';

/**
 * CLI Runner 配置
 * CLI Runner configuration per provider
 */
export interface CliConfig {
  command: string;
  buildArgs: (prompt: string) => string[];
  parseOutput: (line: string) => StreamEvent | null;
}
