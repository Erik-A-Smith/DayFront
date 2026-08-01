import {
  calendarEventsResponseSchema,
  calendarTasksResponseSchema,
  calendarTaskResponseSchema,
  calendarEventResponseSchema,
  calendarResponseSchema,
  calendarsResponseSchema,
  healthResponseSchema,
  publicConfigSchema,
  type Calendar,
  type CalendarEvent,
  type CalendarMutation,
  type CalendarTask,
  type EventMutation,
  type TaskMutation,
  type HealthResponse,
} from '@dayfront/shared';

async function json(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? JSON.stringify(body)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/health', signal ? { signal } : undefined);

  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}

export async function getCalendars(signal?: AbortSignal): Promise<Calendar[]> {
  const response = await fetch(
    '/api/v1/calendars',
    signal ? { signal } : undefined,
  );
  return calendarsResponseSchema.parse(await json(response)).data;
}

export async function createCalendar(
  input: CalendarMutation,
): Promise<Calendar> {
  const response = await fetch('/api/v1/calendars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return calendarResponseSchema.parse(await json(response)).data;
}

export async function updateCalendar(
  id: string,
  input: CalendarMutation,
): Promise<Calendar> {
  const response = await fetch(`/api/v1/calendars/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return calendarResponseSchema.parse(await json(response)).data;
}

export async function deleteCalendar(id: string): Promise<void> {
  const response = await fetch(`/api/v1/calendars/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) await json(response);
}

export async function getPublicConfig() {
  const response = await fetch('/api/v1/config');
  return publicConfigSchema.parse(await json(response)).data;
}

export interface EventRange {
  start: Date;
  end: Date;
  calendarIds: readonly string[];
}

export async function getEvents(range: EventRange): Promise<CalendarEvent[]> {
  if (range.calendarIds.length === 0) return [];
  const query = new URLSearchParams({
    start: range.start.toISOString(),
    end: range.end.toISOString(),
  });
  range.calendarIds.forEach((id) => query.append('calendarId', id));
  const response = await fetch(`/api/v1/events?${query.toString()}`);
  return calendarEventsResponseSchema.parse(await json(response)).data;
}

export async function getTasks(range: EventRange): Promise<CalendarTask[]> {
  if (range.calendarIds.length === 0) return [];
  const query = new URLSearchParams({
    start: range.start.toISOString(),
    end: range.end.toISOString(),
  });
  range.calendarIds.forEach((id) => query.append('calendarId', id));
  const response = await fetch(`/api/v1/tasks?${query.toString()}`);
  return calendarTasksResponseSchema.parse(await json(response)).data;
}

export async function getTaskList(
  calendarIds: readonly string[],
  signal?: AbortSignal,
): Promise<CalendarTask[]> {
  if (calendarIds.length === 0) return [];
  const query = new URLSearchParams();
  calendarIds.forEach((id) => query.append('calendarId', id));
  const response = await fetch(
    `/api/v1/tasks?${query.toString()}`,
    signal ? { signal } : undefined,
  );
  return calendarTasksResponseSchema.parse(await json(response)).data;
}

export async function createTask(input: TaskMutation): Promise<CalendarTask> {
  const response = await fetch(
    `/api/v1/calendars/${encodeURIComponent(input.calendarId)}/tasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return calendarTaskResponseSchema.parse(await json(response)).data;
}

export async function updateTask(
  resourceId: string,
  version: string,
  input: TaskMutation,
): Promise<CalendarTask> {
  const response = await fetch(
    `/api/v1/tasks/${encodeURIComponent(resourceId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': version },
      body: JSON.stringify(input),
    },
  );
  return calendarTaskResponseSchema.parse(await json(response)).data;
}

export async function deleteTask(
  resourceId: string,
  version: string,
  occurrence?: { recurrenceId: string },
): Promise<void> {
  const query = occurrence
    ? `?${new URLSearchParams({ scope: 'occurrence', recurrenceId: occurrence.recurrenceId }).toString()}`
    : '';
  const response = await fetch(
    `/api/v1/tasks/${encodeURIComponent(resourceId)}${query}`,
    {
      method: 'DELETE',
      headers: { 'If-Match': version },
    },
  );
  if (!response.ok) await json(response);
}

export async function createEvent(
  input: EventMutation,
): Promise<CalendarEvent> {
  const response = await fetch(
    `/api/v1/calendars/${encodeURIComponent(input.calendarId)}/events`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return calendarEventResponseSchema.parse(await json(response)).data;
}

export async function updateEvent(
  resourceId: string,
  version: string,
  input: EventMutation,
): Promise<CalendarEvent> {
  const response = await fetch(
    `/api/v1/events/${encodeURIComponent(resourceId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': version },
      body: JSON.stringify(input),
    },
  );
  return calendarEventResponseSchema.parse(await json(response)).data;
}

export async function deleteEvent(
  resourceId: string,
  version: string,
  occurrence?: { recurrenceId: string },
): Promise<void> {
  const query = occurrence
    ? `?${new URLSearchParams({
        scope: 'occurrence',
        recurrenceId: occurrence.recurrenceId,
      }).toString()}`
    : '';
  const response = await fetch(
    `/api/v1/events/${encodeURIComponent(resourceId)}${query}`,
    {
      method: 'DELETE',
      headers: { 'If-Match': version },
    },
  );
  if (!response.ok) await json(response);
}
