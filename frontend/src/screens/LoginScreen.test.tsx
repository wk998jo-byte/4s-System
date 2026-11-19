import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    login: async () => undefined,
    changePassword: async () => undefined,
  }),
}));

import { LoginScreen } from "./LoginScreen";

describe("LoginScreen", () => {
  it("shows Forgot password on the sign-in page without failed attempts", () => {
    const html = renderToStaticMarkup(createElement(LoginScreen));
    expect(html).toContain("Forgot password?");
    expect(html).toContain("Sign in");
  });
});
