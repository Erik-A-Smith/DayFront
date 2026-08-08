import {
  eventMutationSchema,
  calendarMutationSchema,
  taskMutationSchema,
  type Calendar,
  type CalendarEvent,
  type CalendarTask,
  type CalendarMutation,
  type EventMutation,
  type TaskMutation,
} from '@dayfront/shared';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';

import { CalDavClient } from '../caldav/client.js';
import { CalDavError } from '../caldav/errors.js';
import type { CalendarCollection } from '../caldav/types.js';
import { ApiError } from '../errors.js';
import {
  createEventData,
  deleteOccurrenceData,
  updateEventData,
} from './event-editor.js';
import { mapCalendarResource, resourceUrl } from './event-mapper.js';
import { mapTaskResource } from './task-mapper.js';
import {
  createTaskData,
  deleteTaskOccurrenceData,
  updateTaskData,
} from './task-editor.js';
import { CalendarSubscriptionService } from './subscriptions.js';

function mapError(error: unknown): ApiError {
  if (!(error instanceof CalDavError)) {
    return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
  const statuses: Record<string, number> = {
    AUTHENTICATION_FAILED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    VERSION_CONFLICT: 412,
    REQUEST_TIMEOUT: 504,
    CALDAV_UNAVAILABLE: 503,
    CALDAV_PROTOCOL_ERROR: 502,
  };
  return new ApiError(statuses[error.code] ?? 502, error.code, error.message);
}

function toCalendar(collection: CalendarCollection): Calendar {
  return {
    id: collection.id,
    displayName: collection.displayName,
    ...(collection.description ? { description: collection.description } : {}),
    ...(collection.color ? { color: collection.color } : {}),
    components: [...collection.components],
    readOnly: false,
  };
}

function dateQuery(value: unknown, name: string): Date {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_FAILED', `${name} is required.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      `${name} must be an RFC 3339 date-time.`,
    );
  }
  return date;
}

function selectedIds(value: unknown): Set<string> | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const ids = values.flatMap((item) =>
    typeof item === 'string' ? item.split(',').filter(Boolean) : [],
  );
  return new Set(ids);
}

function mutation(value: unknown): EventMutation {
  const result = eventMutationSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'The event could not be validated.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function calendarMutation(value: unknown): CalendarMutation {
  const result = calendarMutationSchema.safeParse(value);
  if (!result.success)
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'The calendar could not be validated.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  return result.data;
}

function taskMutation(value: unknown): TaskMutation {
  const result = taskMutationSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'The task could not be validated.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function matchVersion(value: string | undefined): string {
  if (!value) {
    throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match is required.');
  }
  return value;
}

