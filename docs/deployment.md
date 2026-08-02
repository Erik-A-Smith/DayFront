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
- `DAYFRONT_SERVER_HOST`, `DAYFRONT_SERVER_PORT`, `DAYFRONT_SERVER_TRUST_PROXY`
- `DAYFRONT_UI_DEFAULT_VIEW`, `DAYFRONT_UI_DARK_MODE`, `DAYFRONT_UI_DEFAULT_CALENDAR`
- `DAYFRONT_UI_SIDEBAR_ENABLED`, `DAYFRONT_UI_SIDEBAR_DEFAULT_OPEN`, `DAYFRONT_UI_SIDEBAR_SHOW_BRAND`, `DAYFRONT_UI_SIDEBAR_SHOW_TASKS`, `DAYFRONT_UI_SIDEBAR_SHOW_CALENDARS`
- `DAYFRONT_CALENDAR_TIMEZONE`, `DAYFRONT_CALENDAR_WEEK_STARTS_ON`, `DAYFRONT_CALENDAR_MAX_OCCURRENCES`
- `DAYFRONT_LOG_LEVEL`, `DAYFRONT_LOG_FORMAT`

`TZ` controls the container's system timezone, including timestamps written to logs. It defaults to `UTC` in the Compose and Unraid templates.

`DAYFRONT_CALENDAR_TIMEZONE` overrides `calendar.timezone`. Use `local` to display values in each browser's timezone, `UTC` for a fixed UTC display, or an IANA timezone such as `America/Toronto` or `Europe/Berlin`. When using a fixed IANA timezone, setting `TZ` to the same value keeps container logs and calendar behavior easier to compare.

External iCalendar feeds are configured only in YAML under
`calendar_subscriptions`; there is no environment-variable equivalent for the
list. DayFront fetches enabled feeds on the server, caches them in memory for
their `refresh_interval`, and presents them as read-only calendars. Feed state
is not written to the configured CalDAV server, a database, or browser storage. See
`config.example.yaml` for the complete entry format.

## Unraid

1. Create `/mnt/user/appdata/dayfront/config.yaml` from `config.example.yaml`.
2. Add the template from `unraid/dayfront.xml`, confirm the read-only configuration-directory path and port, and start the container.
3. Unraid downloads the public `ghcr.io/erik-a-smith/dayfront:latest` image; no local source checkout or image build is required.
4. Open the WebUI link and verify `/health`.

The checked-in template tracks the latest stable versioned release. The separate `ghcr.io/erik-a-smith/dayfront:beta` image tracks `main` for pre-release testing.

## Reverse proxy

Proxy the complete origin, including `/api/v1`, to port 8080. Require authentication at the proxy, disable API caching, and forward `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`. Set `DAYFRONT_SERVER_TRUST_PROXY=true` only if direct client access to DayFront is blocked. See [security.md](security.md) for the complete trust boundary.

## Smoke test

```sh
docker inspect --format '{{.State.Health.Status}}' dayfront
curl --fail http://127.0.0.1:8080/health
curl --fail http://127.0.0.1:8080/ | grep '<div id="root">'
```

Then discover calendars in the UI and create/delete a temporary event and task in a dedicated test calendar.
