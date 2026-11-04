import { describe, expect, it } from "vitest";
import { joinUrl } from "./client";

describe("joinUrl", () => {
  it("joins a base URL and API path without duplicating slashes", () => {
    expect(joinUrl("http://127.0.0.1:8000", "/api/v1/health")).toBe(
      "http://127.0.0.1:8000/api/v1/health",
    );
    expect(joinUrl("http://127.0.0.1:8000/", "api/v1/records")).toBe(
      "http://127.0.0.1:8000/api/v1/records",
    );
  });
});
