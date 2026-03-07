/**
 * Smoke test for the invocation runtime (WS5).
 * 调用运行时冒烟测试。
 *
 * Run: npx tsx tmp/test-runtime.ts
 */

import { join } from 'node:path';

const TEST_DATA_DIR = join(process.cwd(), 'tmp', 'test-data-runtime');
process.env['DATA_DIR'] = TEST_DATA_DIR;

// Dynamic imports after env var set.
const { seedAgentProfiles } = await import('../src/server/persistence/seed.js');
const { agentRegistry } = await import('../src/server/registry/agent-registry.js');
const {
  threadStore,
  messageStore,
  invocationStore,
  agentSessionStore,
  eventLogStore,
} = await import('../src/server/persistence/index.js');
const { executeInvocation, extractTaskText } = await import(
  '../src/server/runtime/orchestrator.js'
);
const { StubRunner } = await import('../src/server/runtime/runner.js');
const { generateId } = await import('../src/shared/id.js');

// ---------------------------------------------------------------------------

async function run() {
  // Bootstrap
  await seedAgentProfiles();
  await agentRegistry.load();

  // Create a thread and user message.
  const threadId = generateId();
  await threadStore.create({
    id: threadId,
    title: 'Test Runtime Thread',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
  });

  const userMsgId = generateId();
  const userContent = '@maine please review this code';
  await messageStore.create({
    id: userMsgId,
    threadId,
    role: 'user',
    authorType: 'user',
    authorId: 'user-1',
    visibility: 'public',
    content: userContent,
    mentions: ['maine'],
    createdAt: new Date().toISOString(),
  });

  // -----------------------------------------------------------------------
  console.log('--- Test 1: extractTaskText ---');
  const task = extractTaskText(userContent, 'maine');
  assert(task === 'please review this code', `Got: "${task}"`);
  console.log('  PASS');

  // -----------------------------------------------------------------------
  console.log('--- Test 2: Successful invocation lifecycle ---');
  const result = await executeInvocation({
    threadId,
    sourceMessageId: userMsgId,
    mention: 'maine',
    taskText: 'please review this code',
  });

  assert(result.ok === true, 'Should succeed');
  if (!result.ok) throw new Error('Unexpected failure');

  // Check invocation state
  const inv = result.invocation;
  assert(inv.state === 'completed', `State: ${inv.state}`);
  assert(inv.threadId === threadId, 'threadId mismatch');
  assert(inv.sourceMessageId === userMsgId, 'sourceMessageId mismatch');
  assert(inv.targetAgentId === 'cat-maine', `targetAgentId: ${inv.targetAgentId}`);
  assert(inv.sessionId !== '', 'sessionId should be set');
  assert(inv.finishedAt !== undefined, 'finishedAt should be set');
  console.log('  Invocation: PASS');

  // Check reply message
  const reply = result.replyMessage;
  assert(reply.role === 'assistant', `Role: ${reply.role}`);
  assert(reply.visibility === 'public', `Visibility: ${reply.visibility}`);
  assert(reply.authorType === 'agent', `AuthorType: ${reply.authorType}`);
  assert(reply.authorId === 'cat-maine', `AuthorId: ${reply.authorId}`);
  assert(reply.sourceInvocationId === inv.id, 'sourceInvocationId mismatch');
  assert(reply.content.includes('Maine'), 'Content should mention Maine');
  console.log('  Reply message: PASS');

  // Check event log sequence
  const events = await eventLogStore.findBy((e) => e.invocationId === inv.id);
  const types = events.map((e) => e.eventType);
  assert(types.includes('invocation.created'), 'Missing invocation.created');
  assert(types.includes('invocation.started'), 'Missing invocation.started');
  assert(types.includes('invocation.text.delta'), 'Missing invocation.text.delta');
  assert(types.includes('invocation.completed'), 'Missing invocation.completed');
  // Verify all events are private by default
  const allPrivate = events
    .filter((e) => e.eventType.startsWith('invocation.'))
    .every((e) => e.visibility === 'private');
  assert(allPrivate, 'All invocation events should be private');
  console.log('  Event log sequence: PASS');

  // Check session was created
  const sessions = await agentSessionStore.findBy(
    (s) => s.threadId === threadId && s.agentId === 'cat-maine',
  );
  assert(sessions.length === 1, `Sessions: ${sessions.length}`);
  assert(sessions[0].status === 'active', 'Session should be active');
  // Session event
  const sessionEvents = events.filter(
    (e) => e.eventType === 'session.created' || e.eventType === 'session.selected',
  );
  assert(sessionEvents.length === 1, 'Should have exactly 1 session event');
  console.log('  Session: PASS');

  // -----------------------------------------------------------------------
  console.log('--- Test 3: Second invocation reuses session ---');
  const userMsg2Id = generateId();
  await messageStore.create({
    id: userMsg2Id,
    threadId,
    role: 'user',
    authorType: 'user',
    authorId: 'user-1',
    visibility: 'public',
    content: '@maine another task',
    mentions: ['maine'],
    createdAt: new Date().toISOString(),
  });

  const result2 = await executeInvocation({
    threadId,
    sourceMessageId: userMsg2Id,
    mention: 'maine',
    taskText: 'another task',
  });
  assert(result2.ok === true, 'Second invocation should succeed');

  // Should still be 1 session (reused)
  const sessions2 = await agentSessionStore.findBy(
    (s) => s.threadId === threadId && s.agentId === 'cat-maine' && s.status === 'active',
  );
  assert(sessions2.length === 1, 'Should reuse session, not create new');

  // Check that session.selected event was emitted (not session.created)
  if (result2.ok) {
    const events2 = await eventLogStore.findBy(
      (e) => e.invocationId === result2.invocation.id,
    );
    const sessionEvt = events2.find(
      (e) => e.eventType === 'session.created' || e.eventType === 'session.selected',
    );
    assert(sessionEvt?.eventType === 'session.selected', 'Should emit session.selected');
  }
  console.log('  PASS');

  // -----------------------------------------------------------------------
  console.log('--- Test 4: Invalid mention fails gracefully ---');
  const result3 = await executeInvocation({
    threadId,
    sourceMessageId: userMsgId,
    mention: 'nonexistent',
    taskText: 'hello',
  });
  assert(result3.ok === false, 'Should fail for unknown mention');
  if (!result3.ok) {
    assert(result3.reason.includes('Unknown agent'), `Reason: ${result3.reason}`);
  }
  console.log('  PASS');

  // -----------------------------------------------------------------------
  console.log('--- Test 5: Runner failure produces failed invocation ---');
  const failRunner = new StubRunner({ shouldFail: true });
  const userMsg3Id = generateId();
  await messageStore.create({
    id: userMsg3Id,
    threadId,
    role: 'user',
    authorType: 'user',
    authorId: 'user-1',
    visibility: 'public',
    content: '@siamese fail test',
    mentions: ['siamese'],
    createdAt: new Date().toISOString(),
  });

  const result4 = await executeInvocation({
    threadId,
    sourceMessageId: userMsg3Id,
    mention: 'siamese',
    taskText: 'fail test',
    runner: failRunner,
  });
  assert(result4.ok === false, 'Should fail with failing runner');

  // Check that invocation was marked as failed
  const failedInvocations = await invocationStore.findBy(
    (i) => i.sourceMessageId === userMsg3Id,
  );
  assert(failedInvocations.length === 1, 'Should have 1 invocation');
  assert(failedInvocations[0].state === 'failed', `State: ${failedInvocations[0].state}`);
  assert(failedInvocations[0].errorCode === 'stub_error', 'Error code mismatch');

  // Check invocation.failed event
  const failEvents = await eventLogStore.findBy(
    (e) => e.invocationId === failedInvocations[0].id && e.eventType === 'invocation.failed',
  );
  assert(failEvents.length === 1, 'Should have invocation.failed event');
  console.log('  PASS');

  // -----------------------------------------------------------------------
  console.log('--- Test 6: Message and EventLog remain separate ---');
  const allMessages = await messageStore.getAll();
  const allEvents = await eventLogStore.getAll();
  // Messages should only be user messages + successful agent replies
  const agentReplies = allMessages.filter((m) => m.role === 'assistant');
  // Events should be runtime records, not messages
  assert(agentReplies.length === 2, `Agent replies: ${agentReplies.length}`);
  assert(allEvents.length > 0, 'Should have events');
  // No event should have the same id as any message
  const msgIds = new Set(allMessages.map((m) => m.id));
  const evtIds = new Set(allEvents.map((e) => e.id));
  const overlap = [...msgIds].filter((id) => evtIds.has(id));
  assert(overlap.length === 0, 'Message and EventLog IDs must not overlap');
  console.log('  PASS');

  console.log('\n=== All runtime tests passed ===');
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
