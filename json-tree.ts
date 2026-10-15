/**
 * pi-agent-workflow — collapsible JSON tree for the terminal.
 *
 * Renders JSON as rows; any object/array row can be collapsed or expanded.
 * Cursor-based interaction (up/down move the cursor, enter toggles), like the
 * expandable custom entries pi itself renders.
 */

import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export interface TreeRow {
	text: string;
	/** Collapse path of an expandable container row. */
	path?: string;
	expandable?: boolean;
	expanded?: boolean;
	depth: number;
}

const INLINE_STRING_LIMIT = 400;

type Kind = "key" | "string" | "number" | "bool" | "null" | "punct" | "plain" | "dim";

function style(theme: Theme, kind: Kind, s: string): string {
	if (!s) return "";
	switch (kind) {
		case "key":
			return theme.fg("syntaxString", s);
		case "string":
			return theme.fg("mdLinkUrl", s);
		case "number":
			return theme.fg("syntaxNumber", s);
		case "bool":
			return theme.fg("syntaxKeyword", s);
		case "null":
			return theme.fg("dim", s);
		case "punct":
			return theme.fg("syntaxPunctuation", s);
		case "dim":
			return theme.fg("dim", s);
		default:
			return theme.fg("text", s);
	}
}

const indent = (depth: number) => "  ".repeat(depth);

function summarize(value: unknown): string {
	if (Array.isArray(value)) return `Array(${value.length})`;
	if (value && typeof value === "object") {
		const keys = Object.keys(value as Record<string, unknown>);
		const head = keys.slice(0, 3).join(", ");
		return `Object(${keys.length}${keys.length ? `: ${head}${keys.length > 3 ? ", …" : ""}` : ""})`;
	}
	return String(value);
}

function scalarValue(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") {
		const shown = value.length > INLINE_STRING_LIMIT ? `${value.slice(0, INLINE_STRING_LIMIT)}…(+${value.length - INLINE_STRING_LIMIT} chars)` : value;
		return JSON.stringify(shown);
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === undefined) return "undefined";
	return String(value);
}

function scalarStyle(value: unknown): Kind {
	if (value === null) return "null";
	if (typeof value === "string") return "string";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "bool";
	return "plain";
}

interface BuildContext {
	theme: Theme;
	expanded: Set<string>;
	rows: TreeRow[];
	maxRows: number;
}

function childPath(parent: string, key: string): string {
	return `${parent}/${key}`;
}

function pushScalar(bc: BuildContext, depth: number, key: string | undefined, value: unknown): void {
	const label = key !== undefined ? `${style(bc.theme, "key", key)}${style(bc.theme, "punct", ": ")}` : "";
	bc.rows.push({ text: `${indent(depth)}${label}${style(bc.theme, scalarStyle(value), scalarValue(value))}`, depth });
}

function buildInto(bc: BuildContext, value: unknown, depth: number, path: string, key: string | undefined): void {
	if (bc.rows.length >= bc.maxRows) {
		if (bc.rows.length === bc.maxRows) {
			bc.rows.push({ text: style(bc.theme, "dim", `…(达到 ${bc.maxRows} 行渲染上限)`), depth: 0 });
		}
		return;
	}
	if (value === null || typeof value !== "object") {
		pushScalar(bc, depth, key, value);
		return;
	}

	const isArray = Array.isArray(value);
	const open = isArray ? "[" : "{";
	const close = isArray ? "]" : "}";
	const size = isArray ? value.length : Object.keys(value as Record<string, unknown>).length;
	const label = key !== undefined ? `${style(bc.theme, "key", key)} ` : "";
	const marker = (mark: string) => style(bc.theme, "punct", mark);

	if (!bc.expanded.has(path)) {
		// Collapsed container row.
		const collapse = `${indent(depth)}${label}${marker(`▸ ${open}…${close}`)} ${style(bc.theme, "dim", `// ${summarize(value)}, 回车展开`)}`.trimEnd();
		bc.rows.push({ text: collapse, path, expandable: true, expanded: false, depth });
		return;
	}

	// Expanded container: header row, children, closing row.
	if (isArray) {
		bc.rows.push({ text: `${indent(depth)}${label}${marker("[")}`, path, expandable: true, expanded: true, depth });
		const arr = value as unknown[];
		for (let i = 0; i < arr.length; i++) {
			buildInto(bc, arr[i], depth + 1, childPath(path, String(i)), String(i));
			if (bc.rows.length >= bc.maxRows) break;
		}
	} else {
		bc.rows.push({ text: `${indent(depth)}${label}${marker("{")}`, path, expandable: true, expanded: true, depth });
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			buildInto(bc, v, depth + 1, childPath(path, k), k);
			if (bc.rows.length >= bc.maxRows) break;
		}
	}
	if (bc.rows.length < bc.maxRows) {
		bc.rows.push({ text: `${indent(depth)}${marker(close)}`, depth });
	} else {
		bc.rows.push({ text: `${indent(depth)}${marker(open.length ? close : close)} ${style(bc.theme, "dim", "// 截断")}`, depth: 0 });
	}
}

