// ============================================================
// chat/conversation.ts — 内存中的对话管理器
// In-memory conversation manager
// ============================================================
//
// 管理多轮对话的创建、消息追加、查询
// Manages creation, message appending, and querying of conversations
//
// 设计原则（来自 FMA 的不可变追加模式）：
// Design principle (from FMA's immutable-append pattern):
//   - 消息只能追加，不能修改或删除
//   - Messages can only be appended, never modified or deleted
//
// [Phase 5 升级点] 替换为 Redis 持久化
// [Phase 5 upgrade] Replace with Redis persistence
//
// ============================================================

import { randomUUID } from 'node:crypto';
import type { Message, Conversation } from './types.js';

/**
 * 内存对话存储
 * In-memory conversation store
 */
const store = new Map<string, Conversation>();

/**
 * 创建新对话
 * Create a new conversation
 */
export function createConversation(modelProvider: string): Conversation {
  const conv: Conversation = {
    id: randomUUID(),
    messages: [],
    createdAt: Date.now(),
    modelProvider,
  };
  store.set(conv.id, conv);
  return conv;
}

/**
 * 获取对话（如果不存在返回 undefined）
 * Get conversation (returns undefined if not found)
 */
export function getConversation(id: string): Conversation | undefined {
  return store.get(id);
}

/**
 * 获取所有对话列表（按最近修改排序）
 * Get all conversations (sorted by most recently modified)
 */
export function listConversations(): Conversation[] {
  return [...store.values()].sort((a, b) => {
    const aLast = a.messages.at(-1)?.timestamp ?? a.createdAt;
    const bLast = b.messages.at(-1)?.timestamp ?? b.createdAt;
    return bLast - aLast;
  });
}

/**
 * 向对话追加一条消息
 * Append a message to a conversation
 */
export function addMessage(
  conversationId: string,
  role: Message['role'],
  content: string
): Message {
  const conv = store.get(conversationId);
  if (!conv) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const msg: Message = {
    role,
    content,
    timestamp: Date.now(),
  };

  conv.messages.push(msg);
  return msg;
}

/**
 * 删除对话
 * Delete a conversation
 */
export function deleteConversation(id: string): boolean {
  return store.delete(id);
}
