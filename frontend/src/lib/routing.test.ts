import { describe, expect, it } from "vitest";
import { href, parseHash } from "./routing";

describe("hash routing", () => {
  it("parses module create routes", () => {
    expect(parseHash("#/ai-camera/new")).toEqual({ name: "new", type: "ai_camera" });
    expect(href({ name: "list", type: "sos" })).toBe("#/wearables");
  });

  it("parses observation deep-links with case id", () => {
    expect(parseHash("#/ai-camera?case=abc")).toEqual({
      name: "list",
      type: "ai_camera",
      caseId: "abc",
    });
    expect(href({ name: "list", type: "dashcam", caseId: "abc" })).toBe(
      "#/dashcam?case=abc",
    );
  });
});
