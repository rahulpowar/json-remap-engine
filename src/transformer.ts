import { JSONPath } from "jsonpath-plus";
import { encodeToToon, defaultToonOptions, type EncodeOptions } from "./toon";

import { decodePointerToken, encodePointerToken, simpleJsonPathToPointer } from "./path-utils";

export type Op = "remove" | "replace" | "move" | "rename";

interface RuleBase {
  id: string;
  matcher: string;
  allowEmptyMatcher?: boolean;
  allowEmptyValue?: boolean;
  disabled?: boolean;
}

export interface RemoveRule extends RuleBase {
  op: "remove";
}

export interface ReplaceRule extends RuleBase {
  op: "replace";
  value: unknown;
  /** Controls how replacement values are interpreted. */
  valueMode?: "auto" | "literal";
}

export interface MoveRule extends RuleBase {
  op: "move";
  target: string;
  /** Controls how move targets are interpreted. */
  targetMode?: "auto" | "pointer" | "jsonpath";
}

export interface RenameRule extends RuleBase {
  op: "rename";
  target: string;
  /** Controls how rename targets are interpreted. */
  targetMode?: "auto" | "literal" | "jsonpath";
}

export type Rule = RemoveRule | ReplaceRule | MoveRule | RenameRule;

export type JsonPatchOperation =
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; path: string; from: string };

export interface RuleOperationDiagnostic {
  matchIndex: number;
  pointer: string;
  op: Op;
  summary: JsonPatchOperation;
  status: "applied" | "skipped";
  message?: string;
}

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

const isUnsafePointerKey = (key: string) => key === "__proto__" || key === "prototype" || key === "constructor";

const assertSafePointerKey = (key: string) => {
  if (isUnsafePointerKey(key)) {
    throw new Error(`Unsafe pointer segment '${key}' is not allowed`);
  }
};

export interface RuleDiagnostic {
  ruleId: string;
  matcher: string;
  op: Op;
  matchCount: number;
  operations: RuleOperationDiagnostic[];
  errors: string[];
  warnings: string[];
}

export interface TransformerResult {
  ok: boolean;
  document: unknown;
  operations: JsonPatchOperation[];
  diagnostics: RuleDiagnostic[];
  errors: string[];
  warnings: string[];
}

/**
 * Self-documenting encoding enum for the runTransformer output stream.
 */
export const OutputEncoding = {
  /**
   * Human-friendly JSON with indentation (default).
   * @example
   * const res = runTransformer(input, rules, { encoding: OutputEncoding.JsonPretty })
   * console.log(res.output) // Pretty JSON
   */
  JsonPretty: "json-pretty",

  /**
   * Compact/minified JSON without extra whitespace.
   * @example
   * const res = runTransformer(input, rules, { encoding: OutputEncoding.JsonCompact })
   * console.log(res.output) // Minified JSON
   */
  JsonCompact: "json-compact",

  /**
   * TOON text, a readable tabular format powered by @byjohann/toon.
   * @example
   * const res = runTransformer(input, rules, { encoding: OutputEncoding.Toon })
   * console.log(res.output) // TOON text
   */
  Toon: "toon",
} as const;

export type OutputEncoding = typeof OutputEncoding[keyof typeof OutputEncoding];

/** Human-readable descriptions for each encoding. */
export const OutputEncodingDescription: Record<OutputEncoding, string> = {
  [OutputEncoding.JsonPretty]: "Human-friendly JSON with indentation.",
  [OutputEncoding.JsonCompact]: "Minified JSON without whitespace.",
  [OutputEncoding.Toon]: "TOON text format using @byjohann/toon.",
};

export interface EncodedOutput {
  output: string;
  encoding: OutputEncoding;
  contentType: "application/json" | "text/plain";
}

