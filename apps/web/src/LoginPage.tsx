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
        <aside className="login-support" aria-label="Support DayFront">
          <p>Enjoying DayFront?</p>
          <a
            href="https://buymeacoffee.com/maplepotion"
            target="_blank"
            rel="noreferrer"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 8h12v6.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V8Zm12 2h1.25a2.75 2.75 0 0 1 0 5.5H17M8 4.5c0 1 1 1.25 1 2.25m3-2.25c0 1 1 1.25 1 2.25" />
            </svg>
            Support DayFront
          </a>
        </aside>
      </section>
    </main>
  );
}
