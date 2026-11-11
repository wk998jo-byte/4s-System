import { useEffect, useState, type FormEvent } from "react";
import {
  requestPasswordRecovery,
  resetPasswordWithCode,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";

type Mode = "signin" | "recover-email" | "recover-reset";

const WRONG_PASSWORD_BEFORE_FORGOT = 3;

function passwordIssues(value: string): string[] {
  const issues: string[] = [];
  if (value.length < 10) issues.push("at least 10 characters");
  if (!/[A-Z]/.test(value)) issues.push("1 capital letter");
  if (!/[0-9]/.test(value)) issues.push("1 number");
  return issues;
}

export function LoginScreen() {
  const { user, login, changePassword } = useAuth();
  const mustChange = Boolean(user?.must_change_password);

  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("operator");
  const [password, setPassword] = useState("operator");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [wrongPasswordTries, setWrongPasswordTries] = useState(0);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const showForgot = wrongPasswordTries >= WRONG_PASSWORD_BEFORE_FORGOT;

  // Keep sign-in light even if a prior session left theme-dark on <html>.
  useEffect(() => {
    document.documentElement.classList.remove("theme-dark");
  }, []);

  useEffect(() => {
    if (mustChange) {
      setMode("signin");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      setInfo(null);
    }
  }, [mustChange]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      await login(username, password);
      setWrongPasswordTries(0);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      if (/incorrect password/i.test(message)) {
        setWrongPasswordTries((n) => n + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword(event: FormEvent) {
    event.preventDefault();
    const issues = passwordIssues(newPassword);
    if (issues.length) {
      setError(`Password needs ${issues.join(", ")}.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onRequestRecovery(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const result = await requestPasswordRecovery({
        username: username.trim(),
        email: recoveryEmail.trim(),
      });
      setInfo(
        result.delivery === "outbox"
          ? "Code saved to the server outbox (SMTP not configured). Check backend/data/outbox, then enter the code below."
          : "Recovery code sent. Enter it below with your new password.",
      );
      setMode("recover-reset");
      setRecoveryCode("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onResetWithCode(event: FormEvent) {
    event.preventDefault();
    const issues = passwordIssues(newPassword);
    if (issues.length) {
      setError(`Password needs ${issues.join(", ")}.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const result = await resetPasswordWithCode({
        username: username.trim(),
        email: recoveryEmail.trim(),
        code: recoveryCode.trim(),
        new_password: newPassword,
      });
      setMode("signin");
      setPassword("");
      setWrongPasswordTries(0);
      setInfo(result.message || "Password updated. Sign in with your new password.");
      setRecoveryCode("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const title =
    mustChange
      ? "Change password"
      : mode === "recover-email"
        ? "Forgot password"
        : mode === "recover-reset"
          ? "Reset password"
          : "Sign in";

  return (
    <div className="login-page">
      <article className="login-card">
        <div className="brand">
          <div className="brand-mark">SCC</div>
          <div>
            <p className="brand-kicker">Safety Command Center</p>
            <h1>{title}</h1>
          </div>
        </div>
        {mustChange ? (
          <>
            <p className="muted">
              Welcome{user?.display_name ? `, ${user.display_name}` : ""}. Choose a new
              password before continuing. It must be at least 10 characters and include 1
              capital letter and 1 number.
            </p>
            <form className="form" onSubmit={(event) => void onChangePassword(event)}>
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  autoComplete="current-password"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>
              {error ? <p className="state error">{error}</p> : null}
              <button className="btn primary" disabled={saving}>
                {saving ? "Saving…" : "Save new password"}
              </button>
            </form>
          </>
        ) : mode === "recover-email" ? (
          <>
            <p className="muted">
              Enter the email saved on the account for <strong>{username || "this user"}</strong>.
              If it matches, a recovery code will be sent.
            </p>
            <form className="form" onSubmit={(event) => void onRequestRecovery(event)}>
              <label>
                Email
                <input
                  type="email"
                  value={recoveryEmail}
                  autoComplete="email"
                  onChange={(event) => setRecoveryEmail(event.target.value)}
                  required
                />
              </label>
              {error ? <p className="state error">{error}</p> : null}
              {info ? <p className="muted">{info}</p> : null}
              <button className="btn primary" disabled={saving}>
                {saving ? "Sending…" : "Send recovery code"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setInfo(null);
                }}
              >
                Back to sign in
              </button>
            </form>
          </>
        ) : mode === "recover-reset" ? (
          <>
            <p className="muted">
              Enter the code sent to your email, then choose a new password (10+ characters, 1
              capital letter, 1 number).
            </p>
            <form className="form" onSubmit={(event) => void onResetWithCode(event)}>
              <label>
                Recovery code
                <input
                  value={recoveryCode}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  required
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>
              {error ? <p className="state error">{error}</p> : null}
              {info ? <p className="muted">{info}</p> : null}
              <button className="btn primary" disabled={saving}>
                {saving ? "Updating…" : "Reset password"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setMode("recover-email");
                  setError(null);
                  setInfo(null);
                }}
              >
                Resend code
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="muted">
              Four local roles: Operator, Admin, Dept HSE and Project PM. SSO is not
              connected in this prototype.
            </p>
            <form className="form" onSubmit={(event) => void onSubmit(event)}>
              <label>
                Username
                <input
                  value={username}
                  autoComplete="username"
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setWrongPasswordTries(0);
                  }}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              {error ? <p className="state error">{error}</p> : null}
              {info ? <p className="muted">{info}</p> : null}
              <button className="btn primary" disabled={saving}>
                {saving ? "Signing in…" : "Sign in"}
              </button>
              {showForgot ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setMode("recover-email");
                    setError(null);
                    setInfo(null);
                    setRecoveryEmail("");
                  }}
                >
                  Forgot password?
                </button>
              ) : null}
            </form>
            <p className="muted login-hint">
              Operator: <code>operator</code> / <code>operator</code>
              <br />
              Admin: <code>admin</code> / <code>admin</code>
              <br />
              Dept HSE: <code>hse</code> / <code>hse</code>
              <br />
              Project PM: <code>pm</code> / <code>pm</code>
            </p>
          </>
        )}
      </article>
    </div>
  );
}
