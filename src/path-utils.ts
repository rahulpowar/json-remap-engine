const NORMAL_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

const decodePointerToken = (token: string) => token.replace(/~1/g, "/").replace(/~0/g, "~");
const encodePointerToken = (token: string) => token.replace(/~/g, "~0").replace(/\//g, "~1");

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

const unescapeAnalysisKey = (key: string) => key.replace(/\\"/g, '"');
const escapeAnalysisKey = (key: string) => key.replace(/"/g, '\\"');

/**
 * Converts an internal "analysis path" (root.foo.bar[0]) to a JSONPath expression.
 */
export const analysisPathToJsonPath = (path: string) => {
  if (!path || path === "root") return "$";
  return path.replace(/^root/, "$");
};

/**
 * Converts an internal "analysis path" (root.foo.bar[0]) to a JSON Pointer string.
 */
export const analysisPathToPointer = (path: string) => {
  if (!path || path === "root") return "";
  const tail = path.replace(/^root/, "");
  if (!tail) return "";
  const tokens: string[] = [];
  const segmentPattern = /(?:\.([A-Za-z_][A-Za-z0-9_]*))|(?:\["((?:\\"|[^"])+)"\])|(?:\[(\d+)\])/g;
  let match: RegExpExecArray | null;

  while ((match = segmentPattern.exec(tail)) !== null) {
    const [, dotted, quoted, indexToken] = match;
    if (dotted !== undefined) {
      tokens.push(dotted);
    } else if (quoted !== undefined) {
      tokens.push(unescapeAnalysisKey(quoted));
    } else if (indexToken !== undefined) {
      tokens.push(indexToken);
    }
  }

  if (!tokens.length) return "";
  return `/${tokens.map(encodePointerToken).join("/")}`;
};

/**
 * Converts a JSON Pointer to the internal analysis path format.
 */
export const pointerToAnalysisPath = (pointer: string) => {
  if (!pointer || pointer === "" || pointer === "/") return "root";
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((token) => decodePointerToken(token));

  let path = "root";
  tokens.forEach((token) => {
    if (/^\d+$/.test(token)) {
      path += `[${token}]`;
    } else if (NORMAL_KEY_REGEX.test(token)) {
      path += `.${token}`;
    } else {
      path += `["${escapeAnalysisKey(token)}"]`;
    }
  });
  return path;
};

/**
 * Returns true when a JSON Pointer exists inside the provided document.
 */
export const pointerExists = (document: unknown, pointer: string): boolean => {
  if (pointer === "" || pointer === "/") {
    return document !== undefined;
  }
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((token) => decodePointerToken(token));

  let current: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return false;
      }
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === "object") {
      if (!hasOwn(current as Record<string, unknown>, token)) {
        return false;
      }
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return false;
  }
  return true;
};

/**
 * Safely retrieves a value at the JSON Pointer location, returning undefined when missing.
 */
export const getValueAtPointerSafe = (document: unknown, pointer: string): unknown => {
  if (pointer === "" || pointer === "/") {
    return document;
  }
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((token) => decodePointerToken(token));

  let current: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === "object") {
      if (!hasOwn(current as Record<string, unknown>, token)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return undefined;
  }
  return current;
};

/**
 * Converts a "simple" JSONPath expression (limited to property access and numeric indices)
 * into an equivalent JSON Pointer. Returns null for unsupported syntax.
 */
export const simpleJsonPathToPointer = (expression: string): string | null => {
  const trimmed = expression.trim();
  if (!trimmed.startsWith("$")) return null;
  const remainder = trimmed.slice(1);
  if (!remainder) return "";

  const tokens: string[] = [];
  const pattern = /(?:\.([A-Za-z_][A-Za-z0-9_]*))|(?:\[['"]([^'"\\]+)['"]\])|(?:\[(\d+)\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(remainder)) !== null) {
    if (match.index !== lastIndex) {
      return null;
    }
    const [, dottedName, quotedName, indexToken] = match;
    if (dottedName !== undefined) {
      tokens.push(dottedName);
    } else if (quotedName !== undefined) {
      tokens.push(quotedName);
    } else if (indexToken !== undefined) {
      tokens.push(indexToken);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex !== remainder.length) {
    return null;
  }

  if (!tokens.length) return "";
  return `/${tokens.map(encodePointerToken).join("/")}`;
};

export { decodePointerToken, encodePointerToken };
