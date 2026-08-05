# Docker, Compose, and Unraid deployment

DayFront serves the API and compiled web application from one container on port 8080. It stores no calendar data locally; its only persistent input is the YAML configuration containing the CalDAV connection.

## Build and run with Docker

```sh
docker build -t dayfront:local .
docker run -d --name dayfront \
  --restart unless-stopped \
  --security-opt no-new-privileges=true \
  -p 8080:8080 \
  -e TZ=UTC \
  -e DAYFRONT_CALENDAR_TIMEZONE=local \
  -v "$PWD/config.yaml:/config/config.yaml:ro" \
  dayfront:local
```

Open `http://localhost:8080/` and confirm `http://localhost:8080/health` returns status `ok`. The image runs as the unprivileged `node` account, has a built-in health check, and handles SIGTERM gracefully.

## Docker Compose

Copy `config.example.yaml` to `config.yaml`, set the CalDAV URL and credentials, then run:

```sh
docker compose up -d --build dayfront
docker compose ps
```

## Configuration and environment variables

Mount the YAML file at `/config/config.yaml`, which is the image's optional default configuration path. Alternatively, omit the mount and provide all required settings through environment variables. Every YAML value can be overridden with its documented environment variable:

- `DAYFRONT_CALDAV_URL`, `DAYFRONT_CALDAV_USERNAME`, `DAYFRONT_CALDAV_PASSWORD`, `DAYFRONT_CALDAV_TIMEOUT_MS`
- `DAYFRONT_AUTH_MODE`, `DAYFRONT_AUTH_SESSION_SECRET`, `DAYFRONT_AUTH_SESSION_SECRET_FILE`, `DAYFRONT_AUTH_SESSION_TTL_HOURS`
- `DAYFRONT_SERVER_HOST`, `DAYFRONT_SERVER_PORT`, `DAYFRONT_SERVER_TRUST_PROXY`
- `DAYFRONT_UI_DEFAULT_VIEW`, `DAYFRONT_UI_DARK_MODE`, `DAYFRONT_UI_DEFAULT_CALENDAR`
- `DAYFRONT_UI_SIDEBAR_ENABLED`, `DAYFRONT_UI_SIDEBAR_DEFAULT_OPEN`, `DAYFRONT_UI_SIDEBAR_SHOW_BRAND`, `DAYFRONT_UI_SIDEBAR_SHOW_TASKS`, `DAYFRONT_UI_SIDEBAR_SHOW_CALENDARS`
- `DAYFRONT_CALENDAR_TIMEZONE`, `DAYFRONT_CALENDAR_WEEK_STARTS_ON`, `DAYFRONT_CALENDAR_MAX_OCCURRENCES`
- `DAYFRONT_LOG_LEVEL`, `DAYFRONT_LOG_FORMAT`

`TZ` controls the container's system timezone, including timestamps written to logs. It defaults to `UTC` in the Compose and Unraid templates.

The default `DAYFRONT_AUTH_MODE=single-user` requires the configured CalDAV username and password and preserves legacy behavior. For multi-user access, set `DAYFRONT_AUTH_MODE=caldav-login` and omit the shared username/password. Provide either a unique high-entropy `DAYFRONT_AUTH_SESSION_SECRET` of at least 32 characters or a writable `DAYFRONT_AUTH_SESSION_SECRET_FILE`; DayFront creates the latter securely when it does not exist. Keep the secret or file stable to preserve sessions across restarts. `DAYFRONT_AUTH_SESSION_TTL_HOURS` defaults to 720 (30 days). See [security.md](security.md) before exposing the login page externally.

`DAYFRONT_CALENDAR_TIMEZONE` overrides `calendar.timezone`. Use `local` to display values in each browser's timezone, `UTC` for a fixed UTC display, or an IANA timezone such as `America/Toronto` or `Europe/Berlin`. When using a fixed IANA timezone, setting `TZ` to the same value keeps container logs and calendar behavior easier to compare.

External iCalendar feeds are configured only in YAML under
`calendar_subscriptions`; there is no environment-variable equivalent for the
list. DayFront fetches enabled feeds on the server, caches them in memory for
their `refresh_interval`, and presents them as read-only calendars. Feed state
is not written to the configured CalDAV server, a database, or browser storage. See
`config.example.yaml` for the complete entry format.

## Unraid

1. Add the stable template from `unraid/dayfront.xml` and enter the CalDAV URL and shared credentials.
2. Confirm the port and timezone settings, then start the container.
3. Unraid downloads the public `ghcr.io/erik-a-smith/dayfront:latest` image; no local source checkout or image build is required.
4. Open the WebUI link and verify `/health`.

The stable template remains compatible with the currently published `:latest` image and uses legacy `single-user` mode. Existing installations without an Authentication Mode field continue using that mode and retain the shared CalDAV credentials stored in their local container template.

For advanced settings and external calendar subscriptions, create `/mnt/user/appdata/dayfront/config.yaml` from `config.example.yaml` and keep the optional read-only `/config` mapping. Environment values entered in the Unraid form take precedence over equivalent YAML values. Structured `calendar_subscriptions` remain YAML-only.

### Unraid beta

Use `unraid/dayfront-beta.xml` to test the pre-release `ghcr.io/erik-a-smith/dayfront:beta` image. It defaults to port 8081 and `/mnt/user/appdata/dayfront-beta` so it can run alongside stable without sharing session data. Enter only the CalDAV URL for the default multi-user flow; DayFront generates and persists the session secret automatically.

The beta image tracks `main`. After beta validation, publish the compatible application as `:latest` before changing the stable template to multi-user defaults.

## Reverse proxy

Proxy the complete origin, including `/api/v1`, to port 8080. Require authentication at the proxy, disable API caching, and forward `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`. Set `DAYFRONT_SERVER_TRUST_PROXY=true` only if direct client access to DayFront is blocked. See [security.md](security.md) for the complete trust boundary.

## Smoke test

```sh
docker inspect --format '{{.State.Health.Status}}' dayfront
curl --fail http://127.0.0.1:8080/health
curl --fail http://127.0.0.1:8080/ | grep '<div id="root">'
```

Then discover calendars in the UI and create/delete a temporary event and task in a dedicated test calendar.
