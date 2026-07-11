export interface DiffSegment {
	type: "equal" | "removed" | "added";
	text: string;
}

const DEFAULT_MAX_TOKENS = 1500;

// Word-level diff for the result preview: LCS over word/whitespace tokens, adjacent
// same-type tokens merged. Returns null above the token budget — the DP table is
// O(n*m) and a giant selection should render as plain text instead of freezing the UI.
export function diffWords(
	before: string,
	after: string,
	maxTokens = DEFAULT_MAX_TOKENS,
): DiffSegment[] | null {
	const beforeTokens = tokenize(before);
	const afterTokens = tokenize(after);
	if (beforeTokens.length > maxTokens || afterTokens.length > maxTokens) {
		return null;
	}

	if (before === after) {
		return before.length > 0 ? [{ type: "equal", text: before }] : [];
	}

	const n = beforeTokens.length;
	const m = afterTokens.length;
	// lcs[i][j] = LCS length of beforeTokens[i..] and afterTokens[j..]
	const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i -= 1) {
		const row = lcs[i];
		const nextRow = lcs[i + 1];
		if (!row || !nextRow) {
			continue;
		}
		for (let j = m - 1; j >= 0; j -= 1) {
			row[j] = beforeTokens[i] === afterTokens[j]
				? (nextRow[j + 1] ?? 0) + 1
				: Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
		}
	}

	const segments: DiffSegment[] = [];
	const push = (type: DiffSegment["type"], text: string): void => {
		if (!text) {
			return;
		}
		const last = segments[segments.length - 1];
		if (last && last.type === type) {
			last.text += text;
		} else {
			segments.push({ type, text });
		}
	};

	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (beforeTokens[i] === afterTokens[j]) {
			push("equal", beforeTokens[i] ?? "");
			i += 1;
			j += 1;
		} else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
			push("removed", beforeTokens[i] ?? "");
			i += 1;
		} else {
			push("added", afterTokens[j] ?? "");
			j += 1;
		}
	}
	while (i < n) {
		push("removed", beforeTokens[i] ?? "");
		i += 1;
	}
	while (j < m) {
		push("added", afterTokens[j] ?? "");
		j += 1;
	}

	return segments;
}

// Words and whitespace runs are separate tokens so reflowed spacing stays "equal"
// and only real word changes light up in the preview.
function tokenize(text: string): string[] {
	return text.split(/(\s+)/).filter((token) => token.length > 0);
}
