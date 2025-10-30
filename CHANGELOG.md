# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-10-30
### Added
- Optional encoded output via `runTransformer(input, rules, { encoding })` with `OutputEncoding` enum:
  - `JsonPretty` (default), `JsonCompact`, and `Toon` (via `@byjohann/toon`).
- `OutputEncodingDescription` map for UI labels.
- TOON support with helpers: `encodeToToon`, `defaultToonOptions`.
- Re-exported `EncodeOptions` for TOON configuration.

## [0.2.0] - 2025-10-10
### Added
- First public release extracted from Token Tamer. Core transformer, rule helpers, and path utilities.
