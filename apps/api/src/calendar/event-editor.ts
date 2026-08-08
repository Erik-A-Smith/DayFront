import { randomUUID } from 'node:crypto';

import type { EventMutation } from '@dayfront/shared';
import ICAL from 'ical.js';

import { CalDavError } from '../caldav/errors.js';

function time(value: string, allDay: boolean): ICAL.Time {
  if (allDay) return ICAL.Time.fromDateString(value.slice(0, 10));
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'Event contains an invalid date-time.',
    );
  }
  return ICAL.Time.fromJSDate(date, true);
}

const weekDays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

function recurrenceRule(input: EventMutation): string | undefined {
  if (typeof input.recurrenceRule !== 'string') return undefined;
  if (!input.allDay || input.recurrenceRule.toUpperCase() !== 'FREQ=WEEKLY')
    return input.recurrenceRule;

  const date = new Date(`${input.start.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return input.recurrenceRule;
  return `FREQ=WEEKLY;BYDAY=${weekDays[date.getUTCDay()]}`;
}

function apply(event: ICAL.Event, input: EventMutation): void {
  event.summary = input.title;
  event.startDate = time(input.start, input.allDay);
  if (input.end) event.endDate = time(input.end, input.allDay);
  else event.component.removeProperty('dtend');
  if (input.description) event.description = input.description;
  else event.component.removeProperty('description');
  if (input.location) event.location = input.location;
  else event.component.removeProperty('location');
  if (typeof input.recurrenceRule === 'string') {
    try {
      event.component.updatePropertyWithValue(
        'rrule',
        ICAL.Recur.fromString(recurrenceRule(input) ?? input.recurrenceRule),
      );
    } catch (error: unknown) {
      throw new CalDavError(
        'CALDAV_PROTOCOL_ERROR',
        'The recurrence rule is invalid.',
        undefined,
        { cause: error },
      );
    }
  } else if (input.recurrenceRule === null) {
    event.component.removeAllProperties('rrule');
  }
  event.component.updatePropertyWithValue('dtstamp', ICAL.Time.now());
}

function parsedCalendar(source: string): ICAL.Component {
  // ical.js exposes its jCal parser result as `any` in its legacy declaration.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new ICAL.Component(ICAL.parse(source));
}

function masterEvent(calendar: ICAL.Component): ICAL.Event {
  const component = calendar
    .getAllSubcomponents('vevent')
    .find((item) => !item.hasProperty('recurrence-id'));
  if (!component) throw new Error('Master VEVENT was not found.');
  return new ICAL.Event(component);
}

function recurrenceTime(value: string): ICAL.Time {
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? ICAL.Time.fromDateString(value)
      : ICAL.Time.fromDateTimeString(value);
  } catch (error: unknown) {
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'The recurrence identifier is invalid.',
      undefined,
      { cause: error },
    );
  }
}

function removeRecurrence(component: ICAL.Component): void {
  for (const name of ['rrule', 'rdate', 'exdate'])
    component.removeAllProperties(name);
}

function occurrenceEvent(
  calendar: ICAL.Component,
  master: ICAL.Event,
  id: ICAL.Time,
): ICAL.Event {
  const existing = calendar
    .getAllSubcomponents('vevent')
    .find(
      (component) =>
        (
          component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
        )?.toString() === id.toString(),
    );
  if (existing) return new ICAL.Event(existing);

  const component = ICAL.Component.fromString(master.component.toString());
  removeRecurrence(component);
  component.updatePropertyWithValue('recurrence-id', id);
  calendar.addSubcomponent(component);
  return new ICAL.Event(component);
}

function seriesInput(master: ICAL.Event, input: EventMutation): EventMutation {
  if (!input.occurrenceStart) return input;
  const submittedStart = new Date(input.start).getTime();
  const openedStart = new Date(input.occurrenceStart).getTime();
  const masterStart = master.startDate.toJSDate().getTime();
  if (![submittedStart, openedStart, masterStart].every(Number.isFinite))
    return input;
  const shiftedStart = masterStart + submittedStart - openedStart;
  const duration = input.end
    ? new Date(input.end).getTime() - submittedStart
    : undefined;
  const dateValue = (milliseconds: number) =>
    input.allDay
      ? new Date(milliseconds).toISOString().slice(0, 10)
      : new Date(milliseconds).toISOString();
  return {
    ...input,
    start: dateValue(shiftedStart),
    ...(duration === undefined
      ? { end: undefined }
      : { end: dateValue(shiftedStart + duration) }),
  };
}

export function createEventData(input: EventMutation): string {
  const calendar = new ICAL.Component('vcalendar');
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//DayFront//CalDAV Client//EN');
  const component = new ICAL.Component('vevent');
  calendar.addSubcomponent(component);
  const event = new ICAL.Event(component);
  event.uid = randomUUID();
  apply(event, input);
  return calendar.toString();
}

export function updateEventData(source: string, input: EventMutation): string {
  try {
    const calendar = parsedCalendar(source);
    const master = masterEvent(calendar);
    if (input.recurrenceScope === 'occurrence' && input.recurrenceId) {
      const id = recurrenceTime(input.recurrenceId);
      const exception = occurrenceEvent(calendar, master, id);
      apply(exception, { ...input, recurrenceRule: null });
      exception.component.updatePropertyWithValue('recurrence-id', id);
    } else {
      apply(master, seriesInput(master, input));
    }
    return calendar.toString();
  } catch (error: unknown) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'The event resource could not be edited.',
      undefined,
      { cause: error },
    );
  }
}

export function deleteOccurrenceData(
  source: string,
  recurrenceId: string,
): string {
  try {
    const calendar = parsedCalendar(source);
    const master = masterEvent(calendar);
    const id = recurrenceTime(recurrenceId);
    for (const component of calendar.getAllSubcomponents('vevent')) {
      if (
        (
          component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
        )?.toString() === id.toString()
      ) {
        calendar.removeSubcomponent(component);
      }
    }
    master.component.addPropertyWithValue('exdate', id);
    master.component.updatePropertyWithValue('dtstamp', ICAL.Time.now());
    return calendar.toString();
  } catch (error: unknown) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'The recurring occurrence could not be deleted.',
      undefined,
      { cause: error },
    );
  }
}
