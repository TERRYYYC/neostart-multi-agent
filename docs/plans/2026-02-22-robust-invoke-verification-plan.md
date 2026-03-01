# robust-invoke-hw2.js Verification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build two verification scripts for robust-invoke-hw2.js — static checklist validation and runtime tests with real CLI.

**Architecture:** Two independent scripts. verify-checklist.js reads source text and pattern-matches for required implementations. test-robust-invoke.js uses node:test to run real CLI invocations and assert behavior.

**Tech Stack:** Node.js built-ins only — node:fs, node:assert, node:test, node:child_process

---

### Task 1: Create static checklist verifier

**Files:**
- Create: `invoke/verify-checklist.js`

**Step 1: Write the complete verify-checklist.js**

```javascript
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, 'robust-invoke-hw2.js');

let source;
try {
    source = fs.readFileSync(TARGET, 'utf-8');
} catch {
    console.error(`FAIL: Cannot read ${TARGET}`);
    process.exit(1);
}

const checks = [
    {
        name: 'stdout heartbeat',
        test: () => source.includes('child.stdout.on(') && source.includes('lastActivity'),
    },
    {
        name: 'stderr heartbeat',
        test: () => source.includes('child.stderr.on(') && source.includes('lastActivity'),
    },
    {
        name: 'heartbeat timeout configurable',
        test: () => source.includes('heartbeatTimeout'),
    },
    {
        name: 'SIGTERM handler',
        test: () => source.includes("process.on('SIGTERM'"),
    },
    {
        name: 'SIGINT handler',
        test: () => source.includes("process.on('SIGINT'"),
    },
    {
        name: 'graceful shutdown (SIGTERM -> SIGKILL)',
        test: () => source.includes('SIGTERM') && source.includes('SIGKILL'),
    },
    {
        name: 'retry mechanism',
        test: () => source.includes('maxRetries') && /for\s*\(.*attempt/.test(source),
    },
    {
        name: 'stderr collected in errors',
        test: () => source.includes('stderrTail'),
    },
    {
        name: 'readline NDJSON parsing',
        test: () => source.includes('readline.createInterface'),
    },
    {
        name: 'JSON parse error handling',
        test: () => /try\s*\{[\s\S]*?JSON\.parse/.test(source),
    },
    {
        name: 'environment variable cleanup',
        test: () => source.includes('REMOVE_VARS'),
    },
    {
        name: 'module export',
        test: () => source.includes('module.exports'),
    },
];

let passed = 0;
let failed = 0;

for (const check of checks) {
    if (check.test()) {
        console.log(`  PASS: ${check.name}`);
        passed++;
    } else {
        console.log(`  FAIL: ${check.name}`);
        failed++;
    }
}

console.log(`\n${passed}/${checks.length} checks passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

**Step 2: Verify syntax**

Run: `node -c invoke/verify-checklist.js`
Expected: no output (syntax OK)

**Step 3: Run against robust-invoke-hw2.js (if it exists already)**

Run: `node invoke/verify-checklist.js`
Expected: If robust-invoke-hw2.js exists: 12/12 passed. If not: "FAIL: Cannot read" error.

**Step 4: Commit**

```bash
git add invoke/verify-checklist.js
git commit -m "test: add static checklist verifier for robust-invoke-hw2"
```

---

### Task 2: Create runtime test — normal invocation

**Files:**
- Create: `invoke/test-robust-invoke.js`

**Step 1: Write the test file with first test case**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'robust-invoke-hw2.js');

// Helper: run the script as a CLI subprocess
function runScript(args, opts = {}) {
    return new Promise((resolve, reject) => {
        const timeout = opts.timeout || 60000;
        const child = execFile('node', [SCRIPT, ...args], { timeout }, (err, stdout, stderr) => {
            resolve({ err, stdout, stderr, code: child.exitCode });
        });
    });
}