export interface RunTransformerOptions {
  /** Output encoding for the returned `output` string. Defaults to `OutputEncoding.JsonPretty`. */
  encoding?: OutputEncoding;
  jsonIndent?: number;       // default 2 when encoding is json-pretty
  toonOptions?: EncodeOptions; // options forwarded to TOON encoder
}

const cloneValue = <T>(input: T): T => {
  if (input === undefined) return input;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(input);
  }
  return JSON.parse(JSON.stringify(input)) as T;
};

const normalizePointer = (pointer: string): string => {
  if (pointer === "") return "";
  if (!pointer.startsWith("/")) {
    return `/${pointer.replace(/^\/+/g, "")}`;
  }
  return pointer;
};

const splitPointer = (pointer: string): string[] => {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON pointer: ${pointer}`);
  }
  const parts = pointer.slice(1).split("/");
  return parts.map(decodePointerToken);
};

const ensurePointerSafety = (pointer: string) => {
  if (pointer === "") return;
  const tokens = splitPointer(pointer);
  tokens.forEach((token) => {
    if (isUnsafePointerKey(token)) {
      throw new Error(`Unsafe pointer segment '${token}' is not allowed`);
    }
  });
};

const joinPointer = (tokens: string[]) => {
  if (tokens.length === 0) return "";
  return `/${tokens.map(encodePointerToken).join("/")}`;
};

const getValueAtPointer = (document: unknown, pointer: string) => {
  const tokens = splitPointer(pointer);
  let current: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (token === "-") {
        throw new Error("Cannot resolve '-' within JSON pointer");
      }
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`Array index ${token} is out of bounds`);
      }
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === "object") {
      if (!hasOwn(current as Record<string, unknown>, token)) {
        throw new Error(`Property '${token}' does not exist`);
      }
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    throw new Error(`Cannot traverse pointer segment '${token}' on non-container value`);
  }
  return current;
};

const getParentContext = (document: unknown, pointer: string) => {
  const tokens = splitPointer(pointer);
  if (tokens.length === 0) {
    return { parent: null, key: null } as const;
  }
  const parentTokens = tokens.slice(0, -1);
  const key = tokens[tokens.length - 1];
  const parent = parentTokens.length === 0 ? document : getValueAtPointer(document, joinPointer(parentTokens));
  return { parent, key } as const;
};

const removeAtPointer = (document: unknown, pointer: string) => {
  const { parent, key } = getParentContext(document, pointer);
  if (parent === null || key === null) {
    throw new Error("Cannot remove the root document");
  }
  if (Array.isArray(parent)) {
    if (key === "-") {
      throw new Error("'-' is not allowed when removing array elements");
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`Array index ${key} is out of bounds`);
    }
    parent.splice(index, 1);
    return document;
  }
  if (parent !== null && typeof parent === "object") {
    if (!hasOwn(parent as Record<string, unknown>, key)) {
      throw new Error(`Property '${key}' does not exist`);
    }
    delete (parent as Record<string, unknown>)[key];
    return document;
  }
  throw new Error("Cannot remove from non-container value");
};

const replaceAtPointer = (document: unknown, pointer: string, value: unknown) => {
  const { parent, key } = getParentContext(document, pointer);
  if (parent === null || key === null) {
    return value;
  }
  if (Array.isArray(parent)) {
    if (key === "-") {
      throw new Error("'-' is not allowed when replacing array elements");
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`Array index ${key} is out of bounds`);
    }
    parent[index] = value;
    return document;
  }
  if (parent !== null && typeof parent === "object") {
    assertSafePointerKey(key);
    if (!hasOwn(parent as Record<string, unknown>, key)) {
      throw new Error(`Property '${key}' does not exist`);
    }
    (parent as Record<string, unknown>)[key] = value;
    return document;
  }
  throw new Error("Cannot replace within non-container value");
};

const addAtPointer = (document: unknown, pointer: string, value: unknown) => {
  const { parent, key } = getParentContext(document, pointer);
  if (parent === null || key === null) {
    return value;
  }
  if (Array.isArray(parent)) {
    if (key === "-") {
      (parent as unknown[]).push(value);
      return document;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(`Array index ${key} is out of bounds`);
    }
    parent.splice(index, 0, value);
    return document;
  }
  if (parent !== null && typeof parent === "object") {
    assertSafePointerKey(key);
    (parent as Record<string, unknown>)[key] = value;
    return document;
  }
  throw new Error("Cannot add within non-container value");
};

const compareRemoveOrder = (a: JsonPatchOperation, b: JsonPatchOperation) => {
  if (a.op !== "remove" || b.op !== "remove") return 0;
  const aTokens = splitPointer(a.path);
  const bTokens = splitPointer(b.path);
  const aParent = joinPointer(aTokens.slice(0, -1));
  const bParent = joinPointer(bTokens.slice(0, -1));
  if (aParent !== bParent) return 0;
  const aIndex = Number(aTokens[aTokens.length - 1]);
  const bIndex = Number(bTokens[bTokens.length - 1]);
  if (!Number.isInteger(aIndex) || !Number.isInteger(bIndex)) return 0;
  return bIndex - aIndex;
};

const reorderRemoveOperations = (operations: RuleOperationDiagnostic[]) => {
  const result = [...operations];
  const groups = new Map<string, RuleOperationDiagnostic[]>();

  operations.forEach((operation) => {
    if (operation.summary.op !== "remove") return;
    const tokens = splitPointer(operation.summary.path);
    const parentPointer = joinPointer(tokens.slice(0, -1));
    const group = groups.get(parentPointer) ?? [];
    group.push(operation);
    groups.set(parentPointer, group);
  });

  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => compareRemoveOrder(a.summary, b.summary));
    const positions = group
      .map((operation) => result.indexOf(operation))
      .filter((position) => position >= 0)
      .sort((a, b) => a - b);

    positions.forEach((position, index) => {
      result[position] = sorted[index];
    });
  });

  return result;
};

const evaluatePointerMatches = (document: unknown, matcher: string) => {
  const normalized = matcher.trim();
  if (!normalized) {
    throw new Error("Matcher JSONPath expression is empty");
  }
  let raw: unknown;
  try {
    raw = JSONPath({ path: normalized, json: document as JsonLike, resultType: "pointer" }) as unknown;
  } catch (error) {
    if (error instanceof Error) {
      if (/Cannot read (properties|property) of undefined/i.test(error.message)) {
        throw new Error(
          `${error.message}. Ensure optional segments exist before comparing, e.g. @.inspection && @.inspection.meta && @.inspection.meta.status == "OK". JSONPath filters do not support JavaScript optional chaining syntax (?.).`,
        );
      }
      throw new Error(error.message);
    }
    throw error;
  }
  const pointers = Array.isArray(raw) ? (raw as string[]) : [raw as string];
  const normalizedPointers = pointers.map((pointer) => normalizePointer(pointer));
  return Array.from(new Set(normalizedPointers));
};

const resolveValueExpression = (document: unknown, rule: ReplaceRule) => {
  const { valueMode = "auto", value } = rule;
  if (valueMode === "literal") {
    return cloneValue(value);
  }
  if (typeof value === "string" && value.trim().startsWith("$")) {
    const resolved = JSONPath({ path: value.trim(), json: document as JsonLike, resultType: "value" });
    if (!Array.isArray(resolved)) {
      return resolved;
    }
    if (resolved.length !== 1) {
      throw new Error(`Expected exactly one value for JSONPath '${value}', received ${resolved.length}`);
    }
    return resolved[0];
  }
  return cloneValue(value);
};

const resolveTargetPointer = (document: unknown, rule: MoveRule): string | null => {
  const { target, targetMode = "auto" } = rule;
  if (!target.trim()) {
    throw new Error("Move operations require a target pointer or JSONPath");
  }
  const trimmed = target.trim();
  if (targetMode === "pointer") {
    const pointer = normalizePointer(trimmed);
    ensurePointerSafety(pointer);
    return pointer;
  }
  if (targetMode === "jsonpath") {
    const resolved = JSONPath({ path: trimmed, json: document as JsonLike, resultType: "pointer" });
    const values = Array.isArray(resolved) ? resolved : [resolved];
    if (values.length === 1) {
      const pointer = normalizePointer(values[0]);
      ensurePointerSafety(pointer);
      return pointer;
    }
    if (values.length === 0) {
      if (rule.allowEmptyValue) {
        return null;
      }
      const fallbackPointer = simpleJsonPathToPointer(trimmed);
      if (fallbackPointer !== null) {
        const pointer = normalizePointer(fallbackPointer);
        ensurePointerSafety(pointer);
        return pointer;
      }
    }
    throw new Error(`Expected exactly one target pointer for JSONPath '${target}', received ${values.length}`);
  }
  if (trimmed.startsWith("/")) {
    const pointer = normalizePointer(trimmed);
    ensurePointerSafety(pointer);
    return pointer;
  }
  if (trimmed.startsWith("$")) {
    const resolved = JSONPath({ path: trimmed, json: document as JsonLike, resultType: "pointer" });
    const values = Array.isArray(resolved) ? resolved : [resolved];
    if (values.length !== 1) {
      if (values.length === 0) {
        if (rule.allowEmptyValue) {
          return null;
        }
        const fallbackPointer = simpleJsonPathToPointer(trimmed);
        if (fallbackPointer) {
          const pointer = normalizePointer(fallbackPointer);
          ensurePointerSafety(pointer);
          return pointer;
        }
      }
      throw new Error(`Expected exactly one target pointer for JSONPath '${target}', received ${values.length}`);
    }
    const pointer = normalizePointer(values[0]);
    ensurePointerSafety(pointer);
    return pointer;
  }
  throw new Error("Target must start with '/' for JSONPointer or '$' for JSONPath");
};

const resolveRenameTargetPointer = (document: unknown, pointer: string, rule: RenameRule): string | null => {
  const { parent, key } = getParentContext(document, pointer);
  if (parent === null || key === null) {
    throw new Error("Cannot rename the root document");
  }
  if (Array.isArray(parent)) {
    throw new Error("Rename operations can only target object properties");
  }
  const trimmedTarget = (rule.target ?? "").trim();
  if (!trimmedTarget) {
    if (rule.allowEmptyValue) {
      return null;
    }
    throw new Error("Rename operations require a target key or JSONPath");
  }

  const coerceKey = (value: unknown): string => {
    if (typeof value !== "string") {
      throw new Error("Rename target must resolve to a string key");
    }
    const normalized = value.trim();
    if (!normalized) {
      throw new Error("Rename target must be a non-empty string");
    }
    return normalized;
  };

  let nextKey: string | null;

  if (rule.targetMode === "literal") {
    nextKey = coerceKey(trimmedTarget);
  } else if (rule.targetMode === "jsonpath" || trimmedTarget.startsWith("$") || trimmedTarget.startsWith("@")) {
    const resolved = JSONPath({ path: trimmedTarget, json: parent as JsonLike, resultType: "value" });
    const values = Array.isArray(resolved) ? resolved : [resolved];
    const definedValues = values.filter((candidate) => candidate !== undefined);
    if (definedValues.length === 0) {
      if (rule.allowEmptyValue) {
        return null;
      }
      throw new Error(`Expected JSONPath '${rule.target}' to resolve to exactly one string key`);
    }
    if (definedValues.length !== 1) {
      throw new Error(`Expected JSONPath '${rule.target}' to resolve to exactly one string key but received ${definedValues.length}`);
    }
    nextKey = coerceKey(definedValues[0]);
  } else {
    nextKey = coerceKey(trimmedTarget);
  }

  if (nextKey === null) {
    return null;
  }

  assertSafePointerKey(nextKey);

  if (nextKey === key) {
    return null;
  }

  if (hasOwn(parent as Record<string, unknown>, nextKey)) {
    throw new Error(`Property '${nextKey}' already exists on the target object`);
  }

  const parentTokens = splitPointer(pointer).slice(0, -1);
  const nextPointer = joinPointer([...parentTokens, nextKey]);
  ensurePointerSafety(nextPointer);
  return nextPointer;
};

const applyOperation = (document: unknown, operation: JsonPatchOperation) => {
  switch (operation.op) {
    case "remove":
      return removeAtPointer(document, operation.path);
    case "replace":
      return replaceAtPointer(document, operation.path, operation.value);
    case "move": {
      const value = cloneValue(getValueAtPointer(document, operation.from));
      let intermediate = removeAtPointer(document, operation.from);
      intermediate = addAtPointer(intermediate, operation.path, value);
      return intermediate;
    }
    default:
      return document;
  }
};

export function runTransformer(input: unknown, rules: Rule[]): TransformerResult;
export function runTransformer(
  input: unknown,
  rules: Rule[],
  options: RunTransformerOptions,
): TransformerResult & EncodedOutput;
export function runTransformer(
  input: unknown,
  rules: Rule[],
  options?: RunTransformerOptions,
): TransformerResult | (TransformerResult & EncodedOutput) {
  const diagnostics: RuleDiagnostic[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const appliedOperations: JsonPatchOperation[] = [];

  let workingDocument = cloneValue(input);

  rules.forEach((rule, ruleIndex) => {
    if (rule.disabled) {
      diagnostics.push({
        ruleId: rule.id,
        matcher: rule.matcher,
        op: rule.op,
        matchCount: 0,
        operations: [],
        errors: [],
        warnings: [],
      });
      return;
    }

    const ruleErrors: string[] = [];
    const ruleWarnings: string[] = [];
    let matches: string[] = [];
    let suppressNoOpWarning = false;
    const trimmedMatcher = (rule.matcher ?? "").trim();
    if (!trimmedMatcher) {
      matches = [];
      suppressNoOpWarning = true;
    } else {
      try {
        matches = evaluatePointerMatches(workingDocument, rule.matcher);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ruleErrors.push(`Rule ${ruleIndex + 1} (${rule.op}) matcher error: ${message}`);
      }
      if (matches.length === 0 && rule.allowEmptyMatcher) {
        suppressNoOpWarning = true;
      }
    }

    let skipDueToEmptyValue = false;
    if (rule.op === "replace") {
      const valueIsEmpty = rule.value === undefined;
      if (valueIsEmpty) {
        skipDueToEmptyValue = true;
        if (rule.allowEmptyValue) {
          suppressNoOpWarning = true;
        } else {
          ruleErrors.push(`Rule ${ruleIndex + 1} replace value error: replacement value is required`);
        }
      }
    }

    if (skipDueToEmptyValue) {
      matches = [];
    }

    const operations: RuleOperationDiagnostic[] = [];

    matches.forEach((pointer, matchIndex) => {
      if (rule.op === "remove") {
        operations.push({
          matchIndex,
          pointer,
          op: "remove",
          summary: { op: "remove", path: pointer },
          status: "skipped",
        });
        return;
      }

      if (rule.op === "replace") {
        try {
          const resolvedValue = resolveValueExpression(workingDocument, rule);
          if (resolvedValue === undefined && rule.allowEmptyValue) {
            suppressNoOpWarning = true;
            return;
          }
          operations.push({
            matchIndex,
            pointer,
            op: "replace",
            summary: { op: "replace", path: pointer, value: resolvedValue },
            status: "skipped",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (rule.allowEmptyValue && message.includes("Expected exactly one value")) {
            suppressNoOpWarning = true;
            return;
          }
          ruleErrors.push(`Rule ${ruleIndex + 1} replace value error: ${message}`);
        }
        return;
      }

      if (rule.op === "rename") {
        try {
          const targetPointer = resolveRenameTargetPointer(workingDocument, pointer, rule);
          if (targetPointer === null) {
            suppressNoOpWarning = true;
            return;
          }
          operations.push({
            matchIndex,
            pointer,
            op: "rename",
            summary: { op: "move", from: pointer, path: targetPointer },
            status: "skipped",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (rule.allowEmptyValue && message.includes("resolve to exactly one string key")) {
            suppressNoOpWarning = true;
            return;
          }
          ruleErrors.push(`Rule ${ruleIndex + 1} rename target error: ${message}`);
        }
        return;
      }

      if (rule.op === "move") {
        try {
          const target = resolveTargetPointer(workingDocument, rule);
          if (target === null) {
            suppressNoOpWarning = true;
            return;
          }
          operations.push({
            matchIndex,
            pointer,
            op: "move",
            summary: { op: "move", from: pointer, path: target },
            status: "skipped",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ruleErrors.push(`Rule ${ruleIndex + 1} move target error: ${message}`);
        }
        return;
      }
    });

    if (!suppressNoOpWarning && operations.length === 0 && matches.length === 0 && ruleErrors.length === 0) {
      ruleWarnings.push("No matches produced patch operations");
    }

    let orderedOperations = reorderRemoveOperations(operations);

    orderedOperations = orderedOperations.map((operation) => ({ ...operation }));

    orderedOperations.forEach((operation) => {
      if (operation.summary.op === "remove") {
        try {
          workingDocument = applyOperation(workingDocument, operation.summary);
          operation.status = "applied";
          appliedOperations.push(operation.summary);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          operation.status = "skipped";
          operation.message = message;
          ruleErrors.push(`Remove ${operation.pointer} failed: ${message}`);
        }
        return;
      }
      if (operation.summary.op === "replace") {
        try {
          workingDocument = applyOperation(workingDocument, operation.summary);
          operation.status = "applied";
          appliedOperations.push(operation.summary);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          operation.status = "skipped";
          operation.message = message;
          ruleErrors.push(`Replace ${operation.pointer} failed: ${message}`);
        }
        return;
      }
      if (operation.summary.op === "move") {
        try {
          workingDocument = applyOperation(workingDocument, operation.summary);
          operation.status = "applied";
          appliedOperations.push(operation.summary);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          operation.status = "skipped";
          operation.message = message;
          ruleErrors.push(`Move ${operation.pointer} failed: ${message}`);
        }
      }
    });

    diagnostics.push({
      ruleId: rule.id,
      matcher: rule.matcher,
      op: rule.op,
      matchCount: matches.length,
      operations: orderedOperations,
      errors: ruleErrors,
      warnings: ruleWarnings,
    });

    ruleErrors.forEach((error) => errors.push(error));
    ruleWarnings.forEach((warning) => warnings.push(warning));
  });

  const base: TransformerResult = {
    ok: errors.length === 0,
    document: workingDocument,
    operations: appliedOperations,
    diagnostics,
    errors,
    warnings,
  };
  const encoding: OutputEncoding = options?.encoding ?? OutputEncoding.JsonPretty;
  const jsonIndent = options?.jsonIndent ?? 2;
  if (options) {
    let output = "";
    if (encoding === OutputEncoding.JsonCompact) {
      output = JSON.stringify(workingDocument);
    } else if (encoding === OutputEncoding.JsonPretty) {
      output = JSON.stringify(workingDocument, null, jsonIndent);
    } else {
      output = encodeToToon(workingDocument, options?.toonOptions ?? defaultToonOptions);
    }
    return { ...base, output, encoding, contentType: encoding.startsWith("json-") ? "application/json" : "text/plain" };
  }
  return base;
}

export const formatPatch = (operations: JsonPatchOperation[], pretty = true) => {
  return pretty ? JSON.stringify(operations, null, 2) : JSON.stringify(operations);
};
