# robust-invoke-hw2.js Design

## Goal

Create a hardened version of `invoke.js` that adds heartbeat-based timeout, retry, process lifecycle management, and better error reporting. Single file, pure Node.js, no dependencies.

## File

`invoke/robust-invoke-hw2.js`

## Interface

```javascript
invoke(cli, prompt, opts?)
```

### opts

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| resume | boolean | false | Resume last conversation |
| heartbeatTimeout | number | 120000 | ms without stdout/stderr before timeout |
| maxRetries | number | 4 | Total attempts before giving up |

### CLI usage

```bash
node robust-invoke-hw2.js claude "prompt"
node robust-invoke-hw2.js codex --resume "prompt"
```

## Architecture — Three Layers

### Layer 1: spawnCli(cli, prompt, opts)

Single attempt to spawn and run a CLI process.

- Build command/args based on cli type
- spawn with stdio: ['ignore', 'pipe', 'pipe']
- readline on stdout for NDJSON parsing
- Both stdout.on('data') and stderr.on('data') update lastActivity (heartbeat)
- setInterval every 10s checks: Date.now() - lastActivity > heartbeatTimeout
  - Yes: SIGTERM, then SIGKILL after 5s grace period
- stderr: real-time passthrough + collect last 2000 chars for error messages
- Reject includes stderr tail for debugging
- Sets module-level activeChild reference for signal cleanup

### Layer 2: invokeWithRetry(cli, prompt, opts)

Retry wrapper around spawnCli.

- Loop up to maxRetries attempts
- On failure: log to stderr, wait (attempt * 2) seconds, retry
- On final failure: throw the error
- All errors are retryable (crash, timeout, non-zero exit)

### Layer 3: invoke(cli, prompt, opts?)

Public API.

- Validate cli parameter ('claude' or 'codex')
- Merge opts with defaults
- Call invokeWithRetry

### Module-level: Signal Handling

- Track activeChild reference
- process.on('SIGTERM') and process.on('SIGINT') trigger cleanup
- cleanup: kill activeChild with SIGTERM, force exit after 5s

## Environment Variable Cleanup

Same as existing invoke.js — remove Claude-specific vars only:

- CLAUDECODE
- CLAUDE_CODE_ENTRYPOINT
- CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES
- CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL
- CLAUDE_AGENT_SDK_VERSION
- __CFBundleIdentifier

## Checklist Coverage

| Check Item | Solution |
|-----------|----------|
| stderr + stdout heartbeat | Both streams update lastActivity |
| Configurable timeout | heartbeatTimeout option, default 120s |
| Process lifecycle | SIGTERM/SIGINT handlers, activeChild cleanup |
| NDJSON parsing | readline + try/catch (same as before) |
| Environment isolation | Same REMOVE_VARS cleanup |
| Error handling | Retry 4x, stderr tail in error messages |
| Graceful shutdown | SIGTERM -> 5s -> SIGKILL |