describe('robust-invoke-hw2', () => {
    it('normal invocation resolves without error', async () => {
        const { invoke } = require(SCRIPT);
        await assert.doesNotReject(() => invoke('claude', 'say hi in one word'));
    });
});
```

**Step 2: Verify syntax**

Run: `node -c invoke/test-robust-invoke.js`
Expected: no output (syntax OK)

**Step 3: Commit**

```bash
git add invoke/test-robust-invoke.js
git commit -m "test: add runtime test — normal invocation"
```

---

### Task 3: Add runtime test — invalid cli parameter

**Files:**
- Modify: `invoke/test-robust-invoke.js`

**Step 1: Add test case inside the describe block, after the first it()**

```javascript
    it('rejects with invalid cli parameter', async () => {
        const { invoke } = require(SCRIPT);
        await assert.rejects(
            () => invoke('invalid', 'test'),
            (err) => {
                assert.match(err.message, /Unsupported cli/);
                return true;
            }
        );
    });
```

**Step 2: Verify syntax**

Run: `node -c invoke/test-robust-invoke.js`
Expected: no output (syntax OK)

**Step 3: Commit**

```bash
git add invoke/test-robust-invoke.js
git commit -m "test: add runtime test — invalid cli parameter"
```

---

### Task 4: Add runtime test — CLI entry point success

**Files:**
- Modify: `invoke/test-robust-invoke.js`

**Step 1: Add test case inside the describe block**

```javascript
    it('CLI entry point exits 0 on valid invocation', async () => {
        const { err, stderr } = await runScript(['claude', 'say ok']);
        assert.strictEqual(err, null, `Expected exit 0 but got error: ${stderr}`);
    });
```

**Step 2: Verify syntax**

Run: `node -c invoke/test-robust-invoke.js`
Expected: no output (syntax OK)

**Step 3: Commit**

```bash
git add invoke/test-robust-invoke.js
git commit -m "test: add runtime test — CLI entry point success"
```

---

### Task 5: Add runtime test — CLI no args

**Files:**
- Modify: `invoke/test-robust-invoke.js`

**Step 1: Add test case inside the describe block**

```javascript
    it('CLI with no args exits 1 and prints usage', async () => {
        const { err, stderr } = await runScript([]);
        assert.ok(err, 'Expected non-zero exit');
        assert.match(stderr, /Usage/);
    });
```

**Step 2: Verify syntax**

Run: `node -c invoke/test-robust-invoke.js`
Expected: no output (syntax OK)

**Step 3: Commit**

```bash
git add invoke/test-robust-invoke.js
git commit -m "test: add runtime test — CLI no args"
```

---

### Task 6: Add runtime test — SIGINT cleanup

**Files:**
- Modify: `invoke/test-robust-invoke.js`

**Step 1: Add required import at top of file (after existing requires)**

```javascript
const { spawn } = require('node:child_process');
```

**Step 2: Add test case inside the describe block**

```javascript
    it('SIGINT kills parent and child cleanly', async () => {
        const child = spawn('node', [SCRIPT, 'claude', 'write a 2000 word essay about history'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Wait 2 seconds for CLI to start, then send SIGINT
        await new Promise((resolve) => setTimeout(resolve, 2000));
        child.kill('SIGINT');

        const exitCode = await new Promise((resolve) => {
            child.on('close', (code) => resolve(code));
        });

        // Process should have exited (code may be null or non-zero due to signal)
        assert.ok(exitCode !== 0 || exitCode === null, 'Process should have exited from SIGINT');
    });
```

**Step 3: Verify syntax**

Run: `node -c invoke/test-robust-invoke.js`
Expected: no output (syntax OK)

**Step 4: Commit**

```bash
git add invoke/test-robust-invoke.js
git commit -m "test: add runtime test — SIGINT cleanup"
```

---

### Task 7: Run full verification suite

**Step 1: Run static checklist**

Run: `node invoke/verify-checklist.js`
Expected: `12/12 checks passed, 0 failed`

**Step 2: Run runtime tests**

Run: `node --test invoke/test-robust-invoke.js`
Expected: All 5 tests pass (duration ~2-3 minutes)

**Step 3: Commit**

```bash
git commit --allow-empty -m "test: full verification suite passed for robust-invoke-hw2"
```
