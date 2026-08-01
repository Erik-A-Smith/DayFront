import { createHash } from 'node:crypto';

import type { CalendarEvent } from '@dayfront/shared';
import ICAL from 'ical.js';

import { CalDavError } from '../caldav/errors.js';
import type { CalendarResource } from '../caldav/types.js';

export interface ExpansionRange {
  start: Date;
  end: Date;
  maxOccurrences: number;
}

function dateValue(time: ICAL.Time): string {
  return time.isDate
    ? time.toString().slice(0, 10)
    : time.toJSDate().toISOString();
}

function recurrenceRule(event: ICAL.Event): string | undefined {
  const property = event.component.getFirstProperty('rrule');
  if (!property) return undefined;
  const value: unknown = property.getFirstValue();
  return value instanceof ICAL.Recur ? value.toString() : undefined;
}

function intersects(
  start: ICAL.Time,
  end: ICAL.Time,
  range: ExpansionRange,
): boolean {
  return start.toJSDate() < range.end && end.toJSDate() > range.start;
}

function isCancelled(event: ICAL.Event): boolean {
  const status: unknown = event.component.getFirstPropertyValue('status');
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED';
}

function mappedEvent(
  resource: CalendarResource,
  calendarId: string,
  event: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  recurrenceId?: ICAL.Time,
  seriesEvent: ICAL.Event = event,
): CalendarEvent {
  const resourceId = Buffer.from(resource.url).toString('base64url');
  const identity = recurrenceId?.toString() ?? start.toString();
  const id = createHash('sha256')
    .update(`${resource.url}\0${event.uid}\0${identity}`)
    .digest('base64url')
    .slice(0, 30);
  const rule = recurrenceRule(seriesEvent);
  return {
    id,
    resourceId,
    calendarId,
    uid: event.uid,
    title: event.summary || '(untitled)',
    start: dateValue(start),
    end: dateValue(end),
    allDay: start.isDate,
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    version: resource.etag,
    entryType: 'event',
    recurring: seriesEvent.isRecurring() || event.isRecurrenceException(),
    readOnly: false,
    ...(recurrenceId ? { recurrenceId: recurrenceId.toString() } : {}),
    ...(rule ? { recurrenceRule: rule } : {}),
  };
}

export function mapCalendarResource(
  resource: CalendarResource,
  calendarId: string,
  range?: ExpansionRange,
): CalendarEvent[] {
  try {
    // ical.js exposes its jCal parser result as `any` in its legacy declaration.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const calendar = new ICAL.Component(ICAL.parse(resource.calendarData));
    const components = calendar.getAllSubcomponents('vevent');
    const masters = components
      .map((component) => new ICAL.Event(component))
      .filter((event) => !event.isRecurrenceException());
    const exceptions = components
      .map((component) => new ICAL.Event(component))
      .filter((event) => event.isRecurrenceException());

    return masters.flatMap((event): CalendarEvent[] => {
      if (!event.uid || !event.startDate)
        throw new Error('VEVENT is missing UID or DTSTART.');
      if (!range || !event.isRecurring()) {
        if (range && !intersects(event.startDate, event.endDate, range))
          return [];
        return [
          mappedEvent(
            resource,
            calendarId,
            event,
            event.startDate,
            event.endDate,
          ),
        ];
      }

      const output: CalendarEvent[] = [];
      const iterator = event.iterator();
      let occurrence: ICAL.Time | null;
      while ((occurrence = iterator.next())) {
        if (occurrence.toJSDate() >= range.end) break;
        if (occurrence.toJSDate() < range.start) continue;
        // The ical.js declaration exposes occurrence details as `any`.
        const details = event.getOccurrenceDetails(occurrence) as {
          item: ICAL.Event;
          recurrenceId: ICAL.Time;
          startDate: ICAL.Time;
          endDate: ICAL.Time;
        };
        if (
          !isCancelled(details.item) &&
          intersects(details.startDate, details.endDate, range)
        ) {
          output.push(
            mappedEvent(
              resource,
              calendarId,
              details.item,
              details.startDate,
              details.endDate,
              details.recurrenceId,
              event,
            ),
          );
        }
        if (output.length > range.maxOccurrences) {
          throw new CalDavError(
            'CALDAV_PROTOCOL_ERROR',
            'Recurring event exceeds the configured occurrence limit.',
          );
        }
      }
      for (const exception of exceptions.filter(
        (item) => item.uid === event.uid && !isCancelled(item),
      )) {
        if (!intersects(exception.startDate, exception.endDate, range))
          continue;
        const mapped = mappedEvent(
          resource,
          calendarId,
          exception,
          exception.startDate,
          exception.endDate,
          exception.recurrenceId,
          event,
        );
        if (!output.some((item) => item.id === mapped.id)) output.push(mapped);
      }
      output.sort((left, right) => left.start.localeCompare(right.start));
      return output;
    });
  } catch (error: unknown) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'A calendar resource contains invalid event data.',
      undefined,
      { cause: error },
    );
  }
}

export function resourceUrl(resourceId: string): string {
  try {
    if (resourceId.length > 5_500) throw new Error('Identifier is too long.');
    const value = Buffer.from(resourceId, 'base64url').toString('utf8');
    if (!URL.canParse(value) || value.length > 4_096)
      throw new Error('Invalid URL.');
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.pathname.toLowerCase().endsWith('.ics') ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid calendar resource URL.');
    return url.href;
  } catch {
    throw new CalDavError(
      'NOT_FOUND',
      'The requested event resource was not found.',
      404,
    );
  }
}
