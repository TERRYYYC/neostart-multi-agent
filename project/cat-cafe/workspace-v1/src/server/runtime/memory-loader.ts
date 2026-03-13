/**
 * Memory Loader — scores, selects, and formats memories for prompt injection.
 * 记忆加载器 — 对记忆进行评分、选择并格式化以注入 prompt。
 *
 * Phase 4 Long-term Memory.
 * This module is runner-agnostic and can be used by any CLI runner.
 * 此模块与 runner 无关，可被任何 CLI runner 使用。
 */

import type { Memory, MemoryCategory, MemoryScope, Message } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import { memoryStore } from '../persistence/index.js';

// ---------------------------------------------------------------------------
// Configuration / 配置
// ---------------------------------------------------------------------------

const MAX_MEMORIES = parseInt(process.env['MAX_MEMORIES_IN_CONTEXT'] ?? '3', 10);
const MAX_MEMORY_CHARS = parseInt(process.env['MAX_MEMORY_CHARS'] ?? '500', 10);

// Category boost weights / 类别加权
const CATEGORY_BOOST: Record<MemoryCategory, number> = {
  'preference': 20,
  'user-profile': 15,
  'fact': 10,
  'context': 5,
  'session-insight': 3,
  'agent-state': 2,
};

// ---------------------------------------------------------------------------
// Scoring / 评分
// ---------------------------------------------------------------------------

/**
 * Score a single memory for relevance to the current invocation context.
 * 对单条记忆的相关性进行评分。
 *
 * Returns -1 to skip (wrong agent scope), otherwise a positive score.
 * 返回 -1 表示跳过（错误的 agent 范围），否则返回正分数。
 */
