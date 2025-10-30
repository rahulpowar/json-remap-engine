import { encode as encodeToon } from "@byjohann/toon";

export type EncodeOptions = NonNullable<Parameters<typeof encodeToon>[1]>;

/**
 * Library defaults when emitting TOON text.
 * - Tab delimiter for compact tabular display
 * - Length marker '#'
 * - 2-space indent to keep nested structures readable
 */
export const defaultToonOptions: EncodeOptions = {
  delimiter: "\t",
  indent: 2,
  lengthMarker: "#",
} as const;

/**
 * Encode any JSON-compatible value into TOON format.
 */
export const encodeToToon = (value: unknown, options: EncodeOptions = defaultToonOptions): string => {
  return encodeToon(value as never, options);
};

/** Extends TransformerResult with a TOON rendering of the transformed document. */
// TOON encoding helpers only; runTransformer accepts an encoding option.
