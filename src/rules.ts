import type { MoveRule, RemoveRule, ReplaceRule } from "./transformer";

type RuleBaseOptions = {
  /**
   * Override the generated rule identifier. When omitted a crypto-safe random id is used.
   */
  id?: string;
  /**
   * Allow the matcher to resolve to zero JSONPath pointers without raising a warning.
   */
  allowEmptyMatcher?: boolean;
  /**
   * Allow the replacement value to be empty/undefined without raising warnings.
   */
  allowEmptyValue?: boolean;
  /**
   * Start the rule disabled. Disabled rules are returned in diagnostics but not executed.
   */
  disabled?: boolean;
};

type ReplaceRuleOptions = RuleBaseOptions & {
  /**
   * When set to "literal" the value is treated as-is even if it begins with the JSONPath prefix `$`.
   */
  valueMode?: "auto" | "literal";
};

type MoveRuleOptions = RuleBaseOptions & {
  /**
   * Force the target to be treated as a JSON Pointer. Defaults to auto-detecting JSON Pointer vs JSONPath.
   */
  targetMode?: "auto" | "pointer" | "jsonpath";
};

/**
 * Generates a unique rule identifier using the Web Crypto API when available.
 */
export const generateRuleId = () => {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return `r-${buffer[0].toString(16).padStart(8, "0")}`;
  }
  return `r-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Creates a JSON removal rule for a JSONPath matcher.
 */
export const createRemoveRule = (matcher: string, options: RuleBaseOptions = {}): RemoveRule => {
  const { id = generateRuleId(), allowEmptyMatcher = false, disabled = false } = options;
  return {
    id,
    matcher,
    op: "remove",
    allowEmptyMatcher,
    allowEmptyValue: false,
    disabled,
  };
};

/**
 * Creates a replacement rule that optionally reuses another value in the document via JSONPath.
 */
export const createReplaceRule = (
  matcher: string,
  value: unknown,
  options: ReplaceRuleOptions = {},
): ReplaceRule => {
  const {
    id = generateRuleId(),
    allowEmptyMatcher = false,
    allowEmptyValue = false,
    disabled = false,
    valueMode = "auto",
  } = options;
  return {
    id,
    matcher,
    op: "replace",
    value,
    allowEmptyMatcher,
    allowEmptyValue,
    disabled,
    valueMode,
  };
};

/**
 * Creates a move rule that copies the matched value to a JSON Pointer or JSONPath target and removes the source.
 */
export const createMoveRule = (
  matcher: string,
  target: string,
  options: MoveRuleOptions = {},
): MoveRule => {
  const {
    id = generateRuleId(),
    allowEmptyMatcher = false,
    allowEmptyValue = false,
    disabled = false,
    targetMode = "auto",
  } = options;
  return {
    id,
    matcher,
    op: "move",
    target,
    allowEmptyMatcher,
    allowEmptyValue,
    disabled,
    targetMode,
  };
};
