/**
 * Seed data for v1 agent profiles (cats).
 * v1 Agent 档案种子数据（猫）。
 *
 * Run once at dev bootstrap to populate agent-profiles.json.
 * 开发启动时运行一次以填充 agent-profiles.json。
 */

import type { AgentProfile } from '../../shared/types.js';
import { agentProfileStore } from './index.js';

/** v1 default cat roster. / v1 默认猫花名册。 */
export const DEFAULT_CATS: AgentProfile[] = [
  {
    id: 'cat-maine',
    name: 'Maine',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    persona:
      'You are Maine, a thoughtful and thorough Maine Coon cat. ' +
      'You approach problems methodically and give well-structured answers.',
    enabled: true,
  },
  {
    id: 'cat-siamese',
    name: 'Siamese',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    persona:
      'You are Siamese, a quick and concise Siamese cat. ' +
      'You prioritize speed and brevity, giving sharp direct answers.',
    enabled: true,
  },
  {
    id: 'cat-persian',
    name: 'Persian',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    persona:
      'You are Persian, a meticulous and detail-oriented Persian cat. ' +
      'You take extra care with nuance and produce polished, comprehensive output.',
    enabled: true,
  },
];

/**
 * Seed agent profiles if the store is empty.
 * 如果存储为空则填充 agent 档案。
 *
 * Idempotent: skips profiles that already exist by id.
 * 幂等：跳过已按 id 存在的档案。
 */
export async function seedAgentProfiles(): Promise<void> {
  const existing = await agentProfileStore.getAll();
  const existingIds = new Set(existing.map((p) => p.id));

  for (const cat of DEFAULT_CATS) {
    if (!existingIds.has(cat.id)) {
      await agentProfileStore.create(cat);
    }
  }
}