/** Build tree rows from a value. Root container defaults to expanded. */
export function buildTreeRows(value: unknown, theme: Theme, expanded: Set<string>, maxRows = 2500): TreeRow[] {
	const bc: BuildContext = { theme, expanded, rows: [], maxRows };
	if (value === null || typeof value !== "object") {
		bc.rows.push({ text: style(theme, scalarStyle(value), scalarValue(value)), depth: 0 });
		return bc.rows;
	}
	const isArray = Array.isArray(value);
	const open = isArray ? "[" : "{";
	const close = isArray ? "]" : "}";
	// Root: collapsed when "" is in the expanded set, expanded otherwise.
	if (expanded.has("")) {
		bc.rows.push({
			text: `${style(theme, "punct", `▸ ${open}…${close}`)} ${style(theme, "dim", "// " + summarize(value) + ", 回车展开")}`.trimStart(),
			path: "",
			expandable: true,
			expanded: false,
			depth: 0,
		});
		return bc.rows;
	}
	bc.rows.push({ text: style(theme, "punct", open), path: "", expandable: true, expanded: true, depth: 0 });
	if (isArray) {
		const arr = value as unknown[];
		for (let i = 0; i < arr.length; i++) {
			buildInto(bc, arr[i], 1, childPath("", String(i)), String(i));
			if (bc.rows.length >= bc.maxRows) break;
		}
	} else {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			buildInto(bc, v, 1, childPath("", k), k);
			if (bc.rows.length >= bc.maxRows) break;
		}
	}
	bc.rows.push({ text: style(theme, "punct", close), depth: 0 });
	return bc.rows;
}

export class JsonTree {
	private expanded = new Set<string>();
	private rows: TreeRow[] = [];
	private cursor = 0;
	private scroll = 0;

	constructor(
		private readonly theme: Theme,
		private data: unknown,
		private width: number,
	) {
		this.rebuild();
	}

	setWidth(width: number): void {
		this.width = width;
	}

	setData(data: unknown): void {
		this.expanded.clear();
		this.cursor = 0;
		this.scroll = 0;
		this.data = data;
		this.rebuild();
	}

	private rebuild(): void {
		this.rows = buildTreeRows(this.data, this.theme, this.expanded);
		this.cursor = Math.min(this.cursor, Math.max(0, this.rows.length - 1));
	}

	private toggle(): void {
		const row = this.rows[this.cursor];
		if (!row?.expandable || row.path === undefined) return;
		if (this.expanded.has(row.path)) this.expanded.delete(row.path);
		else this.expanded.add(row.path);
		this.rebuild();
	}

	private ensureVisible(viewportHeight: number): void {
		const height = Math.max(1, viewportHeight);
		if (this.cursor < this.scroll) this.scroll = this.cursor;
		if (this.cursor >= this.scroll + height) this.scroll = this.cursor - height + 1;
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.rows.length - height)));
	}

	handleInput(data: string, viewportHeight: number): void {
		const rows = this.rows.length;
		const page = Math.max(1, viewportHeight - 2);
		if (matchesKey(data, "return") || data === " ") {
			this.toggle();
		} else if (matchesKey(data, "up") || data === "k") {
			this.cursor = Math.max(0, this.cursor - 1);
		} else if (matchesKey(data, "down") || data === "j") {
			this.cursor = Math.min(rows - 1, this.cursor + 1);
		} else if (matchesKey(data, "pageUp")) {
			this.cursor = Math.max(0, this.cursor - page);
		} else if (matchesKey(data, "pageDown")) {
			this.cursor = Math.min(rows - 1, this.cursor + page);
		} else if (data === "\x1b[H" || data === "g") {
			this.cursor = 0;
		} else if (data === "\x1b[F" || data === "G") {
			this.cursor = Math.max(0, rows - 1);
		} else if (data === "e") {
			for (const row of this.rows) if (row.expandable && row.path !== undefined) this.expanded.add(row.path);
			this.rebuild();
		} else if (data === "c") {
			this.expanded.clear();
			this.rebuild();
		}
		this.ensureVisible(viewportHeight);
	}

	get rowCount(): number {
		return this.rows.length;
	}

	render(width: number, viewportHeight: number): string[] {
		this.ensureVisible(viewportHeight);
		const lines: string[] = [];
		const max = Math.min(this.rows.length, this.scroll + viewportHeight);
		for (let i = this.scroll; i < max; i++) {
			const row = this.rows[i]!;
			const isCursor = i === this.cursor;
			if (isCursor) {
				lines.push(truncateToWidth(this.theme.style(`▶ ${row.text}`, { bg: "selectedBg" }), width));
			} else {
				lines.push(truncateToWidth(`  ${row.text}`, width));
			}
		}
		return lines;
	}
}
