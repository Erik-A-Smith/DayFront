# Contributing to DayFront

DayFront favors small, readable changes and standards-compliant CalDAV behavior.

## Development workflow

1. Work on one numbered item from `todo.md` at a time when practical.
2. Add or update tests with behavior changes.
3. Run formatting, linting, type-checking, unit tests, and the production build before submitting a change.
4. Use the CalDAV integration suite for changes involving discovery, WebDAV, iCalendar serialization, ETags, or recurrence.
5. Update the foundation or user documentation when a public contract changes.

The exact commands will be added during application scaffolding and exposed as root pnpm scripts. Generated files and formatter output should be produced by project scripts rather than edited manually.

## Code conventions

- Use TypeScript strict mode; avoid `any`. Narrow `unknown` at system boundaries.
- Prefer named types and small modules over clever abstractions.
- Use ECMAScript modules and explicit imports.
- Keep API DTOs and their runtime validation schemas in `packages/shared`.
- Keep CalDAV, iCalendar, credential, and recurrence logic in `apps/api`.
- Never log secrets, authorization headers, complete configuration objects, or raw calendar bodies.
- Treat dates, date-times, and timezones as distinct domain values; do not parse date-only values through JavaScript `Date`.
- Preserve unknown iCalendar properties when updating an existing resource.
- Include accessible labels, keyboard behavior, focus handling, and mobile layout in UI work.

Formatting and import order are enforced by the repository formatter. Lint rules and the formatter are authoritative; contributors should not hand-format around them.

## Tests

- Unit tests sit beside the source they exercise.
- Shared CalDAV XML and iCalendar examples belong in `tests/fixtures` and must contain no real credentials or private calendar data.
- Every bug fix should include a regression test.
- Recurrence tests should use explicit expected occurrences and cover timezone or daylight-saving behavior where relevant.
- Network tests must be deterministic. External CalDAV instances are opt-in and must not be required by the standard test suite.

## Commits

Use imperative, focused commit subjects of at most 72 characters. Conventional Commit prefixes are required:

```text
feat: add calendar discovery endpoint
fix: retain timezone on recurring exceptions
docs: define event range semantics
test: cover stale ETag updates
chore: configure workspace linting
```

Use `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, or `chore`. Breaking public-contract changes add `!` and explain the migration in the commit body.

Do not mix unrelated refactors with feature or bug-fix commits. Do not commit credentials, `.env` files, private calendar exports, generated coverage, dependency directories, or build output.

## Contract changes

Changes to the REST API, configuration keys, calendar semantics, supported platforms, or repository boundaries require a matching update to `docs/foundation.md`. Compatibility and migration impact should be stated in the change description.
