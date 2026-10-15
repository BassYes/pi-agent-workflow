/**
 * pi-agent-workflow — domain model.
 *
 * Ported from the DSH Web UI plugin "dsh-plugin-agent-workflow":
 * a user turn (agent run) is the entry point; each model call inside it is
 * presented as a chain of request → response → tool calls, with token and
 * cache statistics.
 */

export interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments: unknown;
}

export type WorkflowToolStatus = "running" | "done" | "error";

export interface WorkflowToolCall {
	toolCallId: string;
	toolName: string;
	args: unknown;
	status: WorkflowToolStatus;
	durationMs?: number;
	/** Short text preview of the tool result. */
	preview?: string;
	isError: boolean;
	/** Set when another tool (codemode script etc.) initiated this call. */
	isNested: boolean;
	parentToolCallId?: string;
	/** Serializable {content, details} snapshot, images omitted. */
	resultFull?: unknown;
}

export interface WorkflowRequest {
	timestamp: number;
	/** Wire model id when the payload carries one. */
	model?: string;
	/** HTTP status observed before the stream starts, if any. */
	status?: number;
	/** Extracted `system` (string, blocks, or system message). */
	system?: unknown;
	/** Extracted conversation messages (wire shape). */
	messages?: unknown[];
	tools?: unknown[];
	/** Raw request payload (snapshot). Undefined when over the size cap. */
	raw?: unknown;
	/** Serialized size of the raw payload in bytes. */
	bytes: number;
	/** True when the raw payload was dropped because of the size cap. */
	truncated?: boolean;
}

export interface WorkflowResponse {
	provider: string;
	api: string;
	model: string;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		reasoning?: number;
	};
	stopReason: string;
	durationMs?: number;
	errorMessage?: string;
	/** First text blocks joined, capped for display. */
	textPreview: string;
	thinkingCount: number;
	/** Tool calls declared by this assistant message. */
	toolCallBlocks: ToolCallBlock[];
	message: unknown;
	timestamp: number;
}

export interface WorkflowCall {
	turnIndex: number;
	timestamp: number;
	request?: WorkflowRequest;
	response?: WorkflowResponse;
	toolCalls: WorkflowToolCall[];
	endTime?: number;
}

export interface WorkflowRun {
	id: string;
	/** User prompt (or custom message marker), capped. */
	prompt: string;
	source: "user" | "custom";
	timestamp: number;
	calls: WorkflowCall[];
	endTime?: number;
	/** True when full request/response details are available (live recording). */
	detail: boolean;
}

/** Data persisted via pi.appendEntry() after every turn. */
export interface PersistedCallSummary {
	v: 1;
	ts: number;
	turnIndex: number;
	runPrompt: string;
	source: "user" | "custom";
	model: string;
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		reasoning?: number;
	};
	durMs?: number;
	stopReason?: string;
	errorMessage?: string;
	tools: { name: string; isError: boolean; durationMs?: number }[];
	bytes?: number;
	assistantPreview: string;
}

export const MAX_RUNS = 100;
/** Raw provider payloads above this size are not kept (counts still are). */
export const MAX_PAYLOAD_BYTES = 2_000_000;
/** In-memory budget for retained raw payloads across all runs. */
export const MAX_TOTAL_BYTES = 128_000_000;

export function formatTokens(n: number): string {
	if (!Number.isFinite(n)) return "0";
	const abs = Math.abs(n);
	if (abs >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}M`;
	if (abs >= 1024) return `${(n / 1024).toFixed(abs < 10 * 1024 ? 1 : 0)}k`;
	return String(Math.round(n));
}

export function formatMs(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms)) return "–";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const s = ms / 1000;
	return s < 100 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function formatClock(ts: number): string {
	const d = new Date(ts);
	const p = (x: number) => String(x).padStart(2, "0");
	return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
