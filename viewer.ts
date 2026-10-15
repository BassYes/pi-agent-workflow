/**
 * pi-agent-workflow — the interactive TUI viewer.
 *
 * Three views, ported from the DSH plugin's "工作流" tab:
 *   runs   — 按用户轮次浏览(agent run 列表 + 会话历史摘要)
 *   calls  — 本轮的模型调用列表
 *   detail — 单次模型调用:System / Messages / Tools / Raw / 响应 / 工具调用
 */

import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { JsonTree } from "./json-tree";
import { formatClock, formatMs, formatTokens, type WorkflowCall, type WorkflowRun } from "./model";

export interface ViewerData {
	live: WorkflowRun[];
	history: WorkflowRun[];
	recording: boolean;
}

const ROWS_VIEWPORT = 20;
const TREE_VIEWPORT = 22;

type View = "runs" | "calls" | "detail";

const TABS = ["system", "messages", "tools", "raw", "response", "toolcalls"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
	system: "1 System",
	messages: "2 Messages",
	tools: "3 Tools",
	raw: "4 Raw",
	response: "5 响应",
	toolcalls: "6 工具调用",
};

export class WorkflowViewer implements Component {
	focused = true;

	private view: View = "runs";
	private runIdx = 0;
	private callIdx = 0;
	private tabIdx = 0;
	private toolIdx = 0;
	private runScroll = 0;
	private callScroll = 0;
	private trees = new Map<string, JsonTree>();
	private treeKey = "";

	constructor(
		private readonly theme: Theme,
		private readonly data: ViewerData,
		private readonly done: (result: "close" | undefined) => void,
	) {}

	invalidate(): void {
		this.trees.clear();
		this.treeKey = "";
	}

	get runs(): WorkflowRun[] {
		return [...this.data.live, ...this.data.history];
	}

	private currentRun(): WorkflowRun | undefined {
		return this.runs[this.runIdx];
	}

	private currentCall(): WorkflowCall | undefined {
		return this.currentRun()?.calls[this.callIdx];
	}

