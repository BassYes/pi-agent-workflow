# pi-agent-workflow

A pi (pi-coding-agent) extension that turns what the agent actually did into something you can inspect: for every user turn, the **real model requests** (`system` / `messages` / `tools`), **model responses**, and **tool calls** are presented as a checkable execution chain — transplanted from the DeepSeek Harness plugin [`dsh-plugin-agent-workflow`](https://github.com/xuanyuanzhifeng/dsh-plugin-agent-workflow).

Use it to observe and reverse-engineer agent behavior — including pi's own: what was actually sent to the model, what came back, and how tools were invoked. Like the DSH original, it is a **read-only observer**: it never adds messages, prompts, or tools to model requests.

> 中文说明:[README.zh.md](README.zh.md)

## Preview

```
工作流 · 会话运行  live 3 / 历史 12 · 记录:开
────────────────────────────────────────────────
▶ 14:23 修复 pi-agent-workflow 的滚动越界        调用4 工具9 ↑52.3k ↓12.1k
  14:31 帮我把 README 里的安装命令改成中文        调用2 工具3 ↑31.0k ↓2.2k

#0 deepseek-v4-flash ✓  ↑3.2k 缓存20.1k ↓1.1k · 工具3 · 11.2s
#1 deepseek-v4-flash ✓  ↑28.4k 缓存26.9k ↓2.0k · 工具6 · 24.5s

[1 System] [2 Messages] [3 Tools] [4 Raw] [5 响应] [6 工具调用]
  ▸ messages  Array(10)
      ▾ user  {
          content: "把 README 里的安装命令改成中文"
        }
```

## Features

- **Browse by user turn** — live runs in the current process, plus a dimmed *session history* group reconstructed from persisted summaries after a restart.
- **Execution chain per call** — each model call shown with token in/out, cache read/write, tool count, duration, and success/error marks.
- **Full request inspection** — `System` / `Messages` / `Tools` / `Raw` tabs render the provider's own wire shape (Anthropic top-level `system`, OpenAI-style leading system message, and an unprocessed raw snapshot), in a collapsible JSON tree.
- **Response inspection** — usage, stop reason, duration, thinking-block count, reply text; full message JSON.
- **Tool execution states** — running / done / error, arguments, result preview + full sanitized result, duration, nested-call origin (codemode/MCP style).
- **Token & cache statistics** — input, cache read, cache write, output (with reasoning subset), per call and per run.
- **Keyboard-driven, three levels** — runs → calls → detail; one `esc` back, `q` to quit.

## Install

Requires Node.js 22.19+ (the runtime of `pi` itself; the extension is plain TypeScript loaded by pi's `jiti`).

Copy the folder into pi's user extensions directory:

```sh
git clone https://github.com/BassYes/pi-agent-workflow.git
mkdir -p ~/.pi/agent/extensions
cp -r pi-agent-workflow ~/.pi/agent/extensions/
```

Or load a single copy for development:

```sh
pi --extension ./pi-agent-workflow/index.ts
```

Restart pi. The status bar shows `wf ●` while detailed recording is on.

### Type-checking the sources yourself

```sh
# from the repo root; creates throwaway junctions for type resolution
mkdir -p node_modules/@earendil-works node_modules/@types
mklink /J node_modules\@earendil-works\pi-coding-agent "<global npm>\@earendil-works\pi-coding-agent"
mklink /J node_modules\@earendil-works\pi-tui     "<global npm>\@earendil-works\pi-coding-agent\node_modules\@earendil-works\pi-tui"
mklink /J node_modules\@types                     "<global npm>\@earendil-works\pi-coding-agent\node_modules\@types"
npx -y -p typescript@5.9.3 tsc --noEmit -p tsconfig.json
rm -rf node_modules   # keep the folder transportable afterwards
```

`node test-smoke.mjs` smoke-tests the pure logic (needs no pi instance).

## Usage

| Command | Effect |
| --- | --- |
| `/workflow` | Open the viewer (interactive TUI mode) |
| `/workflow on` / `off` | Toggle detailed recording for new turns (default on) |
| `/workflow status` | Show recording state and count of fully recorded runs |
| `/workflow clear` | Drop this process's detailed in-memory records (session summary entries are kept) |

### Viewer keys

Navigate runs → calls → detail:

- `↑/↓` or `j/k` move, `Enter` drill in, `←`/`Esc` go back, `q` quit (from any level)
- Detail: `1`–`6` or `[` / `]` switch tabs (System / Messages / Tools / Raw / 响应 / 工具调用)
- Tree: `↑/↓` move cursor, `Enter` toggle node, `pageUp/pageDown` page, `g`/`G` top/bottom
- `e` expand all, `c` collapse all, `,` / `.` switch between tool calls

## Where the data comes from

- **Detailed data (in-memory, current process only)** — `before_provider_request` snapshots the real wire payload (requests over 2 MB keep only structural counts; the total retained payload budget is ~128 MB, oldest runs evicted first), `message_end` captures the response (usage, stop reason, duration), `tool_execution_*` captures tool calls (arguments, result, status, duration). Nothing here survives a restart.
- **Session summaries (persisted)** — every turn appends one compact custom entry (model, token/cache usage, tool list, duration) to the session file. After a restart, `/workflow` still shows these turns as a dimmed *history* group without request payloads.
- System prompt, tool definitions, responses and tool results come from pi's existing records; the extension adds nothing to model requests.

## Known limitations

- Raw payloads live only in memory, with per-request (2 MB) and total (~128 MB) caps.
- The terminal viewer is keyboard-driven lists instead of the DSH plugin's two-pane web layout.
- Session tree/branch/compaction boundaries are approximated by `turnIndex` continuity when rebuilding history.
- The overlay renders a fixed line count; very short terminals may clip it.

## License

[MIT](LICENSE). Concept and data model transplanted from [dsh-plugin-agent-workflow](https://github.com/xuanyuanzhifeng/dsh-plugin-agent-workflow) (MIT); this implementation targets pi.
