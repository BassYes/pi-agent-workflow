/**
 * pi-agent-workflow — recorder.
 *
 * Builds the in-memory run/call model from pi lifecycle events. Each agent run
 * (one user prompt) becomes a WorkflowRun; each turn inside it (one model
 * request/response round) becomes a WorkflowCall.
 */

import type {
	AfterProviderResponseEvent,
	AgentEndEvent,
	BeforeAgentStartEvent,
	BeforeProviderRequestEvent,
	MessageEndEvent,
	TurnStartEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import {
	MAX_RUNS,
	MAX_TOTAL_BYTES,
	type PersistedCallSummary,
	type WorkflowCall,
	type WorkflowResponse,
	type WorkflowToolStatus,
} from "./model";
import type { ToolCallBlock, WorkflowRun } from "./model";
import {
	extractRequest,
	extractToolCallBlocks,
	previewToolResult,
	sanitizeToolResult,
	snapshotPayload,
	summarizeAssistantText,
} from "./snapshot";

const MAX_TOOL_PREVIEW = 4000;
const MAX_PROMPT = 2000;

export class Recorder {
	enabled = true;
	runs: WorkflowRun[] = [];
	private activeRun: WorkflowRun | undefined;
	private activeCall: WorkflowCall | undefined;
	private nextRunId = 1;

	onBeforeAgentStart(event: BeforeAgentStartEvent): void {
		if (!this.enabled) return;
		this.activeRun = {
			id: `r${this.nextRunId++}`,
			prompt: event.messageType === "user" ? event.prompt.slice(0, MAX_PROMPT) : "(自定义消息)",
			source: event.messageType,
			timestamp: Date.now(),
			calls: [],
			detail: true,
		};
	}

	onTurnStart(event: TurnStartEvent): void {
		if (!this.enabled && !this.activeRun) return;
		if (!this.activeRun) {
			this.activeRun = {
				id: `r${this.nextRunId++}`,
				prompt: "(续跑)",
				source: "custom",
				timestamp: event.timestamp,
				calls: [],
				detail: true,
			};
		}
		this.activeCall = {
			turnIndex: event.turnIndex,
			timestamp: event.timestamp,
			toolCalls: [],
		};
		this.activeRun.calls[event.turnIndex] = this.activeCall;
	}

	onBeforeProviderRequest(event: BeforeProviderRequestEvent): void {
		const call = this.activeCall;
		if (!call) return;
		const snap = snapshotPayload(event.payload);
		const extracted = extractRequest(event.payload);
		call.request = {
			timestamp: Date.now(),
			model: extracted.model,
			system: extracted.system,
			messages: extracted.messages,
			tools: extracted.tools,
			raw: snap.raw,
			bytes: snap.bytes,
			truncated: snap.truncated,
		};
	}

	onAfterProviderResponse(event: AfterProviderResponseEvent): void {
		if (this.activeCall?.request) this.activeCall.request.status = event.status;
	}

	onToolExecutionStart(event: ToolExecutionStartEvent): void {
		if (!this.activeCall) return;
		const existing = this.activeCall.toolCalls.find((tc) => tc.toolCallId === event.toolCallId);
		if (existing) {
			existing.status = "running";
			existing.args = event.args;
			return;
		}
		this.activeCall.toolCalls.push({
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			status: "running",
			isError: false,
			isNested: typeof event.parentToolCallId === "string",
			parentToolCallId: event.parentToolCallId,
		});
	}

	onToolExecutionUpdate(_event: ToolExecutionUpdateEvent): void {
		// Streaming partial results are intentionally not snapshotted; the
		// final result from tool_execution_end is what we keep.
	}

	onToolExecutionEnd(event: ToolExecutionEndEvent): void {
		const call = this.activeCall;
		if (!call) return;
		const tc = call.toolCalls.find((t) => t.toolCallId === event.toolCallId);
		const status: WorkflowToolStatus = event.isError ? "error" : "done";
		if (tc) {
			tc.status = status;
			tc.isError = event.isError;
			tc.durationMs = event.durationMs;
			tc.preview = previewToolResult(event.result, MAX_TOOL_PREVIEW);
			tc.resultFull = sanitizeToolResult(event.result);
			return;
		}
		call.toolCalls.push({
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: undefined,
			status,
			isError: event.isError,
			isNested: typeof event.parentToolCallId === "string",
			parentToolCallId: event.parentToolCallId,
			durationMs: event.durationMs,
			preview: previewToolResult(event.result, MAX_TOOL_PREVIEW),
			resultFull: sanitizeToolResult(event.result),
		});
	}

	onMessageEnd(event: MessageEndEvent): void {
		const message = event.message;
		if (message.role !== "assistant") return;
		const call = this.activeCall;
		if (!call) return;
		const content = Array.isArray(message.content) ? [...message.content] : [];
		const toolBlocks: ToolCallBlock[] = extractToolCallBlocks(content);
		const { text, thinkingCount } = summarizeAssistantText(content);
		const usage = message.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		call.response = {
			provider: message.provider,
			api: message.api,
			model: message.model,
			usage: {
				input: usage.input,
				output: usage.output,
				cacheRead: usage.cacheRead,
				cacheWrite: usage.cacheWrite,
				reasoning: usage.reasoning,
			},
			stopReason: message.stopReason,
			durationMs: message.durationMs,
			errorMessage: message.errorMessage,
			textPreview: text,
			thinkingCount,
			toolCallBlocks: toolBlocks,
			message: { ...message, content },
			timestamp: message.timestamp,
		};
	}

	onTurnEnd(turnIndex: number): PersistedCallSummary | undefined {
		const call = this.activeCall;
		const run = this.activeRun;
		if (this.activeCall) this.activeCall.endTime = Date.now();
		this.activeCall = undefined;
		if (!run || !call) return undefined;
		return {
			v: 1,
			ts: call.timestamp,
			turnIndex,
			runPrompt: run.prompt.slice(0, 120),
			source: run.source,
			model: call.response?.model ?? call.request?.model ?? "?",
			usage: call.response
				? {
						input: call.response.usage.input,
						output: call.response.usage.output,
						cacheRead: call.response.usage.cacheRead,
						cacheWrite: call.response.usage.cacheWrite,
						reasoning: call.response.usage.reasoning,
					}
				: undefined,
			durMs: call.response?.durationMs,
			stopReason: call.response?.stopReason,
			errorMessage: call.response?.errorMessage,
			tools: call.toolCalls.map((tc) => ({ name: tc.toolName, isError: tc.isError, durationMs: tc.durationMs })),
			bytes: call.request?.bytes,
			assistantPreview: call.response?.textPreview.slice(0, 200) ?? "",
		};
	}

	onAgentEnd(_event: AgentEndEvent): void {
		if (this.activeRun) {
			this.activeRun.endTime = Date.now();
			this.runs.push(this.activeRun);
			// Evict oldest runs once the raw-payload budget is exceeded.
			while (this.runs.length > 1 && this.totalBytes() > MAX_TOTAL_BYTES) this.runs.shift();
			if (this.runs.length > MAX_RUNS) this.runs.shift();
			this.activeRun = undefined;
		}
		this.activeCall = undefined;
	}

	private totalBytes(): number {
		let total = 0;
		for (const run of this.runs) {
			for (const call of run.calls) total += call.request?.bytes ?? 0;
		}
		return total;
	}

	/** Persist an active run interrupted by shutdown/reload. */
	flushActiveRun(): void {
		this.onAgentEnd({ type: "agent_end", messages: [] });
	}

	clear(): void {
		this.runs = [];
		this.activeRun = undefined;
		this.activeCall = undefined;
	}
}
