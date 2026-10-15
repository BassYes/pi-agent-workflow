/**
 * pi-agent-workflow — entry point.
 *
 * 移植自 DeepSeek Harness 插件 dsh-plugin-agent-workflow:在 pi 里以用户轮次
 * 为入口,把 Agent 真实发生的模型请求(system / messages / tools)、响应与工具
 * 调用呈现为可检查的执行链路,用于观察 / 逆向 Agent 行为。
 *
 * /workflow         打开查看器
 * /workflow on|off  开关本次会话的详细记录
 * /workflow status  查看记录状态
 * /workflow clear   清空本进程已记录的详细数据
 */

import { type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { Recorder } from "./recorder";
import { ENTRY_TYPE, groupHistoryFromEntries, renderSummaryLines } from "./summary";
import type { PersistedCallSummary } from "./model";
import { WorkflowViewer } from "./viewer";

const STATUS_KEY = "agent-workflow";

export default function (pi: ExtensionAPI) {
	const recorder = new Recorder();

	// ── recording ────────────────────────────────────────────────────────

	pi.on("before_agent_start", (event) => recorder.onBeforeAgentStart(event));
	pi.on("turn_start", (event) => recorder.onTurnStart(event));
	pi.on("before_provider_request", (event) => recorder.onBeforeProviderRequest(event));
	pi.on("after_provider_response", (event) => recorder.onAfterProviderResponse(event));
	pi.on("tool_execution_start", (event) => recorder.onToolExecutionStart(event));
	pi.on("tool_execution_update", (event) => recorder.onToolExecutionUpdate(event));
	pi.on("tool_execution_end", (event) => recorder.onToolExecutionEnd(event));
	pi.on("message_end", (event) => recorder.onMessageEnd(event));
	pi.on("turn_end", (event) => {
		const summary = recorder.onTurnEnd(event.turnIndex);
		if (recorder.enabled && summary) {
			pi.appendEntry<{ summary: PersistedCallSummary }>(ENTRY_TYPE, { summary });
		}
	});
	pi.on("agent_end", (event) => recorder.onAgentEnd(event));
	pi.on("session_shutdown", () => recorder.flushActiveRun());

	pi.on("session_start", (_event, ctx) => {
		if (recorder.enabled && ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, "wf ●");
	});

	// ── compact transcript summary rendering ─────────────────────────────

	pi.registerEntryRenderer<{ summary: PersistedCallSummary }>(ENTRY_TYPE, (entry, _options, theme) => {
		const summary = entry.data?.summary;
		if (!summary) return new Text(theme.fg("dim", "[workflow] 模型调用(摘要数据缺失)"), 0, 0);
		return renderSummaryEntry(summary, theme);
	});

	// ── /workflow command ────────────────────────────────────────────────

	pi.registerCommand("workflow", {
		description: "查看 Agent 工作流(模型请求/响应/工具调用链路)",
		handler: (args: string, ctx: ExtensionCommandContext) => handleCommand(args.trim().toLowerCase(), ctx, recorder),
	});
}

function setRecordingStatus(ctx: ExtensionCommandContext, recorder: Recorder): void {
	ctx.ui.setStatus(STATUS_KEY, recorder.enabled ? "wf ●" : undefined);
}

function renderSummaryEntry(summary: PersistedCallSummary, theme: Theme) {
	const lines = [`[workflow] #${summary.turnIndex} ${summary.model}`, ...renderSummaryLines(summary)];
	return new Text(lines.map((l) => theme.fg("dim", `  ${l}`)).join("\n"), 0, 0);
}

async function handleCommand(
	args: string,
	ctx: ExtensionCommandContext,
	recorder: Recorder,
): Promise<void> {
	const sub = args.split(/\s+/).filter(Boolean)[0];
	if (sub === "on" || sub === "off") {
		recorder.enabled = sub === "on";
		setRecordingStatus(ctx, recorder);
		ctx.ui.notify(`工作流详细记录${recorder.enabled ? "已开启" : "已关闭"}`, "info");
		return;
	}
	if (sub === "status") {
		ctx.ui.notify(
			`工作流记录:${recorder.enabled ? "开" : "关"} · 本进程已详细记录 ${recorder.runs.length} 轮`,
			"info",
		);
		return;
	}
	if (sub === "clear") {
		recorder.clear();
		ctx.ui.notify("已清空本进程的工作流详细记录(会话中的摘要条目保留)", "info");
		return;
	}
	if (sub === undefined || sub === "") {
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			ctx.ui.notify("/workflow 查看器仅在交互模式(TUI)可用", "warning");
			return;
		}
		await openViewer(ctx, recorder);
		return;
	}
	ctx.ui.notify("用法: /workflow [on|off|status|clear]", "warning");
}

async function openViewer(ctx: ExtensionCommandContext, recorder: Recorder): Promise<void> {
	const { runs: history } = groupHistoryFromEntries(ctx.sessionManager.getBranch(), recorder.runs.length + 1);
	await ctx.ui.custom<"close" | undefined>(
		(_tui, theme, _keybindings, done) =>
			new WorkflowViewer(
				theme,
				{
					live: [...recorder.runs],
					history,
					recording: recorder.enabled,
				},
				done,
			),
		{ overlay: true, overlayOptions: { anchor: "center", width: "92%", maxHeight: 34 } },
	);
}
