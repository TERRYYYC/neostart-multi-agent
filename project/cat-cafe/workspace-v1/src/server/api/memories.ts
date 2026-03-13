/**
 * Memory CRUD API — Phase 4 Long-term Memory.
 * 记忆 CRUD API — 第四阶段长期记忆。
 *
 * GET    /api/memories           — list all memories (with filters)
 * GET    /api/memories/stats     — aggregate stats
 * GET    /api/memories/:id       — get single memory
 * POST   /api/memories           — create new memory
 * PUT    /api/memories/:id       — update memory
 * DELETE /api/memories/:id       — delete memory
 */

import { Router } from 'express';
import type { Memory, MemoryScope, MemoryCategory, MemorySource } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import { memoryStore } from '../persistence/index.js';

export const memoryRouter = Router();

// ---------------------------------------------------------------------------
// Constants / 常量
// ---------------------------------------------------------------------------

const VALID_SCOPES: MemoryScope[] = ['global', 'thread', 'agent'];
const VALID_CATEGORIES: MemoryCategory[] = [
  'fact', 'preference', 'context', 'user-profile', 'session-insight', 'agent-state',
];
const VALID_SOURCES: MemorySource[] = ['explicit', 'auto-extracted'];

// ---------------------------------------------------------------------------
// Validation / 验证
// ---------------------------------------------------------------------------

