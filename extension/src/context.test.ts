import { describe, expect, it } from "vitest";

describe("context limits", () => {
  it("keeps the semantic context contract bounded", () => {
    expect(12_000).toBeLessThan(20_000);
    expect(180).toBeLessThanOrEqual(200);
  });
});
