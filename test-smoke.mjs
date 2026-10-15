import { createJiti } from "file:///C:/Users/Bass/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url);

const { buildTreeRows, JsonTree } = await jiti.import("./json-tree.ts");
const { snapshotPayload, extractRequest, extractToolCallBlocks, summarizeAssistantText, sanitizeToolResult, previewToolResult } =
	await jiti.import("./snapshot.ts");
const { groupHistoryFromEntries, buildCallSummary } = await jiti.import("./summary.ts");

let failed = 0;
function check(name, cond) {
	if (!cond) {
		failed++;
		console.error(`FAIL: ${name}`);
	} else {
		console.log(`ok: ${name}`);
	}
}

// ── buildTreeRows ──
const theme = { fg: (_t, s) => s, bg: (_t, s) => s, style: (s) => s };
const data = { a: 1, b: { c: "x" }, d: [1, { e: true }] };
const root = buildTreeRows(data, theme, new Set());
check("root open+close present", root.some((r) => r.text === "{") && root.some((r) => r.text === "}"));
check("scalar row", root.some((r) => r.text.includes("a:") && r.text.includes("1")));

// nested collapsed by default
const nested = root.find((r) => r.expandable && r.text.includes("b"));
check("nested collapsed by default", !!nested && nested.expanded === false && nested.text.includes("▸"));

// expand via set
const expandedSet = new Set(["/b"]);
const rows2 = buildTreeRows(data, theme, expandedSet);
check("expanded shows nested key", rows2.some((r) => r.text.includes("c:")));

// arrays: root arrays
const arrRows = buildTreeRows([{ i: 0 }, { i: 1 }], theme, new Set());
check("root array open", arrRows.some((r) => r.text === "["));

// ── JsonTree interaction ──
const tree = new JsonTree(theme, data, 80);
const lines0 = tree.render(80, 10);
check("renders some lines", lines0.length > 0 && lines0.length <= 10);
// cursor at row0 = "{" expandable → toggle collapse root
tree.handleInput("\r", 10);
const afterToggle = tree.render(80, 10);
check("collapse root reduces rows", tree.rowCount === 1);
tree.handleInput("\r", 10); // expand again
check("expand restores", tree.rowCount > 1);

// scroll: big data
const big = { list: Array.from({ length: 500 }, (_, i) => ({ i, txt: "x".repeat(50) })) };
const bigTree = new JsonTree(theme, big, 80);
for (let i = 0; i < 520; i++) bigTree.handleInput("\x1b[B", 12);
const bl = bigTree.render(80, 12);
check("scrolled to bottom", bl.some((l) => l.includes("500") || l.includes("499")));
check("lines fit width", bl.every((l) => l.length <= 80 + 16)); // ansi bg adds few chars

// inline truncation of long strings
const longStr = { s: "y".repeat(1000) };
const lr = buildTreeRows(longStr, theme, new Set());
check("long string inline-truncated", lr.some((r) => r.text.includes("(+")));

// ── snapshot ──
const payloadAnthropic = { model: "claude-x", system: "you are", messages: [{ role: "user", content: "hi" }], tools: [{ name: "t" }] };
const snap = snapshotPayload(payloadAnthropic);
check("snapshot keeps raw", !!snap.raw && snap.bytes > 0 && !snap.truncated);
const exA = extractRequest(payloadAnthropic);
check("anthropic system extracted", exA.system === "you are" && exA.messages.length === 1 && exA.tools.length === 1 && exA.model === "claude-x");

const payloadOpenAI = { model: "gpt-z", messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] };
const exO = extractRequest(payloadOpenAI);
check("openai system-first extracted", exO.messages.length === 1 && exO.messages[0].role === "user" && exO.system.role === "system");

const bigPayload = { messages: ["q".repeat(3_000_000)] };
const bigSnap = snapshotPayload(bigPayload);
check("oversize payload truncated flag", bigSnap.truncated && bigSnap.raw === undefined && bigSnap.bytes > 3_000_000);

const msg = { role: "assistant", content: [ { type: "text", text: "answer" }, { type: "thinking", thinking: "hm" }, { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } } ], usage: { input: 5, output: 7, cacheRead: 3, cacheWrite: 1 }, stopReason: "toolUse" };
const blocks = extractToolCallBlocks(msg.content);
check("toolCall blocks extracted", blocks.length === 1 && blocks[0].name === "read" && blocks[0].id === "c1");
const sum = summarizeAssistantText(msg.content);
check("assistant summary", sum.text === "answer" && sum.thinkingCount === 1);
const san = sanitizeToolResult({ content: [ { type: "text", text: "out" }, { type: "image", data: "BASE64" } ], details: { ok: 1 } });
check("tool result sanitized", san.content[0].text === "out" && san.content[1].data === "[image omitted]" && san.details.ok === 1);
check("preview text", previewToolResult({ content: [{ type: "text", text: "  hello\nworld long ".repeat(50) }] }, 500).length <= 501);

// ── summary grouping ──
const mk = (turnIndex, customType = "agent-workflow-call", data = {}) => ({ type: "custom", customType, data: { v: 1, ts: 0, turnIndex, runPrompt: "p", source: "user", model: "m", tools: [], assistantPreview: "", ...data }, id: `${turnIndex}` });
const entries = [mk(0), mk(1), mk(0), mk(1), mk(2)];
const { runs } = groupHistoryFromEntries(entries, 100);
check("history grouped by turnIndex continuity", runs.length === 2 && runs[0].calls.length === 2 && runs[1].calls.length === 3);
const { runs: none } = groupHistoryFromEntries([{ type: "custom", customType: "other", id: "x" }], 1);
check("unrelated entries ignored", none.length === 0);
check("buildCallSummary string", (() => { const s = buildCallSummary(mk(3).data); return typeof s === "string" && s.includes("#3"); })());

console.log(failed ? `\n${failed} FAILURES` : "\nALL PASS");
process.exit(failed ? 1 : 0);
