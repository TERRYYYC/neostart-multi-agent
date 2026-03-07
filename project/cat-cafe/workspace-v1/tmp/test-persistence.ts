/**
 * Smoke test for the persistence layer.
 * 持久化层冒烟测试。
 *
 * Run: npx tsx tmp/test-persistence.ts
 */

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

// Point to a temp data dir so we don't pollute real data.
const TEST_DATA_DIR = join(process.cwd(), 'tmp', 'test-data');
process.env['DATA_DIR'] = TEST_DATA_DIR;

// Dynamic import AFTER setting env var.
const {
  threadStore,
  messageStore,
  eventLogStore,
  agentProfileStore,
} = await import('../src/server/persistence/index.js');
const { seedAgentProfiles } = await import('../src/server/persistence/seed.js');

async function cleanup() {
  if (existsSync(TEST_DATA_DIR)) {
    await rm(TEST_DATA_DIR, { recursive: true });
  }
}

async function run() {
  await cleanup();

  console.log('--- Test 1: Create and read a Thread ---');
  const thread = await threadStore.create({
    id: 'thread-001',
    title: 'Test Thread',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'created',
  });
  const fetched = await threadStore.getById('thread-001');
  assert(fetched !== undefined, 'Thread should exist');
  assert(fetched!.title === 'Test Thread', 'Title should match');
  console.log('  PASS');

  console.log('--- Test 2: Create and read a Message ---');
  const msg = await messageStore.create({
    id: 'msg-001',
    threadId: 'thread-001',
    role: 'user',
    authorType: 'user',
    authorId: 'user-1',
    visibility: 'public',
    content: 'Hello @maine',
    mentions: ['maine'],
    createdAt: new Date().toISOString(),
  });
  const msgs = await messageStore.findBy((m) => m.threadId === 'thread-001');
  assert(msgs.length === 1, 'Should have 1 message');
  console.log('  PASS');

  console.log('--- Test 3: Create and read an EventLog ---');
  await eventLogStore.create({
    id: 'evt-001',
    threadId: 'thread-001',
    invocationId: 'inv-001',
    eventType: 'invocation.created',
    visibility: 'private',
    payload: { detail: 'test' },
    createdAt: new Date().toISOString(),
  });
  const evts = await eventLogStore.getAll();
  assert(evts.length === 1, 'Should have 1 event');
  console.log('  PASS');

  console.log('--- Test 4: Message and EventLog are separate files ---');
  const msgFile = join(TEST_DATA_DIR, 'messages.json');
  const evtFile = join(TEST_DATA_DIR, 'event-logs.json');
  assert(existsSync(msgFile), 'messages.json should exist');
  assert(existsSync(evtFile), 'event-logs.json should exist');
  assert(msgFile !== evtFile, 'Files must be different');
  console.log('  PASS');

  console.log('--- Test 5: Update a record ---');
  await threadStore.update('thread-001', { status: 'active', title: 'Updated' });
  const updated = await threadStore.getById('thread-001');
  assert(updated!.status === 'active', 'Status should be active');
  assert(updated!.title === 'Updated', 'Title should be Updated');
  console.log('  PASS');

  console.log('--- Test 6: Duplicate id rejected ---');
  let threw = false;
  try {
    await threadStore.create({ ...thread, title: 'Dup' });
  } catch {
    threw = true;
  }
  assert(threw, 'Should throw on duplicate id');
  console.log('  PASS');

  console.log('--- Test 7: Seed agent profiles ---');
  await seedAgentProfiles();
  const profiles = await agentProfileStore.getAll();
  assert(profiles.length === 3, 'Should have 3 cats');
  assert(profiles[0].name === 'Maine', 'First cat should be Maine');
  // Run again — should be idempotent.
  await seedAgentProfiles();
  const profilesAgain = await agentProfileStore.getAll();
  assert(profilesAgain.length === 3, 'Still 3 cats after re-seed');
  console.log('  PASS');

  console.log('\n=== All tests passed ===');
  await cleanup();
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
