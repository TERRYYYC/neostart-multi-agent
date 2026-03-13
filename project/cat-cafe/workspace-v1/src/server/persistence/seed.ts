/**
 * Seed data for v1 agent profiles (cats).
 * v1 Agent 档案种子数据（猫）。
 *
 * Run once at dev bootstrap to populate agent-profiles.json.
 * 开发启动时运行一次以填充 agent-profiles.json。
 *
 * Phase 3 upgrade: cats now have family + displayName for grouping.
 * 第三阶段升级：猫现在有 family + displayName 用于分组。
 *
 * Phase 3 multi-provider: added OpenAI (Ragdoll) and Google (Birman) cats.
 * 第三阶段多提供商：添加 OpenAI (布偶猫) 和 Google (伯曼猫)。
 */

import type { AgentProfile, Memory } from '../../shared/types.js';
import { agentProfileStore, memoryStore } from './index.js';

/** v1 default cat roster — grouped by family. / v1 默认猫花名册 — 按品种分组。 */
export const DEFAULT_CATS: AgentProfile[] = [
  // ── Maine Coon family · Anthropic / 缅因猫家族 ──────────────
  {
    id: 'cat-maine',
    name: 'Maine',
    family: 'maine',
    displayName: 'Sonnet',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    persona:
      'You are Maine, a thoughtful and thorough Maine Coon cat. ' +
      'You approach problems methodically and give well-structured answers.',
    enabled: true,
  },
  {
    id: 'cat-maine-opus',
    name: 'Maine',
    family: 'maine',
    displayName: 'Opus',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    persona:
      'You are Maine (Opus), the meticulous variant of the Maine Coon. ' +
      'You take extra care with nuance and produce polished, comprehensive output.',
    enabled: true,
  },
  // ── Siamese family · Anthropic / 暹罗猫家族 ─────────────────
  {
    id: 'cat-siamese',
    name: 'Siamese',
    family: 'siamese',
    displayName: 'Haiku',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    persona:
      'You are Siamese, a quick and concise Siamese cat. ' +
      'You prioritize speed and brevity, giving sharp direct answers.',
    enabled: true,
  },
  // ── Persian family · Anthropic / 波斯猫家族 ─────────────────
  {
    id: 'cat-persian',
    name: 'Persian',
    family: 'persian',
    displayName: 'Opus',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    persona:
      'You are Persian, a meticulous and detail-oriented Persian cat. ' +
      'You take extra care with nuance and produce polished, comprehensive output.',
    enabled: true,
  },
  // ── Ragdoll family · OpenAI / 布偶猫家族 ─────────────────────
  {
    id: 'cat-ragdoll',
    name: 'Ragdoll',
    family: 'ragdoll',
    displayName: 'GPT-4o',
    provider: 'openai',
    model: 'gpt-4o',
    persona:
      'You are Ragdoll, a gentle and versatile Ragdoll cat powered by OpenAI. ' +
      'You are creative, helpful, and adapt well to any task.',
    enabled: true,
  },
  // ── Birman family · Google / 伯曼猫家族 ──────────────────────
  {
    id: 'cat-birman',
    name: 'Birman',
    family: 'birman',
    displayName: 'Flash',
    provider: 'google',
    model: 'gemini-2.0-flash',
    persona:
      'You are Birman, a wise and swift Birman cat powered by Google Gemini. ' +
      'You respond quickly with clear, well-organized answers.',
    enabled: true,
  },
];

/** Phase 4 — sample memories for demo. / Phase 4 — 演示用示例记忆。 */
export const SEED_MEMORIES: Memory[] = [
  {
    id: 'mem-seed-01',
    scope: 'global',
    category: 'user-profile',
    key: 'user_name',
    value: 'The user goes by Terry.',
    source: 'explicit',
    confidence: 1.0,
    visibility: 'public',
    tags: ['identity'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
  },
  {
    id: 'mem-seed-02',
    scope: 'global',
    category: 'preference',
    key: 'response_style',
    value: 'User prefers concise, technical responses with code examples.',
    source: 'explicit',
    confidence: 0.9,
    visibility: 'public',
    tags: ['style'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
  },
  {
    id: 'mem-seed-03',
    scope: 'global',
    category: 'fact',
    key: 'project_language',
    value: 'Primary project language is TypeScript with strict mode enabled.',
    source: 'auto-extracted',
    confidence: 0.85,
    visibility: 'public',
    tags: ['technical', 'project'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
  },
];

/**
 * Seed agent profiles if the store is empty.
 * 如果存储为空则填充 agent 档案。
 *
 * Idempotent: skips profiles that already exist by id.
 * 幂等：跳过已按 id 存在的档案。
 *
 * Also patches existing profiles that are missing new fields (family, displayName).
 * 也会为缺少新字段的现有档案打补丁。
 */
export async function seedAgentProfiles(): Promise<void> {
  const existing = await agentProfileStore.getAll();
  const existingIds = new Set(existing.map((p) => p.id));

  for (const cat of DEFAULT_CATS) {
    if (!existingIds.has(cat.id)) {
      await agentProfileStore.create(cat);
    } else {
      // Patch existing profile with new fields if missing.
      // 为缺少新字段的现有档案打补丁。
      const current = existing.find((p) => p.id === cat.id);
      if (current && (!current.family || !current.displayName)) {
        const patch: Partial<AgentProfile> = {};
        if (!current.family && cat.family) patch.family = cat.family;
        if (!current.displayName && cat.displayName) patch.displayName = cat.displayName;
        if (Object.keys(patch).length > 0) {
          await agentProfileStore.update(cat.id, patch);
        }
      }
    }
  }
}

/**
 * Seed sample memories if the store is empty.
 * 如果存储为空则填充示例记忆。
 *
 * Idempotent: skips memories that already exist by id.
 * 幂等：跳过已按 id 存在的记忆。
 */
export async function seedMemories(): Promise<void> {
  const existing = await memoryStore.getAll();
  const existingIds = new Set(existing.map((m) => m.id));

  for (const mem of SEED_MEMORIES) {
    if (!existingIds.has(mem.id)) {
      await memoryStore.create(mem);
    }
  }
}
