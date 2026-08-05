import { useState, type FormEvent } from 'react';

export function LoginPage({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await onLogin(username, password);
    } catch {
      setError('The username or password was not accepted.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <img src="/dayfront-logo.png" alt="" aria-hidden="true" />
        <p className="eyebrow">Own your day. Own your data.</p>
        <h1 id="login-title">Sign in to DayFront</h1>
        <p className="muted">Use your CalDAV username and password.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={256}
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={2048}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