export function calendarRouter(
  clientProvider: CalDavClient | ((request: Request) => CalDavClient),
  maxOccurrences = 5_000,
  subscriptions?: CalendarSubscriptionService,
): Router {
  const router = Router();
  const requestStorage = new AsyncLocalStorage<Request>();
  const clientFor =
    typeof clientProvider === 'function'
      ? (request: Request) => clientProvider(request)
      : () => clientProvider;
  const client = new Proxy({} as CalDavClient, {
    get(_target, property) {
      const request = requestStorage.getStore();
      if (!request)
        throw new Error('CalDAV client requested outside a request context.');
      // The method is immediately rebound to the request-specific instance.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const value = clientFor(request)[property as keyof CalDavClient];
      return typeof value === 'function'
        ? value.bind(clientFor(request))
        : value;
    },
  });
  router.use((request, _response, next) => requestStorage.run(request, next));

  router.get('/calendars', async (_request, response) => {
    try {
      const discovery = await client.discover();
      response.json({
        data: [
          ...discovery.calendars.map(toCalendar),
          ...(subscriptions?.calendars() ?? []),
        ],
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      throw mapError(error);
    }
  });

  router.post('/calendars', async (request, response) => {
    const input = calendarMutation(request.body);
    try {
      const discovery = await client.discover();
      const url = new URL(`${randomUUID()}/`, discovery.calendarHomeUrl).href;
      await client.createCalendar(discovery.calendarHomeUrl, url, input);
      const updated = await client.discover();
      const calendar = updated.calendars.find((item) => item.url === url);
      if (!calendar)
        throw new ApiError(
          502,
          'CALDAV_PROTOCOL_ERROR',
          'The created calendar was not returned by the CalDAV server.',
        );
      response.status(201).json({
        data: toCalendar(calendar),
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.put('/calendars/:calendarId', async (request, response) => {
    if (subscriptions?.isCalendar(request.params.calendarId))
      throw new ApiError(403, 'FORBIDDEN', 'External calendars are read-only.');
    const input = calendarMutation(request.body);
    try {
      const discovery = await client.discover();
      const current = discovery.calendars.find(
        (item) => item.id === request.params.calendarId,
      );
      if (!current)
        throw new ApiError(404, 'NOT_FOUND', 'Calendar was not found.');
      await client.updateCalendar(current.url, input);
      const updated = await client.discover();
      const calendar = updated.calendars.find(
        (item) => item.id === request.params.calendarId,
      );
      if (!calendar)
        throw new ApiError(404, 'NOT_FOUND', 'Calendar was not found.');
      response.json({
        data: toCalendar(calendar),
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.delete('/calendars/:calendarId', async (request, response) => {
    if (subscriptions?.isCalendar(request.params.calendarId))
      throw new ApiError(403, 'FORBIDDEN', 'External calendars are read-only.');
    try {
      const discovery = await client.discover();
      const calendar = discovery.calendars.find(
        (item) => item.id === request.params.calendarId,
      );
      if (!calendar)
        throw new ApiError(404, 'NOT_FOUND', 'Calendar was not found.');
      await client.deleteCalendar(calendar.url);
      response.status(204).send();
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.get('/events', async (request, response) => {
    const start = dateQuery(request.query.start, 'start');
    const end = dateQuery(request.query.end, 'end');
    const ids = selectedIds(request.query.calendarId);

    try {
      const discovery = await client.discover();
      const calendars = discovery.calendars.filter(
        (calendar) =>
          calendar.components.includes('VEVENT') &&
          (!ids || ids.has(calendar.id)),
      );
      const results = await Promise.allSettled(
        calendars.map(async (calendar) => {
          const resources = await client.queryCalendar(
            calendar.url,
            start,
            end,
          );
          return resources.flatMap((resource) =>
            mapCalendarResource(resource, calendar.id, {
              start,
              end,
              maxOccurrences,
            }),
          );
        }),
      );
      const events: CalendarEvent[] = [];
      const warnings: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') events.push(...result.value);
        else
          warnings.push(
            `Could not load ${calendars[index]?.displayName ?? 'calendar'}.`,
          );
      });
      const external = subscriptions
        ? await subscriptions.events(ids, start, end, maxOccurrences)
        : { events: [], warnings: [] };
      events.push(...external.events);
      warnings.push(...external.warnings);
      response.json({
        data: events,
        meta: {
          requestId: String(response.locals.requestId),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      });
    } catch (error: unknown) {
      throw mapError(error);
    }
  });

  router.get('/events/search', async (request, response) => {
    const query =
      typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (query.length < 2 || query.length > 200)
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'q must contain between 2 and 200 characters.',
      );
    const ids = selectedIds(request.query.calendarId);
    try {
      const discovery = await client.discover();
      const calendars = discovery.calendars.filter(
        (calendar) =>
          calendar.components.includes('VEVENT') &&
          (!ids || ids.has(calendar.id)),
      );
      const results = await Promise.allSettled(
        calendars.map(async (calendar) =>
          (await client.searchCalendar(calendar.url, query)).flatMap(
            (resource) => mapCalendarResource(resource, calendar.id),
          ),
        ),
      );
      const events = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );
      events.sort((left, right) => left.start.localeCompare(right.start));
      response.json({
        data: events,
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      throw mapError(error);
    }
  });

  router.get('/tasks', async (request, response) => {
    const hasRange =
      request.query.start !== undefined || request.query.end !== undefined;
    const start = hasRange
      ? dateQuery(request.query.start, 'start')
      : undefined;
    const end = hasRange ? dateQuery(request.query.end, 'end') : undefined;
    const ids = selectedIds(request.query.calendarId);
    const requestedStatus =
      typeof request.query.status === 'string'
        ? request.query.status.toLowerCase()
        : undefined;
    try {
      const discovery = await client.discover();
      const calendars = discovery.calendars.filter(
        (calendar) =>
          calendar.components.includes('VTODO') &&
          (!ids || ids.has(calendar.id)),
      );
      const results = await Promise.allSettled(
        calendars.map(async (calendar) => {
          const resources = await client.queryTasks(calendar.url, start, end);
          return resources.flatMap((resource) =>
            mapTaskResource(
              resource,
              calendar.id,
              start && end ? { start, end, maxOccurrences } : undefined,
            ),
          );
        }),
      );
      const tasks: CalendarTask[] = [];
      const warnings: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') tasks.push(...result.value);
        else
          warnings.push(
            `Could not load tasks from ${calendars[index]?.displayName ?? 'calendar'}.`,
          );
      });
      const filtered = requestedStatus
        ? tasks.filter((task) => task.status === requestedStatus)
        : tasks;
      response.json({
        data: filtered,
        meta: {
          requestId: String(response.locals.requestId),
          ...(warnings.length ? { warnings } : {}),
        },
      });
    } catch (error: unknown) {
      throw mapError(error);
    }
  });

  router.post('/calendars/:calendarId/events', async (request, response) => {
    if (subscriptions?.isCalendar(request.params.calendarId))
      throw new ApiError(403, 'FORBIDDEN', 'External calendars are read-only.');
    const input = mutation(request.body);
    if (input.calendarId !== request.params.calendarId) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'Calendar IDs do not match.',
      );
    }
    try {
      const discovery = await client.discover();
      const calendar = discovery.calendars.find(
        (item) => item.id === input.calendarId,
      );
      if (!calendar)
        throw new ApiError(404, 'NOT_FOUND', 'Calendar was not found.');
      const url = new URL(`${randomUUID()}.ics`, calendar.url).href;
      await client.putResource(url, createEventData(input));
      const resource = await client.getResource(url);
      const event = mapCalendarResource(resource, calendar.id)[0];
      if (!event)
        throw new ApiError(
          502,
          'CALDAV_PROTOCOL_ERROR',
          'Created event was not returned.',
        );
      response.status(201).json({
        data: event,
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.post('/calendars/:calendarId/tasks', async (request, response) => {
    if (subscriptions?.isCalendar(request.params.calendarId))
      throw new ApiError(403, 'FORBIDDEN', 'External calendars are read-only.');
    const input = taskMutation(request.body);
    if (input.calendarId !== request.params.calendarId)
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'Calendar IDs do not match.',
      );
    try {
      const discovery = await client.discover();
      const calendar = discovery.calendars.find(
        (item) =>
          item.id === input.calendarId && item.components.includes('VTODO'),
      );
      if (!calendar)
        throw new ApiError(404, 'NOT_FOUND', 'Task calendar was not found.');
      const url = new URL(`${randomUUID()}.ics`, calendar.url).href;
      await client.putResource(url, createTaskData(input));
      const resource = await client.getResource(url);
      const task = mapTaskResource(resource, calendar.id)[0];
      if (!task)
        throw new ApiError(
          502,
          'CALDAV_PROTOCOL_ERROR',
          'Created task was not returned.',
        );
      response.status(201).json({
        data: task,
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.get('/tasks/:resourceId', async (request, response) => {
    const calendarId = request.query.calendarId;
    if (typeof calendarId !== 'string') {
      throw new ApiError(400, 'VALIDATION_FAILED', 'calendarId is required.');
    }
    try {
      const resource = await client.getResource(
        resourceUrl(request.params.resourceId),
      );
      const task = mapTaskResource(resource, calendarId)[0];
      if (!task) throw new ApiError(404, 'NOT_FOUND', 'Task was not found.');
      response.json({
        data: task,
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.put('/tasks/:resourceId', async (request, response) => {
    const input = taskMutation(request.body);
    const version = matchVersion(request.header('if-match'));
    try {
      const url = resourceUrl(request.params.resourceId);
      const current = await client.getResource(url);
      const discovery = await client.discover();
      const source = [...discovery.calendars]
        .sort((left, right) => right.url.length - left.url.length)
        .find((calendar) => url.startsWith(calendar.url));
      const target = discovery.calendars.find(
        (calendar) =>
          calendar.id === input.calendarId &&
          calendar.components.includes('VTODO'),
      );
      if (!source || !target)
        throw new ApiError(404, 'NOT_FOUND', 'Task calendar was not found.');
      const moving = source.id !== target.id;
      if (moving && input.recurrenceScope === 'occurrence')
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          'A single recurring occurrence cannot be moved to another calendar.',
        );
      const updatedData = updateTaskData(current.calendarData, input);
      const updatedUrl = moving
        ? new URL(`${randomUUID()}.ics`, target.url).href
        : url;
      await client.putResource(
        updatedUrl,
        updatedData,
        moving ? undefined : version,
      );
      const updated = await client.getResource(updatedUrl);
      if (moving) {
        try {
          await client.deleteResource(url, version);
        } catch (error: unknown) {
          await client
            .deleteResource(updatedUrl, updated.etag)
            .catch(() => undefined);
          throw error;
        }
      }
      const task = mapTaskResource(updated, input.calendarId)[0];
      if (!task) throw new ApiError(404, 'NOT_FOUND', 'Task was not found.');
      response.json({
        data: task,
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.delete('/tasks/:resourceId', async (request, response) => {
    const version = matchVersion(request.header('if-match'));
    try {
      const url = resourceUrl(request.params.resourceId);
      if (request.query.scope === 'occurrence') {
        const recurrenceId = request.query.recurrenceId;
        if (typeof recurrenceId !== 'string')
          throw new ApiError(
            400,
            'VALIDATION_FAILED',
            'recurrenceId is required for occurrence deletion.',
          );
        const current = await client.getResource(url);
        await client.putResource(
          url,
          deleteTaskOccurrenceData(current.calendarData, recurrenceId),
          version,
        );
      } else {
        await client.deleteResource(url, version);
      }
      response.status(204).send();
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.get('/events/:resourceId', async (request, response) => {
    const calendarId = request.query.calendarId;
    if (typeof calendarId !== 'string') {
      throw new ApiError(400, 'VALIDATION_FAILED', 'calendarId is required.');
    }
    try {
      const resource = await client.getResource(
        resourceUrl(request.params.resourceId),
      );
      const event = mapCalendarResource(resource, calendarId)[0];
      if (!event) throw new ApiError(404, 'NOT_FOUND', 'Event was not found.');
      response.json({
        data: event,
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.put('/events/:resourceId', async (request, response) => {
    const input = mutation(request.body);
    const version = matchVersion(request.header('if-match'));
    try {
      const url = resourceUrl(request.params.resourceId);
      const current = await client.getResource(url);
      const discovery = await client.discover();
      const source = [...discovery.calendars]
        .sort((left, right) => right.url.length - left.url.length)
        .find((calendar) => url.startsWith(calendar.url));
      const target = discovery.calendars.find(
        (calendar) =>
          calendar.id === input.calendarId &&
          calendar.components.includes('VEVENT'),
      );
      if (!source || !target)
        throw new ApiError(404, 'NOT_FOUND', 'Event calendar was not found.');
      const moving = source.id !== target.id;
      if (moving && input.recurrenceScope === 'occurrence')
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          'A single recurring occurrence cannot be moved to another calendar.',
        );
      const updatedData = updateEventData(current.calendarData, input);
      const updatedUrl = moving
        ? new URL(`${randomUUID()}.ics`, target.url).href
        : url;
      await client.putResource(
        updatedUrl,
        updatedData,
        moving ? undefined : version,
      );
      const updated = await client.getResource(updatedUrl);
      if (moving) {
        try {
          await client.deleteResource(url, version);
        } catch (error: unknown) {
          await client
            .deleteResource(updatedUrl, updated.etag)
            .catch(() => undefined);
          throw error;
        }
      }
      const event = mapCalendarResource(updated, input.calendarId)[0];
      if (!event) throw new ApiError(404, 'NOT_FOUND', 'Event was not found.');
      response.json({
        data: event,
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  router.delete('/events/:resourceId', async (request, response) => {
    const version = matchVersion(request.header('if-match'));
    try {
      const url = resourceUrl(request.params.resourceId);
      if (request.query.scope === 'occurrence') {
        const recurrenceId = request.query.recurrenceId;
        if (typeof recurrenceId !== 'string') {
          throw new ApiError(
            400,
            'VALIDATION_FAILED',
            'recurrenceId is required for occurrence deletion.',
          );
        }
        const current = await client.getResource(url);
        await client.putResource(
          url,
          deleteOccurrenceData(current.calendarData, recurrenceId),
          version,
        );
      } else {
        await client.deleteResource(url, version);
      }
      response.status(204).send();
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw mapError(error);
    }
  });

  return router;
}
