export {
  runTransformer,
  formatPatch,
  type Rule,
  type RemoveRule,
  type ReplaceRule,
  type MoveRule,
  type RuleDiagnostic,
  type RuleOperationDiagnostic,
  type TransformerResult,
  type JsonPatchOperation,
  type Op,
} from "./transformer";

export { createRemoveRule, createReplaceRule, createMoveRule, generateRuleId } from "./rules";

export {
  analysisPathToJsonPath,
  analysisPathToPointer,
  pointerToAnalysisPath,
  pointerExists,
  getValueAtPointerSafe,
  simpleJsonPathToPointer,
  decodePointerToken,
  encodePointerToken,
} from "./path-utils";
