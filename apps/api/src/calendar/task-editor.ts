import { randomUUID } from 'node:crypto';

import type { TaskMutation } from '@dayfront/shared';
import ICAL from 'ical.js';

import { CalDavError } from '../caldav/errors.js';

function taskTime(value: string, allDay: boolean): ICAL.Time {
  if (allDay) return ICAL.Time.fromDateString(value.slice(0, 10));
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid task date-time.');
  return ICAL.Time.fromJSDate(date, true);
}

function apply(component: ICAL.Component, input: TaskMutation): void {
  component.updatePropertyWithValue('summary', input.title);
  const effectiveStart =
    input.start ??
    (typeof input.recurrenceRule === 'string' ? input.due : undefined);
  if (effectiveStart)
    component.updatePropertyWithValue(
      'dtstart',
      taskTime(effectiveStart, input.allDay),
    );
  else component.removeAllProperties('dtstart');
  if (input.due)
    component.updatePropertyWithValue('due', taskTime(input.due, input.allDay));
  else component.removeAllProperties('due');
  if (input.description)
    component.updatePropertyWithValue('description', input.description);
  else component.removeAllProperties('description');
  component.updatePropertyWithValue('status', input.status.toUpperCase());
  component.updatePropertyWithValue('priority', input.priority);
  if (input.status === 'completed') {
    component.updatePropertyWithValue('completed', ICAL.Time.now());
    component.updatePropertyWithValue('percent-complete', 100);
  } else {
    component.removeAllProperties('completed');
    component.removeAllProperties('percent-complete');
  }
  if (typeof input.recurrenceRule === 'string') {
    component.updatePropertyWithValue(
      'rrule',
      ICAL.Recur.fromString(input.recurrenceRule),
    );
  } else if (input.recurrenceRule === null) {
    component.removeAllProperties('rrule');
  }
  if (input.parentUid !== undefined) {
    for (const property of component.getAllProperties('related-to')) {
      const relation: unknown = property.getParameter('reltype');
      if (
        relation === undefined ||
        (typeof relation === 'string' && relation.toLowerCase() === 'parent')
      )
        component.removeProperty(property);
    }
    if (input.parentUid) {
      const property = new ICAL.Property('related-to');
      property.setParameter('reltype', 'PARENT');
      property.setValue(input.parentUid);
      component.addProperty(property);
    }
  }
  component.updatePropertyWithValue('dtstamp', ICAL.Time.now());
}

function masterInput(
  component: ICAL.Component,
  input: TaskMutation,
): TaskMutation {
  if (!input.recurrenceId || !input.occurrenceStart) return input;
  const submittedAnchor = input.start ?? input.due;
  if (!submittedAnchor) return input;
  const submitted = new Date(submittedAnchor).getTime();
  const opened = new Date(input.occurrenceStart).getTime();
  if (!Number.isFinite(submitted) || !Number.isFinite(opened)) return input;
  const delta = submitted - opened;
  const shifted = (name: 'dtstart' | 'due'): string | undefined => {
    const value: unknown = component.getFirstPropertyValue(name);
    if (!(value instanceof ICAL.Time)) return undefined;
    const milliseconds = value.toJSDate().getTime() + delta;
    return input.allDay
      ? new Date(milliseconds).toISOString().slice(0, 10)
      : new Date(milliseconds).toISOString();
  };
  const start = shifted('dtstart');
  const due = shifted('due');
  return {
    ...input,
    ...(start ? { start } : { start: undefined }),
    ...(due ? { due } : { due: undefined }),
  };
}

function parsedCalendar(source: string): ICAL.Component {
  // ical.js exposes its jCal parser result as `any` in its legacy declaration.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new ICAL.Component(ICAL.parse(source));
}

function masterTask(calendar: ICAL.Component): ICAL.Component {
  const component = calendar
    .getAllSubcomponents('vtodo')
    .find((item) => !item.hasProperty('recurrence-id'));
  if (!component) throw new Error('Master VTODO was not found.');
  return component;
}

function recurrenceTime(value: string): ICAL.Time {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? ICAL.Time.fromDateString(value)
    : ICAL.Time.fromDateTimeString(value);
}

function componentRecurrenceId(component: ICAL.Component): string | undefined {
  const value: unknown = component.getFirstPropertyValue('recurrence-id');
  return value instanceof ICAL.Time ? value.toString() : undefined;
}

function occurrenceTask(
  calendar: ICAL.Component,
  master: ICAL.Component,
  id: ICAL.Time,
): ICAL.Component {
  const existing = calendar
    .getAllSubcomponents('vtodo')
    .find((component) => componentRecurrenceId(component) === id.toString());
  if (existing) return existing;
  const component = ICAL.Component.fromString(master.toString());
  for (const name of ['rrule', 'rdate', 'exdate'])
    component.removeAllProperties(name);
  component.updatePropertyWithValue('recurrence-id', id);
  calendar.addSubcomponent(component);
  return component;
}

export function createTaskData(input: TaskMutation): string {
  try {
    const calendar = new ICAL.Component('vcalendar');
    calendar.updatePropertyWithValue('version', '2.0');
    calendar.updatePropertyWithValue(
      'prodid',
      '-//DayFront//CalDAV Client//EN',
    );
    const component = new ICAL.Component('vtodo');
    component.updatePropertyWithValue('uid', randomUUID());
    calendar.addSubcomponent(component);
    apply(component, masterInput(component, input));
    return calendar.toString();
  } catch (error: unknown) {
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'The task could not be created.',
      undefined,
      { cause: error },
    );
  }
}

export function updateTaskData(source: string, input: TaskMutation): string {
  try {
    const calendar = parsedCalendar(source);
    const master = masterTask(calendar);
    if (input.recurrenceScope === 'occurrence' && input.recurrenceId) {
      const id = recurrenceTime(input.recurrenceId);
      const exception = occurrenceTask(calendar, master, id);
      apply(exception, { ...input, recurrenceRule: null });
      exception.updatePropertyWithValue('recurrence-id', id);
    } else {
      apply(master, masterInput(master, input));
    }
    return calendar.toString();
  } catch (error: unknown) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'The task resource could not be edited.',
      undefined,
      { cause: error },
    );
  }
}

export function deleteTaskOccurrenceData(
  source: string,
  occurrenceId: string,
): string {
  try {
    const calendar = parsedCalendar(source);
    const master = masterTask(calendar);
    const id = recurrenceTime(occurrenceId);
    for (const component of calendar.getAllSubcomponents('vtodo')) {
      if (componentRecurrenceId(component) === id.toString())
        calendar.removeSubcomponent(component);
    }
    master.addPropertyWithValue('exdate', id);
    master.updatePropertyWithValue('dtstamp', ICAL.Time.now());
    return calendar.toString();
  } catch (error: unknown) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'The recurring task occurrence could not be deleted.',
      undefined,
      { cause: error },
    );
  }
}