function validateMemoryFields(
  body: Record<string, unknown>,
  requireAll: boolean,
): string | null {
  // Scope validation / 范围验证
  if (requireAll || body.scope !== undefined) {
    const scope = body.scope as string;
    if (requireAll && !scope) return 'Field "scope" is required / 字段 "scope" 为必填项';
    if (scope && !VALID_SCOPES.includes(scope as MemoryScope)) {
      return `Invalid scope "${scope}". Valid: ${VALID_SCOPES.join(', ')} / 无效范围`;
    }
    // Scope-dependent required fields / 范围依赖的必填字段
    if (scope === 'thread' && !body.threadId) {
      return 'scope="thread" requires threadId / scope="thread" 需要 threadId';
    }
    if (scope === 'agent' && !body.agentId) {
      return 'scope="agent" requires agentId / scope="agent" 需要 agentId';
    }
  }

  // Category validation / 类别验证
  if (requireAll || body.category !== undefined) {
    const cat = body.category as string;
    if (requireAll && !cat) return 'Field "category" is required / 字段 "category" 为必填项';
    if (cat && !VALID_CATEGORIES.includes(cat as MemoryCategory)) {
      return `Invalid category "${cat}". Valid: ${VALID_CATEGORIES.join(', ')} / 无效类别`;
    }
  }

  // Key and value / 键和值
  if (requireAll) {
    if (!body.key || String(body.key).trim() === '') {
      return 'Field "key" is required / 字段 "key" 为必填项';
    }
    if (!body.value || String(body.value).trim() === '') {
      return 'Field "value" is required / 字段 "value" 为必填项';
    }
  } else {
    if (body.key !== undefined && String(body.key).trim() === '') {
      return 'Field "key" cannot be empty / 字段 "key" 不能为空';
    }
    if (body.value !== undefined && String(body.value).trim() === '') {
      return 'Field "value" cannot be empty / 字段 "value" 不能为空';
    }
  }

  // Confidence range / 置信度范围
  if (body.confidence !== undefined) {
    const conf = Number(body.confidence);
    if (isNaN(conf) || conf < 0 || conf > 1) {
      return 'Confidence must be 0.0–1.0 / 置信度必须在 0.0–1.0 之间';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Routes / 路由
// ---------------------------------------------------------------------------

/**
 * GET /api/memories/stats — aggregate stats.
 * 获取记忆聚合统计。
 */
memoryRouter.get('/stats', async (_req, res) => {
  try {
    const all = await memoryStore.getAll();
    const byScope: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const m of all) {
      byScope[m.scope] = (byScope[m.scope] || 0) + 1;
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    }

    res.json({
      total: all.length,
      byScope,
      byCategory,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/memories — list memories with optional filters.
 * 列出记忆，支持可选过滤。
 *
 * Query params: scope, category, threadId, agentId, search, limit, offset
 */
memoryRouter.get('/', async (req, res) => {
  try {
    const {
      scope, category, threadId, agentId, search,
      limit: limitStr, offset: offsetStr,
    } = req.query;

    let memories = await memoryStore.getAll();

    // Filters / 过滤
    if (scope) {
      memories = memories.filter((m) => m.scope === scope);
    }
    if (category) {
      memories = memories.filter((m) => m.category === category);
    }
    if (threadId) {
      memories = memories.filter((m) => m.threadId === threadId);
    }
    if (agentId) {
      memories = memories.filter((m) => m.agentId === agentId);
    }
    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      memories = memories.filter(
        (m) =>
          m.key.toLowerCase().includes(q) ||
          m.value.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Sort by updatedAt descending / 按更新时间降序排列
    memories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const total = memories.length;
    const limit = Math.min(parseInt(String(limitStr || '50'), 10), 200);
    const offset = parseInt(String(offsetStr || '0'), 10);
    memories = memories.slice(offset, offset + limit);

    res.json({ total, offset, limit, memories });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/memories/:id — get single memory. / 获取单条记忆。 */
memoryRouter.get('/:id', async (req, res) => {
  try {
    const memory = await memoryStore.getById(req.params.id);
    if (!memory) {
      res.status(404).json({ error: 'Memory not found / 记忆未找到' });
      return;
    }
    res.json(memory);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/memories — create new memory. / 创建新记忆。 */
memoryRouter.post('/', async (req, res) => {
  try {
    const validationError = validateMemoryFields(req.body, true);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const scope = String(req.body.scope).trim() as MemoryScope;
    const key = String(req.body.key).trim();
    const threadId = scope === 'thread' ? String(req.body.threadId).trim() : undefined;
    const agentId = scope === 'agent' ? String(req.body.agentId).trim() : undefined;

    // Uniqueness check: key + scope + threadId + agentId / 唯一性检查
    const existing = await memoryStore.findBy((m) =>
      m.key === key &&
      m.scope === scope &&
      m.threadId === threadId &&
      m.agentId === agentId,
    );
    if (existing.length > 0) {
      res.status(409).json({
        error: `Memory with key "${key}" already exists in this scope / 该范围内已存在键 "${key}" 的记忆`,
        existingId: existing[0].id,
      });
      return;
    }

    const now = new Date().toISOString();
    const source: MemorySource = VALID_SOURCES.includes(req.body.source as MemorySource)
      ? (req.body.source as MemorySource)
      : 'explicit';

    const memory: Memory = {
      id: generateId(),
      scope,
      ...(threadId ? { threadId } : {}),
      ...(agentId ? { agentId } : {}),
      category: String(req.body.category).trim() as MemoryCategory,
      key,
      value: String(req.body.value).trim(),
      source,
      confidence: req.body.confidence !== undefined ? Number(req.body.confidence) : 1.0,
      visibility: 'public',
      tags: Array.isArray(req.body.tags) ? req.body.tags.map(String) : [],
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    };

    const created = await memoryStore.create(memory);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** PUT /api/memories/:id — update memory. / 更新记忆。 */
memoryRouter.put('/:id', async (req, res) => {
  try {
    const existing = await memoryStore.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Memory not found / 记忆未找到' });
      return;
    }

    const validationError = validateMemoryFields(req.body, false);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const patch: Partial<Memory> = { updatedAt: new Date().toISOString() };
    if (req.body.value !== undefined) patch.value = String(req.body.value).trim();
    if (req.body.category !== undefined) patch.category = req.body.category as MemoryCategory;
    if (req.body.confidence !== undefined) patch.confidence = Number(req.body.confidence);
    if (req.body.tags !== undefined) patch.tags = Array.isArray(req.body.tags) ? req.body.tags.map(String) : [];
    if (req.body.key !== undefined) patch.key = String(req.body.key).trim();

    const updated = await memoryStore.update(req.params.id, patch);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** DELETE /api/memories/:id — delete memory. / 删除记忆。 */
memoryRouter.delete('/:id', async (req, res) => {
  try {
    const existing = await memoryStore.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Memory not found / 记忆未找到' });
      return;
    }

    await memoryStore.delete(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
