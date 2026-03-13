/**
 * Agent Profile CRUD API — Phase 3 Config Center.
 * Agent 配置管理 API — 第三阶段配置中心。
 *
 * GET    /api/agents       — list all profiles (enabled + disabled)
 * GET    /api/agents/:id   — get single profile
 * POST   /api/agents       — create new profile
 * PUT    /api/agents/:id   — update profile (id immutable)
 * DELETE /api/agents/:id   — delete profile (409 if active invocations)
 */

import { Router } from 'express';
import type { AgentProfile } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import { agentProfileStore, invocationStore } from '../persistence/index.js';
import { agentRegistry } from '../registry/agent-registry.js';
import {
  KNOWN_PROVIDERS,
  PROVIDER_MODEL_SUGGESTIONS,
  isKnownProvider,
  validateModelForProvider,
} from '../runtime/provider-router.js';

export const agentRouter = Router();

/**
 * GET /api/agents/providers — list known providers with model suggestions.
 * 列出已知提供商及其模型建议。
 */
agentRouter.get('/providers', (_req, res) => {
  const providers = KNOWN_PROVIDERS.map((p) => ({
    id: p,
    models: PROVIDER_MODEL_SUGGESTIONS[p],
  }));
  res.json(providers);
});

/** GET /api/agents — list all agent profiles. / 列出所有 Agent 配置。 */
agentRouter.get('/', async (_req, res) => {
  try {
    const profiles = await agentProfileStore.getAll();
    // Sort alphabetically by name. / 按名称字母顺序排列。
    profiles.sort((a, b) => a.name.localeCompare(b.name));
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/agents/:id — get single agent profile. / 获取单个 Agent 配置。 */
agentRouter.get('/:id', async (req, res) => {
  try {
    const profile = await agentProfileStore.getById(req.params.id);
    if (!profile) {
      res.status(404).json({ error: 'Agent profile not found / Agent 配置未找到' });
      return;
    }
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * Validate required fields for create/update.
 * 验证创建/更新所需的必填字段。
 */
function validateProfileFields(
  body: Record<string, unknown>,
  requireAll: boolean,
): string | null {
  const requiredFields = ['name', 'provider', 'model', 'persona'] as const;

  for (const field of requiredFields) {
    const value = body[field];
    if (requireAll) {
      // On create, all fields are required. / 创建时所有字段必填。
      if (value === undefined || value === null || String(value).trim() === '') {
        return `Field "${field}" is required / 字段 "${field}" 为必填项`;
      }
    } else {
      // On update, only validate fields that are present. / 更新时只验证存在的字段。
      if (value !== undefined && String(value).trim() === '') {
        return `Field "${field}" cannot be empty / 字段 "${field}" 不能为空`;
      }
    }
  }
  return null;
}

/** POST /api/agents — create a new agent profile. / 创建新的 Agent 配置。 */
agentRouter.post('/', async (req, res) => {
  try {
    const validationError = validateProfileFields(req.body, true);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    // Provider validation — reject unknown providers. / 提供商验证 — 拒绝未知提供商。
    const providerStr = String(req.body.provider).trim();
    if (!isKnownProvider(providerStr)) {
      res.status(400).json({
        error:
          `Unknown provider "${providerStr}". Known providers: ${KNOWN_PROVIDERS.join(', ')} / ` +
          `未知提供商 "${providerStr}"。已知提供商：${KNOWN_PROVIDERS.join(', ')}`,
      });
      return;
    }

    const profile: AgentProfile = {
      id: generateId(),
      name: String(req.body.name).trim(),
      provider: providerStr,
      model: String(req.body.model).trim(),
      persona: String(req.body.persona).trim(),
      enabled: req.body.enabled !== false, // default true / 默认启用
      // Optional grouping fields / 可选分组字段
      ...(req.body.family ? { family: String(req.body.family).trim() } : {}),
      ...(req.body.displayName ? { displayName: String(req.body.displayName).trim() } : {}),
    };

    const created = await agentProfileStore.create(profile);

    // Hot-reload registry so new agent is immediately available. / 热重载注册表使新 Agent 立即可用。
    await agentRegistry.load();

    // Soft model validation — warn if model prefix doesn't match provider. / 软模型验证。
    const modelWarning = validateModelForProvider(profile.provider, profile.model);
    res.status(201).json({ ...created, ...(modelWarning ? { warning: modelWarning } : {}) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** PUT /api/agents/:id — update an existing agent profile. / 更新现有 Agent 配置。 */
agentRouter.put('/:id', async (req, res) => {
  try {
    const existing = await agentProfileStore.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Agent profile not found / Agent 配置未找到' });
      return;
    }

    const validationError = validateProfileFields(req.body, false);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    // Provider validation on update / 更新时的提供商验证
    if (req.body.provider !== undefined) {
      const prov = String(req.body.provider).trim();
      if (!isKnownProvider(prov)) {
        res.status(400).json({
          error:
            `Unknown provider "${prov}". Known providers: ${KNOWN_PROVIDERS.join(', ')} / ` +
            `未知提供商 "${prov}"。已知提供商：${KNOWN_PROVIDERS.join(', ')}`,
        });
        return;
      }
    }

    // Build partial update — only include fields present in body. / 构建部分更新。
    const patch: Partial<AgentProfile> = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.provider !== undefined) patch.provider = String(req.body.provider).trim();
    if (req.body.model !== undefined) patch.model = String(req.body.model).trim();
    if (req.body.persona !== undefined) patch.persona = String(req.body.persona).trim();
    if (req.body.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
    if (req.body.family !== undefined) patch.family = req.body.family ? String(req.body.family).trim() : undefined;
    if (req.body.displayName !== undefined) patch.displayName = req.body.displayName ? String(req.body.displayName).trim() : undefined;

    const updated = await agentProfileStore.update(req.params.id, patch);

    // Hot-reload registry. / 热重载注册表。
    await agentRegistry.load();

    // Soft model validation / 软模型验证
    const finalProvider = updated.provider;
    const finalModel = updated.model;
    const modelWarning = validateModelForProvider(finalProvider, finalModel);
    res.json({ ...updated, ...(modelWarning ? { warning: modelWarning } : {}) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** DELETE /api/agents/:id — delete agent profile (with safety check). / 删除 Agent 配置（含安全检查）。 */
agentRouter.delete('/:id', async (req, res) => {
  try {
    const existing = await agentProfileStore.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Agent profile not found / Agent 配置未找到' });
      return;
    }

    // Safety check: reject if agent has active (running/queued) invocations.
    // 安全检查：如果 Agent 有活跃的（running/queued）调用，拒绝删除。
    const activeInvocations = await invocationStore.findBy(
      (inv) =>
        inv.targetAgentId === req.params.id &&
        (inv.state === 'running' || inv.state === 'queued'),
    );
    if (activeInvocations.length > 0) {
      res.status(409).json({
        error:
          'Cannot delete agent with active invocations / 无法删除有活跃调用的 Agent',
        activeCount: activeInvocations.length,
      });
      return;
    }

    await agentProfileStore.delete(req.params.id);

    // Hot-reload registry. / 热重载注册表。
    await agentRegistry.load();

    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
