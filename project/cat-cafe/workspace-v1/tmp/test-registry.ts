/**
 * Smoke test for agent registry.
 * Agent 注册表冒烟测试。
 *
 * Run: npx tsx tmp/test-registry.ts
 */

import { join } from 'node:path';

const TEST_DATA_DIR = join(process.cwd(), 'tmp', 'test-data-reg');
process.env['DATA_DIR'] = TEST_DATA_DIR;

const { seedAgentProfiles } = await import('../src/server/persistence/seed.js');
const { agentRegistry, parseMentions } = await import(
  '../src/server/registry/agent-registry.js'
);

async function run() {
  // Seed cats first
  await seedAgentProfiles();
  await agentRegistry.load();

  console.log('--- Test 1: Resolve valid mention (case insensitive) ---');
  const r1 = await agentRegistry.resolve('maine');
  assert(r1.ok === true, 'Should resolve maine');
  if (r1.ok) assert(r1.profile.name === 'Maine', 'Name should be Maine');

  const r2 = await agentRegistry.resolve('SIAMESE');
  assert(r2.ok === true, 'Should resolve SIAMESE');

  const r3 = await agentRegistry.resolve('Persian');
  assert(r3.ok === true, 'Should resolve Persian');
  console.log('  PASS');

  console.log('--- Test 2: Reject invalid mention ---');
  const r4 = await agentRegistry.resolve('unknown');
  assert(r4.ok === false, 'Should fail for unknown');
  if (!r4.ok) assert(r4.reason.includes('Unknown agent'), 'Reason should say unknown');
  console.log('  PASS');

  console.log('--- Test 3: Reject empty mention ---');
  const r5 = await agentRegistry.resolve('');
  assert(r5.ok === false, 'Should fail for empty');
  if (!r5.ok) assert(r5.reason.includes('Empty'), 'Reason should say empty');
  console.log('  PASS');

  console.log('--- Test 4: parseMentions extracts correctly ---');
  const m1 = parseMentions('Hey @maine please check this');
  assert(m1.length === 1, 'Should find 1 mention');
  assert(m1[0] === 'maine', 'Should be maine');

  const m2 = parseMentions('@Maine and @Siamese help me');
  assert(m2.length === 2, 'Should find 2 mentions');

  const m3 = parseMentions('No mentions here');
  assert(m3.length === 0, 'Should find 0 mentions');
  console.log('  PASS');

  console.log('--- Test 5: parseMentions deduplicates ---');
  const m4 = parseMentions('@maine do this @maine do that');
  assert(m4.length === 1, 'Should deduplicate to 1');
  console.log('  PASS');

  console.log('--- Test 6: availableNames lists all cats ---');
  const names = agentRegistry.availableNames();
  assert(names.length === 3, 'Should have 3 cats');
  console.log('  PASS');

  console.log('\n=== All registry tests passed ===');
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
