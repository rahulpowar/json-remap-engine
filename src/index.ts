export {
  runTransformer,
  formatPatch,
  type Rule,
  type RemoveRule,
  type ReplaceRule,
  type MoveRule,
  type RenameRule,
  type RuleDiagnostic,
  type RuleOperationDiagnostic,
  type TransformerResult,
  type JsonPatchOperation,
  type Op,
} from "./transformer";

export { createRemoveRule, createReplaceRule, createMoveRule, createRenameRule, generateRuleId } from "./rules";

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

export {
  encodeToToon,
  defaultToonOptions,
} from "./toon";

export type { EncodeOptions } from "./toon";

export { OutputEncoding, OutputEncodingDescription } from "./transformer";
