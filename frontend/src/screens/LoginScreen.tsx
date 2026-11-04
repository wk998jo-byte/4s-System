import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("operator");
  const [password, setPassword] = useState("operator");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Keep sign-in light even if a prior session left theme-dark on <html>.
  useEffect(() => {
    document.documentElement.classList.remove("theme-dark");
  }, []);

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

  return (
    <div className="login-page">
      <article className="login-card">
        <div className="brand">
          <div className="brand-mark">SCC</div>
          <div>
            <p className="brand-kicker">Safety Command Center</p>
            <h1>Sign in</h1>
          </div>
        </div>
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
      </article>
    </div>
  );
}
