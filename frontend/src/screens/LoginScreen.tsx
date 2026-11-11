import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";

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

  const [username, setUsername] = useState("operator");
  const [password, setPassword] = useState("operator");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Keep sign-in light even if a prior session left theme-dark on <html>.
  useEffect(() => {
    document.documentElement.classList.remove("theme-dark");
  }, []);

  useEffect(() => {
    if (mustChange) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
    }
  }, [mustChange]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(errorMessage(err));
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

  return (
    <div className="login-page">
      <article className="login-card">
        <div className="brand">
          <div className="brand-mark">SCC</div>
          <div>
            <p className="brand-kicker">Safety Command Center</p>
            <h1>{mustChange ? "Change password" : "Sign in"}</h1>
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
                  onChange={(event) => setUsername(event.target.value)}
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
              <button className="btn primary" disabled={saving}>
                {saving ? "Signing in…" : "Sign in"}
              </button>
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