	private backOrClose(): void {
		if (this.view === "detail") this.view = "calls";
		else if (this.view === "calls") this.view = "runs";
		else this.done("close");
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q") {
			this.backOrClose();
			return;
		}
		if (this.view === "runs") this.handleRunsInput(data);
		else if (this.view === "calls") this.handleCallsInput(data);
		else this.handleDetailInput(data);
	}

	private handleRunsInput(data: string): void {
		const count = this.runs.length;
		if (matchesKey(data, "return")) {
			if (this.currentRun()) {
				this.view = "calls";
				this.callIdx = 0;
				this.callScroll = 0;
			}
		} else if (matchesKey(data, "up") || data === "k") {
			this.runIdx = Math.max(0, this.runIdx - 1);
			this.keepRunVisible();
		} else if (matchesKey(data, "down") || data === "j") {
			this.runIdx = Math.min(Math.max(0, count - 1), this.runIdx + 1);
			this.keepRunVisible();
		}
	}

	private handleCallsInput(data: string): void {
		const call = this.currentRun();
		const count = call?.calls.length ?? 0;
		if (matchesKey(data, "return") || matchesKey(data, "right")) {
			if (count > 0) {
				this.view = "detail";
				this.tabIdx = 0;
				this.toolIdx = 0;
			}
		} else if (matchesKey(data, "up") || data === "k") {
			this.callIdx = Math.max(0, this.callIdx - 1);
			this.keepCallVisible();
		} else if (matchesKey(data, "down") || data === "j") {
			this.callIdx = Math.min(Math.max(0, count - 1), this.callIdx + 1);
			this.keepCallVisible();
		} else if (matchesKey(data, "left")) {
			this.view = "runs";
		}
	}

	private handleDetailInput(data: string): void {
		if (data >= "1" && data <= "6") {
			this.tabIdx = Number(data) - 1;
			return;
		}
		if (data === "]") {
			this.tabIdx = (this.tabIdx + 1) % TABS.length;
			return;
		}
		if (data === "[") {
			this.tabIdx = (this.tabIdx + TABS.length - 1) % TABS.length;
			return;
		}
		if (data === ",") {
			this.toolIdx = Math.max(0, this.toolIdx - 1);
			return;
		}
		if (data === ".") {
			this.toolIdx++;
			return;
		}
		const tree = this.tabTree(0);
		if (tree) tree.handleInput(data, TREE_VIEWPORT);
	}

	private keepRunVisible(): void {
		if (this.runIdx < this.runScroll) this.runScroll = this.runIdx;
		if (this.runIdx >= this.runScroll + ROWS_VIEWPORT) this.runScroll = this.runIdx - ROWS_VIEWPORT + 1;
		if (this.runScroll < 0) this.runScroll = 0;
	}

	private keepCallVisible(): void {
		const len = this.currentRun()?.calls.length ?? 0;
		if (this.callIdx < this.callScroll) this.callScroll = this.callIdx;
		if (this.callIdx >= this.callScroll + ROWS_VIEWPORT) this.callScroll = this.callIdx - ROWS_VIEWPORT + 1;
		this.callScroll = Math.max(0, Math.min(this.callScroll, Math.max(0, len - 1)));
	}

	// ── rendering ──────────────────────────────────────────────────────────

	render(width: number): string[] {
		if (this.view === "runs") return this.renderRuns(width);
		if (this.view === "calls") return this.renderCalls(width);
		return this.renderDetail(width);
	}

	private renderRuns(width: number): string[] {
		const th = this.theme;
		const lines: string[] = [];
		lines.push(
			truncateToWidth(
				`${th.fg("accent", "工作流 · 会话运行")}${th.fg("dim", `  live ${this.data.live.length} / 历史 ${this.data.history.length} · 记录:${this.data.recording ? "开" : "关"}`)}`,
				width,
			),
		);
		lines.push(truncateToWidth(th.fg("border", "─".repeat(width)), width));

		let visible = 0;
		if (this.data.live.length > 0) visible += this.renderRunRows(lines, width, this.data.live, 0);
		if (this.data.history.length > 0) {
			if (visible < ROWS_VIEWPORT) {
				lines.push(truncateToWidth(th.fg("dim", `── 会话历史(重启前的摘要记录, 无请求详情) ──`), width));
				visible++;
			}
			if (visible < ROWS_VIEWPORT) visible += this.renderRunRows(lines, width, this.data.history, this.data.live.length);
		}
		if (this.runs.length === 0) {
			lines.push(truncateToWidth(th.fg("dim", "(暂无记录 — 发送一条消息后回到这里)"), width));
			visible++;
		}
		while (visible < 3) {
			lines.push("");
			visible++;
		}
		this.renderFooter(lines, width, "↑/↓ 选择 · Enter 查看本轮 · Esc/q 退出");
		return lines;
	}

	private renderRunRows(lines: string[], width: number, runs: WorkflowRun[], offsetIdx: number): number {
		const th = this.theme;
		let shown = 0;
		for (let i = 0; i < runs.length && shown < ROWS_VIEWPORT; i++) {
			const rowIdx = offsetIdx + i;
			if (rowIdx < this.runScroll) continue;
			if (rowIdx >= this.runScroll + ROWS_VIEWPORT) break;
			const run = runs[i]!;
			const selected = rowIdx === this.runIdx;
			const calls = run.calls.length;
			const tools = run.calls.reduce((n, c) => n + c.toolCalls.length, 0);
			const out = run.calls.reduce((n, c) => n + (c.response?.usage.output ?? 0), 0);
			const inTok = run.calls.reduce((n, c) => n + (c.response?.usage.input ?? 0), 0);
			const prompt = run.prompt.replace(/\s+/g, " ");
			const stats = `调用${calls} 工具${tools} ↑${formatTokens(inTok)} ↓${formatTokens(out)}`;
			const time = run.endTime ? formatClock(run.endTime) : "…";
			const prefix = `${selected ? th.fg("accent", "▶") : " "} ${th.fg("dim", time)} ${run.detail ? th.fg("text", prompt) : th.fg("dim", prompt)}`;
			const suffix = th.fg("muted", stats);
			const pad = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix) - 1);
			lines.push(truncateToWidth(`${prefix}${" ".repeat(pad)}${suffix}`, width));
			shown++;
		}
		return shown;
	}

	private renderCalls(width: number): string[] {
		const th = this.theme;
		const run = this.currentRun();
		const lines: string[] = [];
		lines.push(truncateToWidth(`${th.fg("accent", "模型调用")}${th.fg("dim", ` ${run?.prompt.slice(0, Math.max(0, width - 12)) ?? ""}`)}`, width));
		lines.push(truncateToWidth(th.fg("border", "─".repeat(width)), width));
		let shown = 0;
		if (run) {
			for (let i = this.callScroll; i < run.calls.length && shown < ROWS_VIEWPORT; i++, shown++) {
				const call = run.calls[i]!;
				const selected = i === this.callIdx;
				const err = call.response?.errorMessage;
				const usage = call.response?.usage;
				const status = err ? th.fg("error", "✗") : call.response ? th.fg("success", "✓") : th.fg("warning", "…");
				const marking = call.toolCalls.some((t) => t.isError) ? th.fg("error", "!") : "";
				const model = th.fg("text", call.response?.model ?? call.request?.model ?? "?");
				const prefix = `${selected ? th.fg("accent", "▶") : " "} ${th.fg("dim", `#${call.turnIndex}`)} ${status}${marking} ${model}`;
				const parts = [
					usage ? `↑${formatTokens(usage.input)} 缓存${formatTokens(usage.cacheRead)}` : "",
					usage ? `↓${formatTokens(usage.output)}` : "",
					call.toolCalls.length ? `工具${call.toolCalls.length}` : "",
					formatMs(call.response?.durationMs),
				].filter(Boolean);
				const suffix = th.fg("muted", parts.join(" · "));
				const pad = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix) - 1);
				lines.push(truncateToWidth(`${prefix}${" ".repeat(pad)}${suffix}`, width));
			}
			if (run.calls.length === 0) {
				lines.push(truncateToWidth(th.fg("dim", "(本轮没有模型调用)"), width));
				shown++;
			}
		}
		while (shown < 3) {
			lines.push("");
			shown++;
		}
		this.renderFooter(lines, width, "↑/↓ 选择 · Enter 查看详情 · ← 返回");
		return lines;
	}

	private renderDetail(width: number): string[] {
		const th = this.theme;
		const call = this.currentCall();
		const lines: string[] = [];
		if (!call) {
			this.renderFooter(lines, width, "← 返回");
			return lines;
		}
		const usage = call.response?.usage;
		const head1 = [
			`#${call.turnIndex}`,
			call.response?.model ?? call.request?.model ?? "?",
			usage ? `↑${formatTokens(usage.input)} (缓存读${formatTokens(usage.cacheRead)} 缓存写${formatTokens(usage.cacheWrite)})` : "",
			usage ? `↓${formatTokens(usage.output)}${usage.reasoning ? ` (含推理${formatTokens(usage.reasoning)})` : ""}` : "",
			call.response?.errorMessage ? th.fg("error", `错误: ${call.response.errorMessage}`) : th.fg("success", `stop=${call.response?.stopReason ?? "?"}`),
		]
			.filter(Boolean)
			.join(" · ");
		lines.push(truncateToWidth(head1, width));
		const req = call.request;
		const stats = [
			req?.truncated ? th.fg("warning", "payload 过大未保存原文") : req ? `payload ${formatTokens(req.bytes)} bytes` : "",
			req?.status !== undefined ? `HTTP ${req.status}` : "",
			call.response?.durationMs !== undefined ? formatMs(call.response.durationMs) : "",
			`system ${countOf(req?.system)} · 消息 ${req?.messages?.length ?? "–"} · 工具定义 ${req?.tools?.length ?? "–"}`,
		]
			.filter(Boolean)
			.join(" · ");
		lines.push(truncateToWidth(th.fg("dim", stats), width));
		lines.push(truncateToWidth(th.fg("border", "─".repeat(width)), width));

		const activeTab = TABS[this.tabIdx]!;
		const tabs = TABS.map((t, i) =>
			t === activeTab ? th.style(` ${TAB_LABEL[t]} `, { bg: "selectedBg", fg: "accent" }) : th.fg("dim", ` ${TAB_LABEL[t]} `),
		).join("");
		lines.push(truncateToWidth(tabs, width));

		const tree = this.tabTree(width);
		const body = tree ? tree.render(width - 2, TREE_VIEWPORT) : [th.fg("dim", "(无数据)")];
		for (const line of body) lines.push(truncateToWidth(`  ${line}`, width));
		while (body.length < TREE_VIEWPORT) {
			lines.push("");
			body.push("");
		}

		lines.push("");
		this.renderDetailFooter(lines, width);
		return lines;
	}

	private renderDetailFooter(lines: string[], width: number): void {
		const call = this.currentCall();
		const extra =
			TABS[this.tabIdx] === "toolcalls" && call
				? ` · 第 ${Math.min(this.toolIdx + 1, Math.max(1, call.toolCalls.length))}/${Math.max(1, call.toolCalls.length)} 个工具 (,/. 切换)`
				: "";
		this.renderFooter(
			lines,
			width,
			`1-6/[ ] 切换区 · ↑↓ 移动 · Enter 展开/折叠 · e 展开 · c 折叠${extra} · ← 返回`,
		);
	}

	private renderFooter(lines: string[], width: number, hint: string): void {
		lines.push(truncateToWidth(this.theme.fg("dim", hint), width));
	}

	// ── detail tab data ──────────────────────────────────────────────────

	private tabTree(width: number): JsonTree | undefined {
		const call = this.currentCall();
		if (!call) return undefined;
		const tab = TABS[this.tabIdx]!;
		let data: unknown;
		let note: string | undefined;
		if (tab === "system") {
			data = call.request?.system;
			note = data === undefined ? "本次请求没有 system 字段" : undefined;
		} else if (tab === "messages") {
			data = call.request?.messages;
			note = data === undefined ? "无请求详情(历史摘要记录)" : undefined;
		} else if (tab === "tools") {
			data = call.request?.tools;
			note = data === undefined ? "本次请求没有 tools 字段" : undefined;
		} else if (tab === "raw") {
			if (call.request?.truncated) {
				data = { 说明: `payload 约 ${call.request.bytes} bytes, 超过保留上限, 未保存原文`, 结构: extractCounts(call.request) };
			} else if (call.request) {
				data = { 说明: "pi 发给模型供应商的原始 wire payload(快照)", payload: call.request.raw };
				note = call.request.raw === undefined ? "原文不可用" : undefined;
			} else {
				data = { 说明: "无请求详情(历史摘要记录)" };
			}
		} else if (tab === "response") {
			const resp = call.response;
			if (!resp) {
				data = { 说明: "本次调用没有记录到模型响应" };
			} else {
				data = {
					model: resp.model,
					provider: resp.provider,
					api: resp.api,
					stopReason: resp.stopReason,
					errorMessage: resp.errorMessage,
					耗时: formatMs(resp.durationMs),
					usage: resp.usage,
					thinking块数: resp.thinkingCount,
					toolCall数: resp.toolCallBlocks.length,
					回复文本: resp.textPreview || "(空)",
				};
				note = undefined;
			}
		} else {
			const toolCalls = call.toolCalls;
			if (toolCalls.length === 0) {
				data = { 说明: "本次调用模型没有发起工具调用" };
			} else {
				const idx = Math.min(Math.max(this.toolIdx, 0), toolCalls.length - 1);
				const tc = toolCalls[idx]!;
				data = {
					index: `${idx + 1}/${toolCalls.length}`,
					toolCallId: tc.toolCallId,
					工具: tc.toolName,
					状态: tc.status,
					耗时: formatMs(tc.durationMs),
					isNested: tc.isNested ? `父调用 ${tc.parentToolCallId ?? "?"}` : false,
					参数: tc.args,
					结果预览: tc.preview,
					完整结果: tc.resultFull,
				};
				note = undefined;
			}
		}
		if (data === undefined) data = { 说明: note ?? "无数据" };
		const key = `${this.runIdx}:${this.callIdx}:${tab}:${tab === "toolcalls" ? this.toolIdx : 0}`;
		let tree = this.trees.get(key);
		if (!tree || this.treeKey !== key) {
			tree = new JsonTree(this.theme, data, width - 2);
			this.trees.set(key, tree);
			this.treeKey = key;
		}
		tree.setWidth(width - 2);
		return tree;
	}
}

function countOf(v: unknown): string {
	if (v === undefined) return "–";
	if (typeof v === "string") return `文本(${v.length})`;
	if (Array.isArray(v)) return String(v.length);
	if (v && typeof v === "object") return `对象(${Object.keys(v as Record<string, unknown>).length})`;
	return String(v);
}

function extractCounts(req: NonNullable<WorkflowCall["request"]>): Record<string, unknown> {
	return {
		system: req.system !== undefined ? describeShape(req.system) : undefined,
		messages: req.messages?.length,
		tools: req.tools?.length,
	};
}

function describeShape(v: unknown): string {
	if (typeof v === "string") return `string(${v.length})`;
	if (Array.isArray(v)) return `array(${v.length})`;
	return "object";
}
