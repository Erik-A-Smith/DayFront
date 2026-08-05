# Changelog

All notable changes to DayFront are documented here.

## Unreleased

- Add backward-compatible multi-user login using each user's CalDAV credentials
- Add encrypted persistent sessions, manual logout, automatic reauthentication, origin validation, and dual login throttling
- Default new Unraid installations to multi-user login with an automatically generated persistent session secret
- Preserve legacy single-user behavior for existing installations and explicit configurations

## 1.0.0 - 2026-08-01

- CalDAV calendar discovery and calendar management
- Event and task creation, editing, deletion, recurrence, and drag-to-reschedule
- Recurring occurrence handling and task subtasks
- Read-only external iCalendar subscriptions configured through YAML
- Month, week, day, and agenda views with date-addressable URLs
- Configurable sidebar, light and dark themes, and timezone handling
- Docker images for AMD64 and ARM64 with Unraid deployment support
- Server-side credential handling with no application database or browser persistence
