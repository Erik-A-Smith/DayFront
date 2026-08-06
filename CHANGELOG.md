# Changelog

All notable changes to DayFront are documented here.

## Unreleased

## 1.3.0 - 2026-08-05

- Redesign DayFront with responsive frosted-glass light and dark themes across the calendar, sidebar, dialogs, controls, and login experience
- Improve calendar entry readability and responsive overflow behavior, including compact `+x more` summaries
- Add mobile swipe navigation, fullscreen and compact calendar controls, and correct drag positioning
- Polish task workflows, checkboxes, time-range correction, sidebar scrolling, and anchored account controls
- Start with the sidebar collapsed by default while preserving YAML, environment-variable, and Unraid overrides
- Add project support links and light/dark screenshot galleries

## 1.2.0 - 2026-08-05

- Add configurable 12-hour or 24-hour time display across calendar views and event/task time pickers ([#2](https://github.com/Erik-A-Smith/DayFront/issues/2))
- Expose the time-format setting through YAML, environment variables, and the stable and beta Unraid templates

## 1.1.0 - 2026-08-05

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
