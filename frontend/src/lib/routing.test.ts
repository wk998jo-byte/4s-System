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

  it("parses review status deep-links from Needs attention", () => {
    expect(parseHash("#/review?status=open")).toEqual({
      name: "review",
      status: "open",
    });
    expect(parseHash("#/review?status=under_process")).toEqual({
      name: "review",
      status: "under_process",
    });
    expect(parseHash("#/review?status=open&types=dashcam,speed")).toEqual({
      name: "review",
      status: "open",
      types: ["dashcam", "speed"],
    });
    expect(href({ name: "review", status: "open" })).toBe("#/review?status=open");
    expect(href({ name: "review", status: "under_process" })).toBe(
      "#/review?status=under_process",
    );
    expect(
      href({ name: "review", status: "open", types: ["dashcam", "speed"] }),
    ).toBe("#/review?status=open&types=dashcam%2Cspeed");
  });
});
