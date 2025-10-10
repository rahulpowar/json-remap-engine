# json-remap-engine – Specification

_Last updated: 2025-10-10_

## Overview

`json-remap-engine` applies a declarative set of rules to a JSON-compatible document. Each rule produces zero or more JSON Patch operations (`remove`, `replace`, `move`) that mutate a cloned copy of the source document. The engine surfaces detailed diagnostics so host applications can render rule-by-rule status, warnings, and errors.

The behaviour matches the Token Tamer implementation and adds a small number of opt-in niceties (literal replacement values, explicit target modes) without breaking compatibility.

## Rule Model

Rules are discriminated by the `op` field:

| Field | Type | Applies to | Description |
| --- | --- | --- | --- |
| `id` | `string` | all | Required stable identifier for diagnostics. When omitted, helpers generate `r-<hex>` ids. |
| `matcher` | `string` | all | JSONPath expression evaluated via `jsonpath-plus`. Trims surrounding whitespace. |
| `op` | `'remove' \| 'replace' \| 'move' \| 'rename'` | all | Operation performed for each matching pointer. |
| `allowEmptyMatcher` | `boolean` (default `false`) | all | Silences the “No matches produced patch operations” warning when the matcher yields no results. |
| `allowEmptyValue` | `boolean` (default `false`) | replace/move/rename | Allows an empty/`undefined` replacement, target, or rename key resolution without raising an error. Move and rename rules skip execution when a JSONPath target produces zero results and the flag is enabled. |
| `disabled` | `boolean` (default `false`) | all | When `true`, the rule is skipped but still reported in diagnostics. |
| `value` | `unknown` | replace | Replacement payload. When `valueMode` is `'auto'` (default) and `value` is a string that starts with `$`, it is interpreted as a JSONPath expression. |
| `valueMode` | `'auto' \| 'literal'` (default `'auto'`) | replace | Overrides JSONPath detection. `'literal'` forces direct usage of `value`, enabling strings like `$100`. |
| `target` | `string` | move/rename | For move rules, the destination pointer or JSONPath. For rename rules, the literal key name or JSONPath that resolves to the replacement key. |
| `targetMode` | `'auto' \| 'pointer' \| 'jsonpath'` (move) / `'auto' \| 'literal' \| 'jsonpath'` (rename) | move/rename | Move rules force pointer vs JSONPath interpretation. Rename rules switch between literal keys and parent-scoped JSONPath evaluation. |

Helpers in `src/rules.ts` construct correctly typed rules with sane defaults.

## Transformation Lifecycle

1. **Clone input.** The engine deep-clones the input via `structuredClone` when available, falling back to JSON stringify/parse. The original document is never mutated.
2. **Rule iteration.** Rules execute sequentially in array order. Later rules see mutations created by earlier ones.
3. **Matcher execution.** Each active rule runs `JSONPath` with `resultType: 'pointer'`. Duplicate pointers are deduplicated. Errors during evaluation are captured and surfaced as `RuleDiagnostic.errors[]` entries, prefixed with the rule index and operation type.
4. **Operation staging.** Every pointer match stages a `RuleOperationDiagnostic` with `status: 'skipped'`. For replace rules the engine resolves the replacement value first:
   - `valueMode: 'literal'` → clone the provided value directly.
   - `value` string starting with `$` → evaluate as JSONPath, requiring exactly one result.
   - Otherwise clone the provided value.
   When resolution fails and `allowEmptyValue` is `false`, an error is recorded and the pointer is skipped.
5. **Move target resolution.** The engine resolves move targets once per pointer:
   - Explicit `targetMode: 'pointer'` → normalized pointer.
   - Explicit `targetMode: 'jsonpath'` → JSONPath pointer resolution (must yield exactly one result).
   - Auto mode uses the prefix heuristic (`/` for pointer, `$` for JSONPath). If a JSONPath yields zero pointers and `allowEmptyValue` is `true`, the move is skipped. Otherwise, a “simple path to pointer” heuristic is attempted for expressions using only dot/bracket/index selectors.
   - Pointers containing `__proto__`, `constructor`, or `prototype` segments are rejected before staging operations.
6. **Rename target resolution.** Rename rules derive replacement keys per pointer:
   - `targetMode: 'literal'` or strings without a `$`/`@` prefix are trimmed and used directly.
   - `targetMode: 'jsonpath'` or strings beginning with `$`/`@` evaluate JSONPath against the parent object. Exactly one string result is required; zero results honour `allowEmptyValue`.
   - Existing sibling keys or unsafe pointer segments trigger descriptive errors before operations are staged.
   Rename diagnostics record the logical `rename` op while the emitted patch summary remains a JSON Patch `move` operation.
7. **Remove ordering.** Within each rule, staged `remove` operations are reordered so array indices are processed from highest to lowest for the same parent pointer.
8. **Execution.** Operations execute in staged order. Failures (e.g., pointer missing after a previous mutation) mark the operation as `skipped`, append error messages, and leave the working document unchanged. Successful operations are appended to the `operations` array in applied order with their final JSON Patch summaries.
9. **Warnings.** If a rule produced no operations, no matches, and no errors, the rule emits a `"No matches produced patch operations"` warning unless suppressed via `allowEmptyMatcher` or skipped because of empty value allowances.
10. **Result aggregation.** `ok` is `true` when the aggregated error list is empty. Diagnostics are returned for each rule, regardless of enablement or success.

## Diagnostics Structure