export function scoreMemory(
  memory: Memory,
  taskText: string,
  recentMessages: Message[],
  agentId: string,
  threadId: string,
): number {
  let score = 0;

  // 1. Scope match / 范围匹配
  if (memory.scope === 'agent') {
    if (memory.agentId === agentId) {
      score += 100; // agent-specific → highest priority / agent 专属 → 最高优先级
    } else {
      return -1; // wrong agent → skip / 不同 agent → 跳过
    }
  } else if (memory.scope === 'thread') {
    if (memory.threadId === threadId) {
      score += 80; // thread-specific → high priority / 线程专属 → 高优先级
    } else {
      return -1; // wrong thread → skip / 不同线程 → 跳过
    }
  } else {
    // global
    score += 50;
  }

  // 2. Confidence weight / 置信度权重
  score += memory.confidence * 50;

  // 3. Recency boost (decays by day) / 近期使用加成（按天衰减）
  const daysSinceAccess =
    (Date.now() - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
  score += Math.max(0, 20 - daysSinceAccess);

  // 4. Access frequency boost / 访问频率加成
  score += Math.min(memory.accessCount, 10) * 2;

  // 5. Keyword match in task text or recent history / 关键词匹配
  const recentText = [
    taskText,
    ...recentMessages.slice(-3).map((m) => m.content),
  ].join(' ').toLowerCase();

  if (recentText.includes(memory.key.toLowerCase())) {
    score += 30;
  }
  // Also check partial value match / 也检查值的部分匹配
  const valueWords = memory.value.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  const matchedWords = valueWords.filter((w) => recentText.includes(w));
  if (matchedWords.length > 0) {
    score += Math.min(matchedWords.length * 5, 15);
  }

  // 6. Category boost / 类别加成
  score += CATEGORY_BOOST[memory.category] || 0;

  return score;
}

// ---------------------------------------------------------------------------
// Memory retrieval / 记忆检索
// ---------------------------------------------------------------------------

export interface MemoryContext {
  memories: Memory[];
  formatted: string;
}

/**
 * Find the most relevant memories for the current invocation.
 * 查找当前调用最相关的记忆。
 *
 * Loads all candidate memories (global + thread-scoped + agent-scoped),
 * scores them, selects top N within budget, updates access tracking.
 * 加载所有候选记忆，评分后选择预算内的 top N，更新访问跟踪。
 */
export async function findRelevantMemories(
  threadId: string,
  agentId: string,
  taskText: string,
  recentMessages: Message[],
): Promise<MemoryContext> {
  // Load all memories — filter to candidates for this context
  // 加载所有记忆 — 筛选此上下文的候选者
  const all = await memoryStore.getAll();

  const candidates = all.filter((m) => {
    if (m.scope === 'global') return true;
    if (m.scope === 'thread' && m.threadId === threadId) return true;
    if (m.scope === 'agent' && m.agentId === agentId) return true;
    return false;
  });

  if (candidates.length === 0) {
    return { memories: [], formatted: '' };
  }

  // Score and rank / 评分排序
  const scored = candidates
    .map((m) => ({ memory: m, score: scoreMemory(m, taskText, recentMessages, agentId, threadId) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Select top N within char budget / 在字符预算内选择 top N
  const selected: Memory[] = [];
  let totalChars = 0;

  for (const { memory } of scored) {
    if (selected.length >= MAX_MEMORIES) break;
    const entryChars = memory.value.length + memory.key.length + 20; // overhead for formatting
    if (totalChars + entryChars > MAX_MEMORY_CHARS && selected.length > 0) break;
    selected.push(memory);
    totalChars += entryChars;
  }

  // Update access tracking / 更新访问追踪
  const now = new Date().toISOString();
  for (const memory of selected) {
    await memoryStore.update(memory.id, {
      lastAccessedAt: now,
      accessCount: memory.accessCount + 1,
    });
  }

  const formatted = formatMemoriesForPrompt(selected);
  return { memories: selected, formatted };
}

// ---------------------------------------------------------------------------
// Formatting / 格式化
// ---------------------------------------------------------------------------

/**
 * Format selected memories into a prompt section.
 * 将选中的记忆格式化为 prompt 段落。
 */
export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const lines = memories.map((m) => {
    const conf = Math.round(m.confidence * 100);
    // Truncate value if too long / 截断过长的值
    const maxValueLen = 150;
    const value = m.value.length > maxValueLen
      ? m.value.substring(0, maxValueLen) + '...'
      : m.value;
    return `- [${m.category}] ${value} (confidence: ${conf}%)`;
  });

  return `[Learned Memory]:\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Auto-extraction from agent output / 从 agent 输出中自动提取
// ---------------------------------------------------------------------------

/**
 * Parsed memory marker from agent output.
 * 从 agent 输出中解析的记忆标记。
 */
export interface ExtractedMemory {
  category: MemoryCategory;
  key: string;
  value: string;
  confidence?: number;
}

const VALID_CATEGORIES: MemoryCategory[] = [
  'fact', 'preference', 'context', 'user-profile', 'session-insight', 'agent-state',
];

/**
 * Parse [MEMORY: ...] markers from agent output text.
 * 从 agent 输出文本中解析 [MEMORY: ...] 标记。
 *
 * Format: [MEMORY: category=fact, key=project_lang, value=TypeScript 5.2]
 * Optional: confidence=0.95
 */
export function parseMemoryMarkers(text: string): ExtractedMemory[] {
  const results: ExtractedMemory[] = [];
  const regex = /\[MEMORY:\s*([^\]]+)\]/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const inner = match[1];
    const params: Record<string, string> = {};

    // Parse key=value pairs (comma-separated)
    // 解析 key=value 对（逗号分隔）
    for (const part of inner.split(',')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const k = part.substring(0, eqIdx).trim().toLowerCase();
      const v = part.substring(eqIdx + 1).trim();
      params[k] = v;
    }

    const category = params['category'] as MemoryCategory;
    const key = params['key'];
    const value = params['value'];

    if (!category || !key || !value) continue;
    if (!VALID_CATEGORIES.includes(category)) continue;

    const extracted: ExtractedMemory = { category, key, value };
    if (params['confidence']) {
      const conf = parseFloat(params['confidence']);
      if (!isNaN(conf) && conf >= 0 && conf <= 1) {
        extracted.confidence = conf;
      }
    }

    results.push(extracted);
  }

  return results;
}

/**
 * Strip [MEMORY: ...] markers from text (for public message display).
 * 从文本中去除 [MEMORY: ...] 标记（用于公开消息显示）。
 */
export function stripMemoryMarkers(text: string): string {
  return text.replace(/\[MEMORY:\s*[^\]]+\]\s*/gi, '').trim();
}

/**
 * Create Memory entities from extracted markers.
 * 从提取的标记创建 Memory 实体。
 *
 * Deduplicates by key — if memory with same key already exists in global scope,
 * it will not create a duplicate.
 * 按 key 去重 — 如果全局范围内已存在相同 key 的记忆，不会创建重复。
 */
export async function createMemoriesFromExtraction(
  extracted: ExtractedMemory[],
  scope: MemoryScope = 'global',
  threadId?: string,
  agentId?: string,
): Promise<Memory[]> {
  const created: Memory[] = [];
  const now = new Date().toISOString();

  for (const ext of extracted) {
    // Dedup check / 去重检查
    const existing = await memoryStore.findBy((m) =>
      m.key === ext.key && m.scope === scope &&
      m.threadId === (scope === 'thread' ? threadId : undefined) &&
      m.agentId === (scope === 'agent' ? agentId : undefined),
    );

    if (existing.length > 0) {
      // Update existing memory value instead of creating duplicate
      // 更新现有记忆的值而不是创建重复
      await memoryStore.update(existing[0].id, {
        value: ext.value,
        confidence: ext.confidence ?? 0.8,
        updatedAt: now,
      });
      continue;
    }

    const memory: Memory = {
      id: generateId(),
      scope,
      ...(scope === 'thread' && threadId ? { threadId } : {}),
      ...(scope === 'agent' && agentId ? { agentId } : {}),
      category: ext.category,
      key: ext.key,
      value: ext.value,
      source: 'auto-extracted',
      confidence: ext.confidence ?? 0.8,
      visibility: 'public',
      tags: ['auto-extracted'],
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    };

    await memoryStore.create(memory);
    created.push(memory);
  }

  return created;
}
