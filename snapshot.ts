/**
 * pi-agent-workflow — provider payload snapshots.
 *
 * `before_provider_request` hands us the exact wire payload pi is about to
 * send. We snapshot it verbatim (逆向 fidelity: system / messages / tools in
 * the provider's own shape) and additionally extract the request sections the
 * way the DSH workflow plugin presents them.
 */

import type { ToolCallBlock } from "./model";
import { MAX_PAYLOAD_BYTES } from "./model";

interface PayloadSnapshot {
	raw?: unknown;
	text: string;
	bytes: number;
	truncated: boolean;
}

function clonePayload(payload: unknown): unknown {
	try {
		return structuredClone(payload);
	} catch {
		try {
			return JSON.parse(JSON.stringify(payload));
		} catch {
			return undefined;
		}
	}
}

/** Serialize once; reuse the string for size accounting. */
function serialize(payload: unknown): { text: string; ok: boolean } {
	try {
		return { text: JSON.stringify(payload), ok: true };
	} catch {
		return { text: "", ok: false };
	}
}

export function snapshotPayload(payload: unknown): PayloadSnapshot {
	const { text, ok } = serialize(payload);
	const bytes = ok ? Buffer.byteLength(text, "utf8") : 0;
	if (!ok || bytes > MAX_PAYLOAD_BYTES) {
		// Too large (or not serializable): keep only counts + truncated marker,
		// the extractor still records system/messages/tools structure.
		return {
			raw: ok ? undefined : undefined,
			text: "",
			bytes,
			truncated: true,
		};
	}
	return { raw: clonePayload(payload), text, bytes, truncated: false };
}

export interface ExtractedRequest {
	system?: unknown;
	messages?: unknown[];
	tools?: unknown[];
	model?: string;
}

/**
 * Provider-neutral extraction. Anthropic Messages carries `system` as a
 * top-level field; OpenAI-style APIs put the system message at messages[0].
 * Everything stays in its original wire shape for raw fidelity.
 */
export function extractRequest(payload: unknown): ExtractedRequest {
	const out: ExtractedRequest = {};
	if (!payload || typeof payload !== "object") return out;
	const p = payload as Record<string, unknown>;
	if (typeof p.model === "string") out.model = p.model;
	if (p.system !== undefined) out.system = p.system;
	if (Array.isArray(p.messages)) {
		let messages: unknown[] = p.messages;
		if (p.system === undefined && messages.length > 0) {
			const first = messages[0] as Record<string, unknown> | undefined;
			if (first && first.role === "system") {
				out.system = first;
				messages = messages.slice(1);
			}
		}
		out.messages = messages;
	}
	if (Array.isArray(p.tools)) out.tools = p.tools;
	return out;
}

/** Pull tool-call blocks out of an assistant message's content array. */
export function extractToolCallBlocks(content: unknown): ToolCallBlock[] {
	if (!Array.isArray(content)) return [];
	const blocks: ToolCallBlock[] = [];
	for (const item of content) {
		if (item && typeof item === "object" && (item as Record<string, unknown>).type === "toolCall") {
			const b = item as Record<string, unknown>;
			blocks.push({
				type: "toolCall",
				id: typeof b.id === "string" ? b.id : "",
				name: typeof b.name === "string" ? b.name : "?",
				arguments: b.arguments,
			});
		}
	}
	return blocks;
}

interface TextLikeContent {
	type: string;
	text?: string;
	thinking?: string;
}

/** Join text blocks; count thinking blocks; cap output. */
export function summarizeAssistantText(content: unknown, cap = 2000): { text: string; thinkingCount: number } {
	let text = "";
	let thinkingCount = 0;
	if (!Array.isArray(content)) return { text, thinkingCount };
	for (const item of content) {
		if (!item || typeof item !== "object") continue;
		const b = item as unknown as TextLikeContent;
		if (b.type === "text" && typeof b.text === "string") text += text ? "\n" + b.text : b.text;
		else if (b.type === "thinking") thinkingCount++;
	}
	if (text.length > cap) text = `${text.slice(0, cap)}…`;
	return { text, thinkingCount };
}

/** Serializable {content, details} snapshot of an AgentToolResult, images omitted. */
export function sanitizeToolResult(result: unknown, cap = 6000): unknown {
	if (!result || typeof result !== "object") return result;
	const r = result as Record<string, unknown>;
	const content = Array.isArray(r.content) ? r.content : undefined;
	const sanitizedContent = content?.map((item) => {
		if (!item || typeof item !== "object") return item;
		const b = item as unknown as TextLikeContent;
		if (b.type === "image") return { type: "image", data: "[image omitted]" };
		if (b.type === "text" && typeof b.text === "string") {
			return b.text.length > cap ? { type: "text", text: `${b.text.slice(0, cap)}…` } : b;
		}
		return b;
	});
	return { content: sanitizedContent ?? r.content, details: r.details };
}

/** Short one-line preview from a tool result's text content. */
export function previewToolResult(partial: unknown, cap = 600): string {
	let text = "";
	if (typeof partial === "string") {
		text = partial;
	} else if (partial && typeof partial === "object") {
		const r = partial as Record<string, unknown>;
		const content = Array.isArray(r.content) ? r.content : [];
		for (const item of content) {
			if (item && typeof item === "object" && (item as unknown as TextLikeContent).type === "text") {
				text += ((item as unknown as TextLikeContent).text ?? "") + " ";
			}
			if (text.length >= cap) break;
		}
	}
	text = text.replace(/\s+/g, " ").trim();
	if (text.length > cap) text = `${text.slice(0, cap)}…`;
	return text;
}
