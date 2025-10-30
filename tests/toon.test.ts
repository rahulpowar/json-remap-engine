import { describe, expect, it } from "vitest";

import { createReplaceRule, encodeToToon, defaultToonOptions, type Rule, runTransformer, OutputEncoding } from "../src";

describe("TOON encoding", () => {
  it("encodes simple objects with defaults (tab delimiter, # length)", () => {
    const value = { title: "Hello", tags: ["a", "b", "c"], count: 3 };
    const toon = encodeToToon(value);

    // Basic shape assertions – format is handled by @byjohann/toon, we just ensure
    // defaults and salient tokens appear in the output.
    expect(toon).toContain("title:");
    expect(toon).toContain("tags[");
    expect(toon).toContain("#"); // length marker
    // tab-delimited arrays should include a tab character between entries
    expect(toon).toContain("a\tb");
  });

  it("runs transformer and emits TOON when requested", () => {
    const source = { status: "draft", items: [1, 2] };
    const rules: Rule[] = [
      createReplaceRule("$.status", "published", { id: "publish" }),
    ];

    const result = runTransformer(source, rules, { encoding: OutputEncoding.Toon });
    expect(result.document).toEqual({ status: "published", items: [1, 2] });
    expect(typeof result.output).toBe("string");
    expect(result.output).toContain("published");
  });

  it("allows overriding TOON options", () => {
    const source = { list: ["x", "y"] };
    const custom = { ...defaultToonOptions, delimiter: "|" as const };
    const text = encodeToToon(source, custom);
    // Ensure custom delimiter is used
    expect(text).toContain("x|y");
  });

  it("parameterizes encoding via runTransformer (json-pretty default, compact and TOON options)", () => {
    const obj = { a: 1, arr: [1, 2] };
    const rules: Rule[] = [];

    const pretty = runTransformer(obj, rules, { encoding: OutputEncoding.JsonPretty });
    expect(pretty.output).toContain("\n");

    const compact = runTransformer(obj, rules, { encoding: OutputEncoding.JsonCompact });
    expect(compact.output).toBe(JSON.stringify(obj));

    const toon = runTransformer(obj, rules, { encoding: OutputEncoding.Toon });
    expect(toon.output).toContain("arr[");
  });
});
