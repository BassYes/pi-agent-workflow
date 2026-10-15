/**
 * pi-agent-workflow — persisted summaries and history reconstruction.
 *
 * Every turn appends one compact custom entry (ENTRY_TYPE) to the session,
 * so /workflow can still show a token/statistical history after a restart —
 * without storing the (potentially huge) provider payloads. Payload-level
 * detail only exists for runs recorded live in the current process.
 */

import type { CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PersistedCallSummary, WorkflowCall, WorkflowRun } from "./model";

export const ENTRY_TYPE = "agent-workflow-call";

export function buildCallSummary(summary: PersistedCallSummary): string {
	const usage = summary.usage;
	const tokens = usage
		? `in=${usage.input} out=${usage.output} cacheR=${usage.cacheRead} cacheW=${usage.cacheWrite}`
		: "no usage";
	const tools = summary.tools.length
		? summary.tools.map((t) => `${t.name}${t.isError ? "!" : ""}`).join(", ")
		: "none";
	return `#${summary.turnIndex} ${summary.model} ${tokens} tools: ${tools} stop=${summary.stopReason ?? "?"}`;
}

export function renderSummaryLines(summary: PersistedCallSummary): string[] {
	const usage = summary.usage;
	const lines = [
		`${summary.model} · ${usage ? `↑${usage.input} ↓${usage.output} 缓存读${usage.cacheRead} 缓存写${usage.cacheWrite}` : "无用量"}`,
		`stop=${summary.stopReason ?? "?"}${summary.durMs ? ` · ${Math.round(summary.durMs / 100) / 10}s` : ""} · 工具 ${summary.tools.length} 个`,
	];
	if (summary.errorMessage) lines.push(`错误: ${summary.errorMessage}`);
	if (summary.assistantPreview) lines.push(summary.assistantPreview);
	return lines;
}

export function isCallSummaryEntry(entry: SessionEntry): entry is CustomEntry {
	return entry.type === "custom" && entry.customType === ENTRY_TYPE;
}

function callFromSummary(summary: PersistedCallSummary): WorkflowCall {
	const call: WorkflowCall = {
		turnIndex: summary.turnIndex,
		timestamp: summary.ts,
		toolCalls: [],
	};
	if (summary.usage) {
		call.response = {
			provider: "?",
			api: "?",
			model: summary.model,
			usage: {
				input: summary.usage.input,
				output: summary.usage.output,
				cacheRead: summary.usage.cacheRead,
				cacheWrite: summary.usage.cacheWrite,
				reasoning: summary.usage.reasoning,
			},
			stopReason: summary.stopReason ?? "?",
			errorMessage: summary.errorMessage,
			textPreview: summary.assistantPreview,
			thinkingCount: 0,
			toolCallBlocks: [],
			message: undefined,
			timestamp: summary.ts,
		};
	}
	return call;
}

/**
 * Rebuild past runs from the current session branch. Runs are grouped by
 * turnIndex continuity: when the index stops incrementing (reset to 0, or a
 * gap), a new run starts.
 */
export function groupHistoryFromEntries(entries: SessionEntry[], nextRunId: number): { runs: WorkflowRun[]; nextId: number } {
	const runs: WorkflowRun[] = [];
	let current: WorkflowRun | undefined;
	let prevIndex = -1;
	let id = nextRunId;

	for (const entry of entries) {
		if (!isCallSummaryEntry(entry)) continue;
		const summary = entry.data as PersistedCallSummary;
		if (!summary || typeof summary !== "object" || typeof summary.turnIndex !== "number") continue;
		if (!current || summary.turnIndex !== prevIndex + 1) {
			current = {
				id: `h${id++}`,
				prompt: summary.runPrompt || "(未知)",
				source: summary.source === "user" ? "user" : "custom",
				timestamp: summary.ts,
				calls: [],
				detail: false,
			};
			prevIndex = -1;
			runs.push(current);
		}
		current.calls.push(callFromSummary(summary));
		prevIndex = summary.turnIndex;
	}

	return { runs, nextId: id };
}
