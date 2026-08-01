import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ICalendarDocument } from '../src/caldav/icalendar.js';
import {
  createEventData,
  deleteOccurrenceData,
  updateEventData,
} from '../src/calendar/event-editor.js';
import { mapCalendarResource } from '../src/calendar/event-mapper.js';

const fixture = readFileSync(
  resolve(import.meta.dirname, '../../../tests/fixtures/caldav/event.ics'),
  'utf8',
);
const input = {
  calendarId: 'personal',
  title: 'Updated title',
  start: '2026-08-02T14:00:00.000Z',
  end: '2026-08-02T15:00:00.000Z',
  allDay: false,
  description: 'Details',
  location: 'Toronto',
};

describe('event editing', () => {
  it('creates valid iCalendar events', () => {
    const source = createEventData(input);

    expect(source).toContain('SUMMARY:Updated title');
    expect(source).toContain('LOCATION:Toronto');
    expect(source).toContain('UID:');
    expect(() => ICalendarDocument.parse(source)).not.toThrow();
  });

  it('creates and removes recurrence rules', () => {
    const recurring = createEventData({
      ...input,
      recurrenceRule: 'FREQ=MONTHLY;COUNT=4',
    });

    expect(recurring).toContain('RRULE:FREQ=MONTHLY;COUNT=4');
    expect(
      updateEventData(recurring, { ...input, recurrenceRule: null }),
    ).not.toContain('RRULE:');
  });

  it('updates fields while preserving recurrence and extension properties', () => {
    const source = updateEventData(fixture, input);

    expect(source).toContain('SUMMARY:Updated title');
    expect(source).toContain('RRULE:FREQ=WEEKLY;COUNT=3');
    expect(source).toContain('X-CUSTOM-PROPERTY:custom-value');
  });

  it('creates multi-day all-day events with exclusive date ends', () => {
    const source = createEventData({
      ...input,
      start: '2026-08-10',
      end: '2026-08-13',
      allDay: true,
    });

    expect(source).toContain('DTSTART;VALUE=DATE:20260810');
    expect(source).toContain('DTEND;VALUE=DATE:20260813');
  });

  it('normalizes offset date-times to UTC instants', () => {
    const source = createEventData({
      ...input,
      start: '2026-08-02T10:00:00-04:00',
      end: '2026-08-02T11:00:00-04:00',
    });

    expect(source).toContain('DTSTART:20260802T140000Z');
    expect(source).toContain('DTEND:20260802T150000Z');
  });

  it('edits one occurrence by creating a RECURRENCE-ID exception', () => {
    const source = updateEventData(fixture, {
      ...input,
      title: 'One changed occurrence',
      recurrenceScope: 'occurrence',
      recurrenceId: '2026-08-15T14:00:00Z',
    });
    const events = mapCalendarResource(
      {
        url: 'http://caldav.test/event.ics',
        etag: '"v2"',
        calendarData: source,
      },
      'personal',
      {
        start: new Date('2026-08-01T00:00:00Z'),
        end: new Date('2026-09-01T00:00:00Z'),
        maxOccurrences: 100,
      },
    );

    expect(
      events.find((event) => event.recurrenceId?.includes('08-15')),
    ).toMatchObject({
      title: 'One changed occurrence',
      start: '2026-08-02T14:00:00.000Z',
    });
    expect(source).toContain('RECURRENCE-ID:20260815T140000Z');
    expect(source).toContain('RRULE:FREQ=WEEKLY;COUNT=3');
  });

  it('deletes one occurrence with EXDATE without deleting the series', () => {
    const source = deleteOccurrenceData(fixture, '2026-08-15T14:00:00Z');

    expect(source).toContain('RRULE:FREQ=WEEKLY;COUNT=3');
    expect(source).toContain('EXDATE:20260815T140000Z');
  });

  it('keeps the master anchored during a whole-series edit', () => {
    const source = updateEventData(fixture, {
      ...input,
      title: 'Whole series',
      start: '2026-08-15T14:00:00.000Z',
      end: '2026-08-15T15:00:00.000Z',
      occurrenceStart: '2026-08-15T14:00:00.000Z',
      recurrenceScope: 'series',
      recurrenceRule: 'FREQ=WEEKLY;COUNT=3',
    });

    expect(source).toContain('DTSTART:20260801T140000Z');
    expect(source).toContain('SUMMARY:Whole series');
  });
});
