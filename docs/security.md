# Security and reverse-proxy boundary

DayFront is a single-household/self-hosted CalDAV client. The initial release does not implement user accounts or browser login sessions. Anyone who can reach the DayFront web application can use the configured CalDAV account through DayFront. Place DayFront behind an authenticating reverse proxy unless it is reachable only from a trusted private network.

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