```ts
interface RuleOperationDiagnostic {
  matchIndex: number;      // 0-based index of the match inside the rule
  pointer: string;         // JSON Pointer produced by the matcher
  op: 'remove' | 'replace' | 'move' | 'rename';
  summary: JsonPatchOperation;
  status: 'applied' | 'skipped';
  message?: string;        // populated when status === 'skipped'
}

interface RuleDiagnostic {
  ruleId: string;
  matcher: string;
  op: 'remove' | 'replace' | 'move' | 'rename';
  matchCount: number;
  operations: RuleOperationDiagnostic[];
  errors: string[];
  warnings: string[];
}
```

The top-level `errors` and `warnings` arrays flatten the respective fields from every `RuleDiagnostic`, making it easy to short-circuit or render aggregate banners. Consumers that need per-rule details can inspect `diagnostics` directly.

## Security Hardening

- Pointer traversal treats only own enumerable properties as valid JSON members. Prototype properties such as `toString` are ignored.
- Mutating operations (`replace`, `move`, `rename`, and implicit writes during `add`) reject pointer segments named `__proto__`, `constructor`, or `prototype` to prevent prototype pollution.
- Move rules with `allowEmptyValue: true` skip execution when their target JSONPath resolves to zero pointers, avoiding accidental creation of unsafe placeholder paths.

## JSON Pointer Utilities

`path-utils` exposes helper functions used by the transformer:

- `analysisPathToJsonPath` & `analysisPathToPointer` convert the Token Tamer “root.*” path syntax.
- `pointerToAnalysisPath` inverts the conversion.
- `pointerExists` / `getValueAtPointerSafe` provide safe traversal checks without throwing and ignore inherited prototype members.
- `simpleJsonPathToPointer` attempts to convert plain JSONPath access patterns to pointers (`$.foo.bar[0]` → `/foo/bar/0`). This enables move targets to be declared via JSONPath even when the destination does not yet exist.

## JSON Schema

`docs/rules.schema.json` ships a JSON Schema Draft 2020-12 definition for rule collections, mirroring the four supported operations (`remove`, `replace`, `move`, `rename`). The schema advertises its `$id` as `https://json-remap-engine.dev/schemas/rules.schema.json` so external tooling can reference it directly.

## Error Messaging

The engine throws no errors itself; instead it captures and records human-readable messages. Notable messages include:

- `"Matcher JSONPath expression is empty"` when a matcher is blank.
- `"Rule <index> (<op>) matcher error: …"` with the underlying JSONPath exception, plus advice when accessing undefined properties inside filters.
- `"Rule <index> replace value error: Expected exactly one value for JSONPath '$.foo', received <n>"` when a replacement JSONPath is ambiguous.
- `"Rule <index> move target error: Expected exactly one target pointer for JSONPath '$.foo', received <n>"` when move destinations misbehave.
- `"Rule <index> rename target error: …"` when rename key resolution fails, including collisions with sibling keys or unsafe pointer segments.
- `"Remove /path failed: …"`, `"Replace /path failed: …"`, `"Move /path failed: …"` for runtime pointer issues (e.g., concurrent modifications).

Consumers can rely on these messages to guide users without duplicating parsing logic.

## Performance Characteristics

- Matcher evaluation cost is dominated by `jsonpath-plus`. The engine does not batch matches across rules.
- Documents are cloned once, and operations mutate the clone in place.
- Large arrays are handled safely because remove operations on shared parents execute in descending index order.
- The helper functions avoid re-running JSONPath unless necessary (e.g., move target resolution only happens when the rule is a move).

## Compatibility Notes

- Behaviour is file-format agnostic; any JSON-serializable value works. Values such as `Date`, `Map`, or `Set` are stringified when cloning and will not retain their types.
- The original Token Tamer behaviour where `$`-prefixed strings are interpreted as JSONPath is preserved. Consumers needing literal values must opt-in via `valueMode: 'literal'`.
- The package is side-effect free and tree-shakeable. All exports are pure functions.

## Examples

### Replacing missing descriptions

```ts
const rules = [
  createReplaceRule("$.items[*].description", "No description", {
    allowEmptyMatcher: true,
    valueMode: "literal",
  }),
];

const { document, warnings } = runTransformer(payload, rules);
```

### Moving metadata into a canonical slot

```ts
const rules = [
  createMoveRule(
    "$.drafts[*].meta",
    "$.published[0].meta",
    { targetMode: "jsonpath" },
  ),
];
```

If the JSONPath resolves to zero targets, the engine attempts a best-effort pointer conversion (`/published/0/meta`). If that also fails an error is recorded and `ok` becomes `false`.

## Testing Strategy

The `tests/` directory contains Vitest suites replicating the application’s coverage plus additional cases for the new literal/target modes and the pointer utility helpers. Tests assert:

- Removal ordering across array parents.
- Replacement via literals and JSONPath, including ambiguity handling.
- Move semantics with JSON Pointer and JSONPath targets.
- Error and warning propagation.
- Helper functions for rule creation and path conversions.

To execute the suite:

```bash
npm install
npm run test
```

Vitest runs in ESM mode by default; no extra configuration is required.

## Future Extensions

Possible enhancements for future releases:

1. **Batch JSONPath evaluation** per rule to reduce repeated traversals when multiple operations reuse the same expression.
2. **Async value resolvers** for integrating with remote lookup tables.
3. **Configurable cloning strategy** for large documents where a partial clone would suffice.
