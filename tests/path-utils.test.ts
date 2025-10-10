import { describe, expect, it } from "vitest";

import {
  analysisPathToJsonPath,
  analysisPathToPointer,
  getValueAtPointerSafe,
  pointerExists,
  pointerToAnalysisPath,
  simpleJsonPathToPointer,
} from "../src";

describe("path utils", () => {
  it("converts analysis paths to JSONPath", () => {
    expect(analysisPathToJsonPath("root.users[0].name")).toBe("$.users[0].name");
  });

  it("converts analysis paths to pointers", () => {
    expect(analysisPathToPointer("root.users[0].name")).toBe("/users/0/name");
  });

  it("converts pointers back to analysis paths", () => {
    expect(pointerToAnalysisPath("/users/0/name")).toBe("root.users[0].name");
  });

  it("detects pointer existence", () => {
    const document = { users: [{ name: "Ada" }] };
    expect(pointerExists(document, "/users/0/name")).toBe(true);
    expect(pointerExists(document, "/users/1/name")).toBe(false);
  });

  it("does not treat prototype members as existing pointers", () => {
    const document = {};
    expect(pointerExists(document, "/toString")).toBe(false);
    expect(getValueAtPointerSafe(document, "/toString")).toBeUndefined();
  });

  it("parses simple JSONPath expressions", () => {
    expect(simpleJsonPathToPointer("$.users[0].name")).toBe("/users/0/name");
    expect(simpleJsonPathToPointer("$.users['first-name']")).toBe("/users/first-name");
    expect(simpleJsonPathToPointer("$.users[?(@.id > 1)]")).toBeNull();
  });
});
