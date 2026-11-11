[OPEN] Debug Session: inference-ui-freeze

# Symptom

- During local inference, token generation progresses normally for hundreds of tokens, then the app becomes stuck and unresponsive.
- Reopening the browser tab restores responsiveness.
- The model appears to remain loaded in VRAM after the freeze.

# Initial Evidence

- Model initializes successfully on WebGPU.
- Prompt submission begins successfully.
- Inference starts and first token arrives after prompt eval.
- Throughput remains stable at about 20 tok/s through at least 749 tokens.
- No explicit browser error is included in the provided report.

# Initial Hypotheses

1. The generation loop never reaches a terminal condition after streaming stops, leaving UI state such as "busy"/abort handlers latched.
2. A React state/update path in the token streaming callback causes main-thread saturation or a render loop once the response grows past a size threshold.
3. An async lock, promise, or abort controller in the Wllama wrapper is left unresolved after a partial stream, blocking future work while the model stays resident.
4. A WebGPU/WASM-side generation call stalls without surfacing an exception, and the app lacks a timeout/recovery path to unwind the pending inference state.
5. Conversation persistence or post-generation processing runs after token streaming and freezes the tab, making it look like inference hung even though decoding already stopped.

# Investigation Notes

- Static analysis confirmed the hot path was the streaming UI pipeline rather than model startup.
- The highest-cost path was cumulative token text flowing through repeated parsing, React state churn, markdown rendering, and synchronous persistence.

# Implemented Changes

- Added temporary performance instrumentation in `src/utils/wllama-context.js`, `src/components/dashboard/Assistant.jsx`, and `src/components/dashboard/chatStore.js` for emit, parse, render, persistence, and stall-recovery timing.
- Increased stream UI throttling to 128 ms and skipped think parsing entirely when reasoning is disabled.
- Replaced cumulative think parsing with an incremental streaming parser in `src/prompts/think-parser.js`.
- Moved in-progress assistant output into transient UI state in `src/components/dashboard/Assistant.jsx` so committed chat history is no longer rewritten on every stream update.
- Replaced live markdown rendering with a lightweight plain-text live preview and memoized final markdown rendering in `src/components/dashboard/MarkdownRenderer.jsx`.
- Simplified live thinking preview to use parser-provided tail lines instead of re-splitting the entire reasoning buffer on every render.
- Deferred chat persistence until browser idle time and capped persisted/live payload sizes.
- Added automatic teardown/reset after watchdog or transient GPU timeout so the next prompt can recover without reopening the tab.

# Verification Status

- VS Code diagnostics are clean for the edited files.
- `npm run build` completes successfully.
- Runtime reproduction is still required to compare pre-fix and post-fix behavior in the browser.
