# `invoke.js` 及其与 Minimal 脚本的区别

## 概述

在当前项目中，共有三种不同的调用 AI 命令行工具的脚本实现：

1. **`minimal-claude.js`**: 针对 Claude 的极简调用脚本。
2. **`minimal-codex.js`**: 针对 Codex 的极简调用脚本。
3. **`invoke.js`**: 基于上述两者重构和抽象出的统一封装模块。

## 详细区别

### 1. `minimal-claude.js`
这是一个独立的脚本，专门用来通过命令行调用 Anthropic 的 `claude` 工具。
* **参数传递**：通过 `process.argv` 接收提示词（Prompt）。
* **执行方式**：通过 `child_process.spawn` 运行 `claude -p <prompt> --output-format stream-json --verbose`。
* **环境处理**：特别处理了环境变量，移除了一些特定的向后兼容或干扰变量（如 `CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT` 等）。
* **输出解析**：监听标准输出，逐行解析 JSON，当事件类型为 `assistant` 时，提取并打印 `block.text`。

### 2. `minimal-codex.js`
这也是一个独立的脚本，专门用来独立调用 `codex` 工具。
* **参数传递**：通过 `process.argv` 接收提示词。
* **执行方式**：通过 `child_process.spawn` 运行 `codex exec --json <prompt>`。
* **输出解析**：监听标准输出并逐行解析 JSON，当事件类型为 `item.completed` 且 `item.type` 为 `agent_message` 时，提取并打印 `event.item.text`。

### 3. `invoke.js` (统一的封装模块)
这是基于前面两个极简脚本**重构和抽象出的统一封装函数**。
* **统一接口**：整合了两套截然不同的调用逻辑，通过统一的 `invoke(cli, prompt)` 函数，传入 `cli` 参数（`'claude'` 或 `'codex'`）即可动态决定调用哪个后端。
* **模块化复用**：它返回一个 Promise，支持异步等待，并使用 `module.exports = { invoke };` 导出。
* **命令行支持**：不仅能作为模块被引用，还可以直接通过命令行运行：`node invoke.js claude "给我的代码写注释"`。

## 目标结果演示

因为 `invoke.js` 导出了基于 Promise 的异步函数 `invoke`，因此我们可以实现在 Node.js 代码中的串行、模块化调用。

如下的演示代码展示了如何达成目标结果：

```javascript
// 可以保存为 test-invoke.js 后通过 node test-invoke.js 运行
const { invoke } = require('./invoke');

async function main() {
    try {
        console.log('--- 开始调用 Claude ---');
        await invoke('claude', '你好');
        
        console.log('\n--- 开始调用 Codex ---');
        await invoke('codex', '你好');
        
        console.log('\n--- 全部调用完成 ---');
    } catch (error) {
        console.error('发生错误:', error);
    }
}

main();
```

通过这样的封装，`invoke.js` 完美地满足了在代码大局中无缝调度、切换不同 AI 模型（Claude 或 Codex）并且进行等待输出（`await`）的需求。
