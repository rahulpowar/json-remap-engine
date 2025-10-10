# json-remap-engine

A lightweight, fully client-side rules engine that rewrites JSON documents by evaluating [JSONPath](https://datatracker.ietf.org/doc/html/draft-ietf-jsonpath-base) matchers and producing [JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902) operations. The core logic is extracted from Token Tamer and packaged for reuse in build scripts, CLIs, and browser applications.

- 💡 **JSONPath matchers** decide which values to prune, replace, or move.
- 🩺 **Rich diagnostics** list every rule, match, and warning so you can render UI feedback or fail builds.
- 🛠️ **JSON Patch output** (`remove`, `replace`, `move`) lets you persist the changes or run them through existing patch tools.
- 📦 **Framework agnostic** – ships as ESM and CJS bundles with TypeScript declarations.

## Installation

```bash
npm install json-remap-engine
```

The package targets Node 18+ and modern browsers (requires `structuredClone` or falls back to JSON serialization).

## Quick start

```ts
import {
  runTransformer,
  createRemoveRule,
  createReplaceRule,
  createMoveRule,
} from "json-remap-engine";

const rules = [
  createRemoveRule("$.payload.largeBlob"),
  createReplaceRule("$.status", "published"),
  createReplaceRule("$.title", "$.metadata.safeTitle"),
  createReplaceRule("$.problematic_tests[*].styles[?(@.sriError==false)]", "$.styles.safe"),
  createRemoveRule("$.problematic_tests[?(@.inspection && @.inspection.meta && @.inspection.meta.status == 'OK')].inspection"),
  createMoveRule("$.draft.body", "$.published[0].body"),
];

const { document, operations, diagnostics, ok } = runTransformer(input, rules);

if (!ok) {
  console.error(diagnostics.flatMap((rule) => rule.errors));
}

console.log(document);   // transformed JSON
console.log(operations); // JSON Patch operations that were applied
```

## Why another JSON remapping approach?

- There is no single, standards-track "XSLT for JSON." Specs such as JSONPath, JSON Pointer, and JSON Patch solve slices of the problem, but teams still resort to bespoke remapping glue.
- JSONPath excels at discovering nodes (filters, wildcards, script expressions) yet stops short of templating or producing concrete mutations. Authors have to wrap selectors with imperative code.
- JSON Patch (RFC 6902) and JSON Pointer (RFC 6901) provide the minimal, auditable set of operations—but hand-writing large pointer-based rule sets for documents with evolving shapes is brittle.

`json-remap-engine` bridges these gaps: rules describe discovery in JSONPath while the engine emits standards-compliant JSON Patch operations with normalized pointers for downstream tooling and audits.

### Alternatives

If you need template-driven transformations or full expression languages, consider:

- [JSLT](https://github.com/schibsted/jslt) – JSONPath-inspired selectors paired with a functional templating language.
- [JSONata](https://jsonata.org/) – declarative queries with mapping, aggregation, and user-defined functions.
- [Jolt](https://bazaarvoice.github.io/jolt/) – a Java DSL aimed at streaming pipeline remaps.

These tools are powerful but ship larger interpreters and opinionated runtimes. `json-remap-engine` stays lightweight for build steps, CLIs, and browser diagnostics that need deterministic JSONPath-to-JSON Patch bridging.

## Rule builders

The helper factories mirror the original UI defaults and add a few ergonomics for library consumers. All helpers accept an optional options object with `id`, `allowEmptyMatcher`, `allowEmptyValue`, and `disabled` flags. When using move rules, `allowEmptyValue: true` now treats unresolved targets as a no-op instead of producing an error.

| Helper | Purpose | Key defaults |
| --- | --- | --- |
| `createRemoveRule(matcher, options)` | Removes every JSONPath match | `allowEmptyMatcher=false` |
| `createReplaceRule(matcher, value, options)` | Replaces each match with a literal value or another JSONPath value | `valueMode="auto"` detects JSONPath when strings start with `$`; pass `valueMode: "literal"` to keep strings like `"$100"` |
| `createMoveRule(matcher, target, options)` | Moves the source match to the `target` (JSON Pointer by default) | `targetMode="auto"` interprets leading `/` as JSON Pointer, leading `$` as JSONPath |

For full control you can construct `Rule` objects manually.

Move rules are hardened against prototype-pollution attacks: targets containing `__proto__`, `constructor`, or `prototype` segments are rejected. Additionally, when `allowEmptyValue` is `true` they quietly skip execution if the target JSONPath resolves to zero pointers.

```ts
import type { Rule } from "json-remap-engine";

const customRule: Rule = {
  id: "warn",
  matcher: "$.items[?(@.status == 'deprecated')]",
  op: "remove",
  allowEmptyMatcher: true,
};
```

## Diagnostics & error handling

`runTransformer` returns a `TransformerResult`:

```ts
interface TransformerResult {
  ok: boolean;              // true when no rule reported errors
  document: unknown;        // cloned & transformed input
  operations: JsonPatchOperation[]; // applied operations in execution order
  diagnostics: RuleDiagnostic[];    // per-rule detail (matches, errors, warnings)
  errors: string[];         // flattened list of rule errors
  warnings: string[];       // flattened list of rule warnings
}
```

When a rule fails its matcher or target it remains in diagnostics with `status: "skipped"` and a human-friendly message so applications can bubble the failure to users.

## Pointer utilities

Additional helpers are exported for converting between analysis paths, JSONPath, and JSON Pointer strings:

- `analysisPathToPointer("root.payload.items[0]") // => "/payload/items/0"`
- `simpleJsonPathToPointer("$.payload.items[0]") // => "/payload/items/0"`
- `pointerExists(document, "/payload/items/0")`
- `simpleJsonPathToPointer("$.problematic_tests[*].styles[?(@.sriError==false)]") // => null (wildcards with filters are intentionally unsupported)`
- `simpleJsonPathToPointer("$.problematic_tests[?(@.inspection && @.inspection.meta && @.inspection.meta.status == 'OK')].inspection") // => null (requires guarded access to avoid runtime errors)`

These utilities are reused internally when resolving move targets but exposed for downstream tooling.

## Known limitations & compatibility notes

- Replacement strings that start with `$` are treated as JSONPath expressions by default. Use `valueMode: "literal"` when you need the literal `$` prefix.
- Move targets resolved via JSONPath must map to **exactly one** pointer; ambiguous matches raise errors.
- Complex JSONPath constructs (filters, script expressions) are evaluated by [`jsonpath-plus`](https://github.com/JSONPath-Plus/JSONPath). Only “simple” paths (dot, bracket, numeric indices) can be converted to pointers when the JSONPath returns zero matches.
- Deep cloning falls back to `JSON.parse(JSON.stringify(...))`, so values such as `BigInt` or `Map` will not survive cloning.
- Pointer segments named `__proto__`, `constructor`, or `prototype` are rejected for mutating operations to guard against prototype pollution. Pointer utilities also avoid treating inherited properties as existing members.

## JSON Patch compliance

The engine emits only `remove`, `replace`, and `move` operations and applies them using the pointer semantics from [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) and [RFC 6901](https://datatracker.ietf.org/doc/html/rfc6901):

- `remove` requires the pointer to resolve and executes array deletions in descending index order to preserve RFC removal guarantees.
- `replace` requires the pointer to resolve before overwriting, mirroring the RFC requirement to test existence first.
- `move` internally resolves `from`, removes it, and re-inserts the cloned value at the destination using the same constraints as RFC `add`.

Because operations are applied to a cloned working document, the resulting JSON Patch array can be replayed with any compliant RFC 6902 implementation.

## Scripts

- `npm run build` – bundle to `dist/` (CJS, ESM, and declaration files)
- `npm run test` – run the Vitest suite
- `npm run lint` – TypeScript type-check (no emit)
- `npm run check` – type-check then tests

## Continuous integration

GitHub Actions runs the same checks on every push and pull request via `.github/workflows/ci.yml`. The workflow uses `npm ci`, executes `npm run check`, and builds the production bundles on Node.js 18.x and 20.x.

## License

MIT
