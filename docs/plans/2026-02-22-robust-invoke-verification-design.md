# robust-invoke-hw2.js Verification Design

## Goal

Two-layer verification for robust-invoke-hw2.js: static checklist validation (code presence) + runtime tests (real CLI behavior).

## Files

- `invoke/verify-checklist.js` — static source code checks
- `invoke/test-robust-invoke.js` — runtime tests with real CLI

## Part 1: Static Verification — verify-checklist.js

Read `robust-invoke-hw2.js` source text, assert key implementations exist via regex/string matching.

| Check | Pattern |
|-------|---------|
| stdout heartbeat | `child.stdout.on('data'` + `lastActivity` |
| stderr heartbeat | `child.stderr.on('data'` + `lastActivity` |
| Heartbeat timeout configurable | `heartbeatTimeout` parameter |
| SIGTERM handler | `process.on('SIGTERM'` |
| SIGINT handler | `process.on('SIGINT'` |
| Graceful shutdown (SIGTERM -> SIGKILL) | Both `SIGTERM` and `SIGKILL` present |
| Retry mechanism | `maxRetries` + retry loop |
| stderr collected in errors | `stderrTail` |
| readline NDJSON parsing | `readline.createInterface` |
| JSON parse error handling | `try` + `JSON.parse` |
| Environment variable cleanup | `REMOVE_VARS` |
| Module export | `module.exports` |

Run: `node invoke/verify-checklist.js`
Output: per-item pass/fail, summary at end.
Tech: `node:assert`, `node:fs`

## Part 2: Runtime Verification — test-robust-invoke.js

Real CLI calls using `node:test` + `node:assert`.

| Test Case | Action | Assertion |
|-----------|--------|-----------|
| Normal invocation | `invoke('claude', 'say hi in one word')` | Resolves without error |
| Invalid cli param | `invoke('invalid', 'test')` | Rejects with "Unsupported cli" |
| CLI entry point | `execFile node robust-invoke-hw2.js claude "say ok"` | Exit code 0 |
| CLI no args | `execFile node robust-invoke-hw2.js` | Exit code 1, stderr has "Usage" |
| SIGINT cleanup | Spawn long task, send SIGINT after 2s | Parent exits, no orphan processes |

Run: `node --test invoke/test-robust-invoke.js`
Expected duration: 2-3 minutes (real CLI calls).
Tech: `node:test`, `node:assert`, `node:child_process`
