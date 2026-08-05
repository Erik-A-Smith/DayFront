# Security and reverse-proxy boundary

DayFront supports two authentication modes. `single-user` preserves the original shared configured CalDAV account. Anyone who can reach DayFront can use that account, so place it behind an authenticating reverse proxy unless it is reachable only from a trusted private network. `caldav-login` prompts each visitor for CalDAV credentials and isolates calendar requests by signed-in user.

## CalDAV login sessions

In `caldav-login` mode, the CalDAV origin remains fixed by the administrator. A login is accepted only after successful CalDAV discovery. DayFront encrypts the username, password, issue time, and expiry using AES-256-GCM with a key derived from `authentication.sessionSecret`. The browser receives authenticated ciphertext in an `HttpOnly`, `SameSite=Strict` cookie; frontend JavaScript cannot read it. The secret may be supplied directly or generated with restrictive permissions at `authentication.sessionSecretFile`. Keep the secret stable to preserve sessions across restarts, or rotate it to invalidate every existing session.

Sessions expire after `authentication.sessionTtlHours` and can be removed from the current browser with Sign out. Because sessions are stateless, signing out removes the browser cookie but cannot revoke a copied cookie before expiry. Protect the deployment with HTTPS, choose a unique high-entropy secret, and use a suitably short lifetime for the deployment's risk level.

DayFront rejects cross-origin state-changing requests in login mode, applies dedicated login throttling, gives generic credential errors, and never returns or logs credentials. A session grants the same access as its CalDAV credentials; browser or host compromise remains outside DayFront's security boundary.

## Credential boundary

The CalDAV URL, username, password, and `Authorization` header exist only in the API process. External subscription URLs are also kept server-side because they may contain access tokens. The browser receives only public UI settings and calendar display metadata. Logs redact credentials and do not include configured subscription URLs or upstream response bodies.

Keep `config.yaml` readable only by the container/process account. It is ignored by Git and should be mounted read-only in containers. Never commit a copied configuration or an external `.ics` export.

## Reverse proxy

The reverse proxy should:

- terminate HTTPS and redirect HTTP to HTTPS;
- require authentication before forwarding any DayFront path, including `/api/v1`;
- preserve the request host and set `X-Forwarded-Proto` and `X-Forwarded-For`;
- apply a request-body limit no larger than DayFront's 1 MiB limit;
- avoid caching API responses containing calendar data.

Set `server.trustProxy: true` (or `DAYFRONT_SERVER_TRUST_PROXY=true`) only when DayFront is directly behind a trusted proxy that overwrites forwarded headers. Leave it false when clients can connect directly. Proxy trust affects client-IP mutation limits and HTTPS/HSTS detection.

DayFront does not enable cross-origin API access. Serve the frontend and API from the same origin. Browser security headers deny framing and restrict scripts, connections, forms, and resources to the DayFront origin.

## Upstream access

The configured CalDAV origin is fixed at startup. DayFront rejects cross-origin redirects and returned resource URLs. Browser-supplied opaque resource IDs must decode to normalized HTTP(S) `.ics` URLs without credentials, query strings, or fragments; the CalDAV client then enforces the configured origin.
