// ============================================================
// chat/conversation.ts — 对话管理器（JSON 文件持久化 + 内存缓存）
// Conversation manager (JSON file persistence + in-memory cache)
// ============================================================
//
// 策略：write-through cache
//   - 读操作：直接读内存 Map（快）
//   - 写操作：先写内存 Map，再同步写磁盘（一致性优先）
//   - 启动时：从磁盘加载所有 JSON 到内存
//
// Strategy: write-through cache
//   - Read: directly from in-memory Map (fast)
//   - Write: update Map first, then sync to disk (consistency first)
//   - Startup: load all JSON files into memory
//
// 设计原则（来自 FMA 的不可变追加模式）：
// Design principle (from FMA's immutable-append pattern):
//   - 消息只能追加，不能修改或删除
//   - Messages can only be appended, never modified or deleted
//
// [Phase 5 升级点] 将 JSON 文件替换为 Redis 持久化
// [Phase 5 upgrade] Replace JSON files with Redis persistence
//   - 届时只需替换 saveToDisk / removeFromDisk / initStore
//   - 所有导出函数签名不变，上层代码零修改
//
// ============================================================

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Message, Conversation } from './types.js';

// ── 存储路径 / Storage path ───────────────────────────────────
// .data/conversations/{uuid}.json
// [Phase 5 升级点] 替换为 Redis connection config
const DATA_DIR = join(process.cwd(), '.data', 'conversations');

// ── 内存缓存 / In-memory cache ───────────────────────────────
const store = new Map<string, Conversation>();

// ── 磁盘操作 / Disk operations ────────────────────────────────

/**
 * 将对话写入磁盘
 * Persist conversation to disk
 *
 * [Phase 5 升级点] 替换为 Redis SET
 * [Phase 5 upgrade] Replace with Redis SET
 */
function saveToDisk(conv: Conversation): void {
  try {
    const filePath = join(DATA_DIR, `${conv.id}.json`);
    writeFileSync(filePath, JSON.stringify(conv, null, 2), 'utf-8');
  } catch (err) {
    // 磁盘写入失败不中断服务，打印警告
    // Disk write failure should not crash the server
    console.error(`[conversation] Failed to save ${conv.id} to disk:`, err);
  }
}

/**
 * 从磁盘删除对话文件
 * Remove conversation file from disk
 *
 * [Phase 5 升级点] 替换为 Redis DEL
 * [Phase 5 upgrade] Replace with Redis DEL
 */
function removeFromDisk(id: string): void {
  try {
    const filePath = join(DATA_DIR, `${id}.json`);
    unlinkSync(filePath);
  } catch (err) {
    // 文件可能已经不存在，忽略
    // File might already be gone, ignore
    console.error(`[conversation] Failed to remove ${id} from disk:`, err);
  }
}

/**
 * 启动时从磁盘加载所有对话到内存
 * Load all conversations from disk into memory on startup
 *
 * [Phase 5 升级点] 替换为 Redis SCAN + GET
 * [Phase 5 upgrade] Replace with Redis SCAN + GET
 */
function initStore(): void {
  // 确保目录存在 / Ensure directory exists
  mkdirSync(DATA_DIR, { recursive: true });

  let loaded = 0;
  let skipped = 0;

  try {
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = join(DATA_DIR, file);
        const raw = readFileSync(filePath, 'utf-8');
        const conv = JSON.parse(raw) as Conversation;

        // 基本校验：必须有 id 和 messages 数组
        // Basic validation: must have id and messages array
        if (conv.id && Array.isArray(conv.messages)) {
          store.set(conv.id, conv);
          loaded++;
        } else {
          console.warn(`[conversation] Skipping invalid file: ${file} (missing id or messages)`);
          skipped++;
        }
      } catch (parseErr) {
        // JSON 损坏 — 跳过，不中断
        // Corrupted JSON — skip, don't crash
        console.warn(`[conversation] Skipping corrupted file: ${file}`, parseErr);
        skipped++;
      }
    }
  } catch (dirErr) {
    console.error(`[conversation] Failed to read data directory:`, dirErr);
  }

  if (loaded > 0 || skipped > 0) {
    console.log(`[conversation] Loaded ${loaded} conversations from disk (${skipped} skipped)`);
  }
}

// 模块加载时自动初始化 / Auto-initialize on module load
initStore();

// ── 导出的 CRUD 函数 / Exported CRUD functions ────────────────
// 所有函数签名保持不变，上层代码零修改
// All function signatures unchanged — zero changes to upstream code

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
  saveToDisk(conv);
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
  saveToDisk(conv);
  return msg;
}

/**
 * 删除对话
 * Delete a conversation
 */
export function deleteConversation(id: string): boolean {
  const deleted = store.delete(id);
  if (deleted) {
    removeFromDisk(id);
  }
  return deleted;
}
