import { describe, it, expect } from "vitest";
import { splitDescriptions, joinDescriptions } from "../../components/ProjectCard";

describe("splitDescriptions", () => {
  it("returns empty array for empty string", () => {
    expect(splitDescriptions("")).toEqual([]);
  });

  it("returns empty array for whitespace-only", () => {
    expect(splitDescriptions("   ")).toEqual([]);
  });

  it("splits bullet-prefixed lines", () => {
    expect(splitDescriptions("- task 1\n- task 2")).toEqual(["task 1", "task 2"]);
  });

  it("handles single line without prefix", () => {
    expect(splitDescriptions("just a task")).toEqual(["just a task"]);
  });

  it("handles single line with prefix", () => {
    expect(splitDescriptions("- just a task")).toEqual(["just a task"]);
  });

  it("strips whitespace from lines", () => {
    expect(splitDescriptions("  - task 1  \n  - task 2  ")).toEqual(["task 1", "task 2"]);
  });

  it("filters out empty lines", () => {
    expect(splitDescriptions("- task 1\n\n- task 2")).toEqual(["task 1", "task 2"]);
  });
});

describe("joinDescriptions", () => {
  it("returns empty string for empty array", () => {
    expect(joinDescriptions([])).toBe("");
  });

  it("returns empty string for array of empty strings", () => {
    expect(joinDescriptions(["", "  "])).toBe("");
  });

  it("prefixes single line with dash", () => {
    expect(joinDescriptions(["task 1"])).toBe("- task 1");
  });

  it("joins multiple lines with dash prefix", () => {
    expect(joinDescriptions(["task 1", "task 2"])).toBe("- task 1\n- task 2");
  });

  it("filters out empty strings", () => {
    expect(joinDescriptions(["task 1", "", "task 2"])).toBe("- task 1\n- task 2");
  });
});

describe("splitDescriptions → joinDescriptions roundtrip", () => {
  it("roundtrips bullet format", () => {
    const original = "- task 1\n- task 2\n- task 3";
    expect(joinDescriptions(splitDescriptions(original))).toBe(original);
  });

  it("normalizes plain text to bullet format", () => {
    const plain = "single task";
    expect(joinDescriptions(splitDescriptions(plain))).toBe("- single task");
  });

  it("preserves descriptions with special characters", () => {
    const original = "- FK constraint violation fix on orders\n- scaling & load forecasting";
    expect(joinDescriptions(splitDescriptions(original))).toBe(original);
  });
});
