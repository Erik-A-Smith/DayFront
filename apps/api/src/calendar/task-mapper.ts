import { createHash } from 'node:crypto';

import type { CalendarTask } from '@dayfront/shared';
import ICAL from 'ical.js';

import { CalDavError } from '../caldav/errors.js';
import type { CalendarResource } from '../caldav/types.js';

export interface TaskExpansionRange {
  start: Date;
  end: Date;
  maxOccurrences: number;
}

function timeValue(value: unknown): string | undefined {
  if (!(value instanceof ICAL.Time)) return undefined;
  return value.isDate
    ? value.toString().slice(0, 10)
    : value.toJSDate().toISOString();
}

function textValue(
  component: ICAL.Component,
  name: string,
): string | undefined {
  const value: unknown = component.getFirstPropertyValue(name);
  return typeof value === 'string' && value ? value : undefined;
}

function recurrenceRule(component: ICAL.Component): string | undefined {
  const value: unknown = component.getFirstPropertyValue('rrule');
  return value instanceof ICAL.Recur ? value.toString() : undefined;
}

function componentRecurrenceId(
  component: ICAL.Component,
): ICAL.Time | undefined {
  const value: unknown = component.getFirstPropertyValue('recurrence-id');
  return value instanceof ICAL.Time ? value : undefined;
}

function taskRelationships(component: ICAL.Component): {
  parentUid?: string;
  childUids?: string[];
} {
  let parentUid: string | undefined;
  const childUids: string[] = [];
  for (const property of component.getAllProperties('related-to')) {
    const value: unknown = property.getFirstValue();
    if (typeof value !== 'string' || !value) continue;
    const parameter: unknown = property.getParameter('reltype');
    const relationship =
      typeof parameter === 'string' ? parameter.toLowerCase() : 'parent';
    if (relationship === 'parent' && !parentUid) parentUid = value;
    if (relationship === 'child') childUids.push(value);
  }
  return {
    ...(parentUid ? { parentUid } : {}),
    ...(childUids.length > 0 ? { childUids } : {}),
  };
}

function mappedTask(
  resource: CalendarResource,
  calendarId: string,
  component: ICAL.Component,
  startValue?: ICAL.Time,
  dueValue?: ICAL.Time,
  recurrenceId?: ICAL.Time,
  seriesRule?: string,
): CalendarTask {
  const uid = textValue(component, 'uid');
  if (!uid) throw new Error('VTODO is missing UID.');
  const statusValue = textValue(component, 'status')?.toLowerCase();
  const status =
    statusValue === 'in-process' ||
    statusValue === 'completed' ||
    statusValue === 'cancelled'
      ? statusValue
      : 'needs-action';
  const completedAt = timeValue(component.getFirstPropertyValue('completed'));
  const priorityValue: unknown = component.getFirstPropertyValue('priority');
  const priority =
    typeof priorityValue === 'number' &&
    Number.isInteger(priorityValue) &&
    priorityValue >= 0 &&
    priorityValue <= 9
      ? priorityValue
      : 0;
  const rule = seriesRule ?? recurrenceRule(component);
  const identity = recurrenceId?.toString() ?? uid;
  const description = textValue(component, 'description');
  const relationships = taskRelationships(component);
  return {
    id: createHash('sha256')
      .update(`${resource.url}\0${uid}\0${identity}`)
      .digest('base64url')
      .slice(0, 30),
    resourceId: Buffer.from(resource.url).toString('base64url'),
    calendarId,
    uid,
    title: textValue(component, 'summary') ?? '(untitled)',
    ...(timeValue(startValue) ? { start: timeValue(startValue) } : {}),
    ...(timeValue(dueValue) ? { due: timeValue(dueValue) } : {}),
    allDay: Boolean(startValue?.isDate || dueValue?.isDate),
    ...(description ? { description } : {}),
    status,
    completed: status === 'completed' || Boolean(completedAt),
    ...(completedAt ? { completedAt } : {}),
    priority,
    version: resource.etag,
    entryType: 'todo',
    recurring: Boolean(rule),
    ...(rule ? { recurrenceRule: rule } : {}),
    ...(recurrenceId ? { recurrenceId: recurrenceId.toString() } : {}),
    ...relationships,
  };
}

export function mapTaskResource(
  resource: CalendarResource,
  calendarId: string,
  range?: TaskExpansionRange,
): CalendarTask[] {
  try {
    // ical.js exposes its jCal parser result as `any` in its legacy declaration.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const calendar = new ICAL.Component(ICAL.parse(resource.calendarData));
    const components = calendar.getAllSubcomponents('vtodo');
    const masters = components.filter(
      (component) => !component.hasProperty('recurrence-id'),
    );
    const exceptions = components.filter((component) =>
      component.hasProperty('recurrence-id'),
    );
    return masters.flatMap((component) => {
      const startValue = component.getFirstPropertyValue('dtstart');
      const dueValue = component.getFirstPropertyValue('due');
      const start = startValue instanceof ICAL.Time ? startValue : undefined;
      const due = dueValue instanceof ICAL.Time ? dueValue : undefined;
      const rule = recurrenceRule(component);
      const anchor = start ?? due;
      if (!range || !rule || !anchor)
        return [mappedTask(resource, calendarId, component, start, due)];

      const dueOffset = start && due ? due.subtractDate(start) : undefined;
      const expansion = new ICAL.RecurExpansion({ component, dtstart: anchor });
      const output: CalendarTask[] = [];
      let occurrence: ICAL.Time | null;
      while ((occurrence = expansion.next())) {
        const occurrenceId = occurrence;
        const occurrenceStart = start ? occurrenceId : undefined;
        const occurrenceDue = due
          ? start
            ? occurrenceId.clone()
            : occurrenceId
          : undefined;
        if (occurrenceDue && dueOffset) occurrenceDue.addDuration(dueOffset);
        const display = occurrenceDue ?? occurrenceStart;
        if (!display) break;
        const instant = display.toJSDate();
        if (instant >= range.end) break;
        if (instant >= range.start) {
          const exception = exceptions.find(
            (item) =>
              textValue(item, 'uid') === textValue(component, 'uid') &&
              componentRecurrenceId(item)?.toString() ===
                occurrenceId.toString(),
          );
          const exceptionStatus = exception
            ? textValue(exception, 'status')?.toLowerCase()
            : undefined;
          if (exceptionStatus !== 'cancelled') {
            const exceptionStart = exception?.getFirstPropertyValue('dtstart');
            const exceptionDue = exception?.getFirstPropertyValue('due');
            output.push(
              mappedTask(
                resource,
                calendarId,
                exception ?? component,
                exceptionStart instanceof ICAL.Time
                  ? exceptionStart
                  : occurrenceStart,
                exceptionDue instanceof ICAL.Time
                  ? exceptionDue
                  : occurrenceDue,
                occurrenceId,
                rule,
              ),
            );
          }
        }
        if (output.length > range.maxOccurrences)
          throw new CalDavError(
            'CALDAV_PROTOCOL_ERROR',
            'Recurring task exceeds the configured occurrence limit.',
          );
      }
      return output;
    });
  } catch (error: unknown) {
    if (error instanceof CalDavError) throw error;
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'A calendar resource contains invalid task data.',
      undefined,
      { cause: error },
    );
  }
}
