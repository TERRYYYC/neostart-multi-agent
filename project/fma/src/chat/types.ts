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
 * 各 CLI 的输出格式各异，统一归一化为此联合类型
 * Different CLIs have different output formats, normalized to this union type
 */
export interface StreamEvent {
  type: 'text' | 'error' | 'done' | 'usage' | 'timing';
  content?: string;
  error?: string;
  /** Token 用量（由 CLI 解析器提取） / Token usage (extracted by CLI parsers) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;     // 缓存命中的 token 数 / cached input tokens
    totalTokens?: number;      // 总 token 数（部分 provider 提供）/ total tokens (some providers)
  };
  /** 响应耗时（由服务端计算）/ Response duration (calculated server-side) */
  durationMs?: number;
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
