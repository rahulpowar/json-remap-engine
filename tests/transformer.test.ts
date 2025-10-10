import { describe, expect, it } from "vitest";

import {
  createMoveRule,
  createRemoveRule,
  createRenameRule,
  createReplaceRule,
  formatPatch,
  runTransformer,
  type Rule,
} from "../src";

describe("runTransformer", () => {
  it("removes array items in descending order per parent", () => {
    const source = { arr: ["a", "b", "c", "d"] };
    const rules: Rule[] = [
      createRemoveRule("$.arr[1,3]", { id: "r1" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.diagnostics[0].operations.map((operation) => operation.summary.path)).toEqual([
      "/arr/3",
      "/arr/1",
    ]);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual({ arr: ["a", "c"] });
    expect(result.operations).toEqual([
      { op: "remove", path: "/arr/3" },
      { op: "remove", path: "/arr/1" },
    ]);
  });

  it("supports replace with literal value", () => {
    const source = { name: "Alice", status: "draft" };
    const rules: Rule[] = [
      createReplaceRule("$.status", "published", { id: "replace-status" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.document).toEqual({ name: "Alice", status: "published" });
    expect(result.operations).toEqual([
      { op: "replace", path: "/status", value: "published" },
    ]);
  });

  it("allows literal strings that start with $ when valueMode=literal", () => {
    const source = { currency: "" };
    const rules: Rule[] = [
      createReplaceRule("$.currency", "$100", { id: "currency", valueMode: "literal" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual({ currency: "$100" });
  });

  it("supports replace using JSONPath value", () => {
    const source = { profile: { first: "Ada", last: "Lovelace" }, nickname: "" };
    const rules: Rule[] = [
      createReplaceRule("$.nickname", "$.profile.first", { id: "copy-name" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.document).toEqual({ profile: { first: "Ada", last: "Lovelace" }, nickname: "Ada" });
    expect(result.operations).toEqual([
      { op: "replace", path: "/nickname", value: "Ada" },
    ]);
  });

  it("moves values to a JSONPointer target", () => {
    const source = { draft: { body: "hello" }, published: {} };
    const rules: Rule[] = [
      createMoveRule("$.draft.body", "/published/body", { id: "move-body" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.document).toEqual({ draft: {}, published: { body: "hello" } });
    expect(result.operations).toEqual([
      { op: "move", from: "/draft/body", path: "/published/body" },
    ]);
  });

  it("renames object keys with literal targets", () => {
    const source = {
      summary: {
        services: [
          { service: { id: "a1" }, metadata: { alias: "service_now" } },
        ],
      },
    };
    const rules: Rule[] = [
      createRenameRule("$.summary.services[*].service", "service_now", { id: "rename-service" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual({
      summary: {
        services: [
          { service_now: { id: "a1" }, metadata: { alias: "service_now" } },
        ],
      },
    });
    expect(result.operations).toEqual([
      { op: "move", from: "/summary/services/0/service", path: "/summary/services/0/service_now" },
    ]);
  });

  it("derives rename targets via relative JSONPath", () => {
    const source = {
      summary: {
        services: [
          { service: { id: "a1" }, metadata: { safeName: "svc_a1" } },
        ],
      },
    };
    const rules: Rule[] = [
      createRenameRule("$.summary.services[*].service", "$.metadata.safeName", {
        id: "rename-dynamic",
        targetMode: "jsonpath",
      }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual({
      summary: {
        services: [
          { svc_a1: { id: "a1" }, metadata: { safeName: "svc_a1" } },
        ],
      },
    });
    expect(result.operations).toEqual([
      { op: "move", from: "/summary/services/0/service", path: "/summary/services/0/svc_a1" },
    ]);
  });

  it("prevents rename when the new key already exists", () => {
    const source = {
      summary: {
        services: [
          { service: { id: "a1" }, service_now: { id: "legacy" } },
        ],
      },
    };
    const rules: Rule[] = [
      createRenameRule("$.summary.services[*].service", "service_now", { id: "rename-clash" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("rename target error"))).toBe(true);
    expect(result.operations).toEqual([]);
    expect(result.document).toEqual(source);
  });

  it("forces JSONPath evaluation when targetMode=jsonpath", () => {
    const source = { drafts: [{ body: "hello" }], published: [{}] };
    const rules: Rule[] = [
      createMoveRule("$.drafts[0].body", "$.published[0].body", {
        id: "move-first",
        targetMode: "jsonpath",
      }),
    ];

    const result = runTransformer(source, rules);
    expect(result.errors).toEqual([]);
    expect(result.document).toEqual({ drafts: [{}], published: [{ body: "hello" }] });
    expect(result.operations).toEqual([
      { op: "move", from: "/drafts/0/body", path: "/published/0/body" },
    ]);
  });

  it("skips move when target JSONPath is empty and allowEmptyValue is true", () => {
    const source = { draft: { body: "hello" } };
    const rules: Rule[] = [
      createMoveRule("$.draft.body", "$.published[0].body", {
        id: "move-optional-target",
        allowEmptyValue: true,
      }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.document).toEqual({ draft: { body: "hello" } });
  });

  it("captures errors when JSONPath value resolves ambiguously", () => {
    const source = { a: 1, b: 2 };
    const rules: Rule[] = [
      createReplaceRule("$.a", "$. *".replace(" ", ""), { id: "replace-with-multi" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("Expected exactly one value"))).toBe(true);
    expect(result.document).toEqual(source);
    expect(result.operations).toEqual([]);
  });

  it("allows empty matcher when flagged", () => {
    const source = { foo: 1 };
    const rules: Rule[] = [
      createRemoveRule("", { id: "r-empty", allowEmptyMatcher: true }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.document).toEqual(source);
    expect(result.warnings).toEqual([]);
  });

  it("skips disabled rules without mutating the document", () => {
    const source = { keep: true };
    const rules: Rule[] = [
      createRemoveRule("$.keep", { id: "r-disabled", disabled: true }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.operations).toEqual([]);
    expect(result.document).toEqual(source);
    expect(result.errors).toEqual([]);
  });

  it("suggests guarding optional segments when JSONPath access fails", () => {
    const source = {
      problematic_tests: [
        { inspection: { meta: { status: "OK" } } },
        { inspection: {} },
      ],
    };
    const rules: Rule[] = [
      createRemoveRule("$.problematic_tests[?(@.inspection.meta.status == 'OK')].inspection", { id: "r-jsonpath" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(false);
    expect(result.operations).toEqual([]);
    expect(result.errors[0]).toContain("Ensure optional segments exist");
  });

  it("skips empty matcher by default without warning", () => {
    const source = { foo: 1 };
    const rules: Rule[] = [
      createRemoveRule(" ", { id: "r-empty-default" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.document).toEqual(source);
    expect(result.warnings).toEqual([]);
  });

  it("allows empty replace value when flagged", () => {
    const source = { foo: "bar" };
    const rules: Rule[] = [
      createReplaceRule("$.foo", undefined, {
        id: "r-empty-value",
        allowEmptyValue: true,
      }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.document).toEqual(source);
  });

  it("skips replace when JSONPath value is missing and allowEmptyValue is true", () => {
    const source = { summary: {} };
    const rules: Rule[] = [
      createReplaceRule("$.summary", "$.summary.hos", {
        id: "r-empty-jsonpath",
        allowEmptyValue: true,
        allowEmptyMatcher: true,
      }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.document).toEqual(source);
  });

  it("warns when matcher yields no results unless allowed", () => {
    const source = { foo: 1 };
    const rules: Rule[] = [
      createRemoveRule("$.missing", { id: "r-empty-results" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((message) => message.includes("No matches"))).toBe(true);
  });

  it("suppresses warning when matcher yields no results and allowEmptyMatcher is true", () => {
    const source = { foo: 1 };
    const rules: Rule[] = [
      createRemoveRule("$.missing", { id: "r-empty-results-allowed", allowEmptyMatcher: true }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.operations).toEqual([]);
  });

  it("formats patches", () => {
    const operations = [
      { op: "remove", path: "/items/0" } as const,
      { op: "replace", path: "/items/1", value: 123 } as const,
    ];
    expect(formatPatch(operations, false)).toBe("[{\"op\":\"remove\",\"path\":\"/items/0\"},{\"op\":\"replace\",\"path\":\"/items/1\",\"value\":123}]");
    expect(formatPatch(operations, true)).toContain("\n");
  });

  it("supports matcher errors", () => {
    const source = { items: [{}] };
    const rules: Rule[] = [
      createRemoveRule("$.items[?(@.missing.meta.status == 'ok')]", { id: "bad" }),
    ];
    const result = runTransformer(source, rules);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("matcher error"))).toBe(true);
  });

  it("reports move errors when target cannot be resolved", () => {
    const source = { foo: "bar" };
    const rules: Rule[] = [
      createMoveRule("$.foo", "$.missing[0]", { id: "bad-move" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("Move /foo failed"))).toBe(true);
  });

  it("rejects move targets that would mutate object prototypes", () => {
    const source = { data: "value" };
    const rules: Rule[] = [
      createMoveRule("$.data", "/__proto__/danger", { id: "proto-move" }),
    ];

    const result = runTransformer(source, rules);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("Unsafe pointer segment"))).toBe(true);
    expect(result.document).toEqual(source);
    expect(result.operations).toEqual([]);
  });
});
