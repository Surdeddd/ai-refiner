import { describe, expect, it } from "vitest";
import {
	extractNamedValues,
	extractTextContent,
	inferOpenAiModelsUrl,
	isPrivateHost,
	isRecord,
	normalizeHostname,
	parseJson,
	removeTrailingSlash,
	unique,
} from "../src/utils/api";

describe("isPrivateHost", () => {
	it("treats loopback and RFC1918 space as private", () => {
		for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.4.4", "::1"]) {
			expect(isPrivateHost(host)).toBe(true);
		}
	});

	it("treats private suffixes and ULA/link-local IPv6 as private", () => {
		expect(isPrivateHost("nas.local")).toBe(true);
		expect(isPrivateHost("box.home.arpa")).toBe(true);
		expect(isPrivateHost("fd00::1")).toBe(true);
		expect(isPrivateHost("fe80::1")).toBe(true);
	});

	it("treats public hosts as not private", () => {
		for (const host of ["api.openai.com", "example.com", "8.8.8.8", "172.32.0.1"]) {
			expect(isPrivateHost(host)).toBe(false);
		}
	});

	it("strips IPv6 brackets before classifying", () => {
		expect(isPrivateHost("[::1]")).toBe(true);
	});
});

describe("unique", () => {
	it("dedupes by trimmed value and drops blanks", () => {
		expect(unique([" a ", "a", "", "b", "  "])).toEqual(["a", "b"]);
	});
});

describe("removeTrailingSlash", () => {
	it("removes trailing slashes but keeps root", () => {
		expect(removeTrailingSlash("/v1/models/")).toBe("/v1/models");
		expect(removeTrailingSlash("/")).toBe("/");
		expect(removeTrailingSlash("///")).toBe("/");
	});
});

describe("normalizeHostname", () => {
	it("lowercases and unwraps IPv6 brackets", () => {
		expect(normalizeHostname("  API.Example.COM ")).toBe("api.example.com");
		expect(normalizeHostname("[::1]")).toBe("::1");
	});
});

describe("parseJson", () => {
	it("parses valid JSON and returns null for invalid/empty", () => {
		expect(parseJson('{"a":1}')).toEqual({ a: 1 });
		expect(parseJson("not json")).toBeNull();
		expect(parseJson("   ")).toBeNull();
	});
});

describe("isRecord", () => {
	it("accepts any non-null object (arrays included) and rejects primitives", () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord([])).toBe(true);
		expect(isRecord(null)).toBe(false);
		expect(isRecord("x")).toBe(false);
		expect(isRecord(5)).toBe(false);
		expect(isRecord(undefined)).toBe(false);
	});
});

describe("extractTextContent", () => {
	it("handles string, array-of-parts, and object content", () => {
		expect(extractTextContent("  hello ")).toBe("hello");
		expect(extractTextContent([{ text: "a" }, { text: "b" }])).toBe("ab");
		expect(extractTextContent({ text: " c " })).toBe("c");
		expect(extractTextContent("   ")).toBeNull();
		expect(extractTextContent(42)).toBeNull();
	});
});

describe("extractNamedValues", () => {
	it("pulls a named field out of a container array", () => {
		const payload = { data: [{ id: "gpt-4o" }, { id: "" }, { id: "gpt-4o-mini" }] };
		expect(extractNamedValues(payload, "data", "id")).toEqual(["gpt-4o", "gpt-4o-mini"]);
	});

	it("returns empty when container missing or not an array", () => {
		expect(extractNamedValues({}, "data", "id")).toEqual([]);
		expect(extractNamedValues({ data: 5 }, "data", "id")).toEqual([]);
	});
});

describe("inferOpenAiModelsUrl", () => {
	const cases: Array<[string, string]> = [
		["https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/models"],
		["https://host/v1/responses", "https://host/v1/models"],
		["https://host/v1/completions", "https://host/v1/models"],
		["https://host/v1/messages", "https://host/v1/models"],
		["https://host/v1/models", "https://host/v1/models"],
		["https://host/v1/models/", "https://host/v1/models"],
		["https://host/v1/models/gpt-4o", "https://host/v1/models"],
		["https://host/custom", "https://host/custom/models"],
	];

	it.each(cases)("derives the models URL from %s", (input, expected) => {
		expect(inferOpenAiModelsUrl(new URL(input)).toString()).toBe(expected);
	});

	it("preserves the query string", () => {
		expect(inferOpenAiModelsUrl(new URL("https://host/v1/chat/completions?a=1")).toString())
			.toBe("https://host/v1/models?a=1");
	});
});
