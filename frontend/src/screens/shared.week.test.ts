import { describe, expect, it } from "vitest";
import { weekFromIsoDate } from "./shared";

describe("weekFromIsoDate", () => {
  it("uses Sunday-start weeks with week 1 containing 1 January", () => {
    expect(weekFromIsoDate("2026-10-14")).toBe(42);
    expect(weekFromIsoDate("2026-10-19")).toBe(43);
  });
});
