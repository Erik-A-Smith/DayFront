import { describe, expect, it } from 'vitest';

import { CalDavError } from '../src/caldav/errors.js';
import type { CalendarResource } from '../src/caldav/types.js';
import {
  mapCalendarResource,
  resourceUrl,
} from '../src/calendar/event-mapper.js';

function resource(calendarData: string): CalendarResource {
  return {
    url: 'http://radicale.test/calendars/personal/recurring.ics',
    etag: '"v1"',
    calendarData,
  };
}

function calendar(event: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//DayFront Test//EN\r\n${event}\r\nEND:VCALENDAR\r\n`;
}

const range = {
  start: new Date('2026-08-01T00:00:00Z'),
  end: new Date('2026-09-01T00:00:00Z'),
  maxOccurrences: 100,
};

describe('recurring event mapping', () => {
  it('expands RRULEs inside the requested range and applies EXDATE', () => {
    const data = calendar(
      'BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART:20260801T140000Z\r\nDTEND:20260801T150000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE:20260808T140000Z\r\nSUMMARY:Weekly\r\nEND:VEVENT',
    );

    const events = mapCalendarResource(resource(data), 'personal', range);

    expect(events.map((event) => event.start)).toEqual([
      '2026-08-01T14:00:00.000Z',
      '2026-08-15T14:00:00.000Z',
    ]);
    expect(events.every((event) => event.recurring)).toBe(true);
    expect(events[0]?.recurrenceRule).toBe('FREQ=WEEKLY;COUNT=3');
  });

  it('uses stable, distinct occurrence identifiers', () => {
    const data = calendar(
      'BEGIN:VEVENT\r\nUID:daily\r\nDTSTART:20260801T140000Z\r\nDTEND:20260801T150000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nSUMMARY:Daily\r\nEND:VEVENT',
    );

    const first = mapCalendarResource(resource(data), 'personal', range);
    const second = mapCalendarResource(resource(data), 'personal', range);

    expect(first.map(({ id }) => id)).toEqual(second.map(({ id }) => id));
    expect(new Set(first.map(({ id }) => id)).size).toBe(2);
  });

  it('uses modified exception data for an occurrence', () => {
    const data = calendar(
      'BEGIN:VEVENT\r\nUID:moved\r\nDTSTART:20260801T140000Z\r\nDTEND:20260801T150000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nSUMMARY:Original\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:moved\r\nRECURRENCE-ID:20260802T140000Z\r\nDTSTART:20260802T160000Z\r\nDTEND:20260802T170000Z\r\nSUMMARY:Moved\r\nEND:VEVENT',
    );

    const events = mapCalendarResource(resource(data), 'personal', range);

    expect(events[1]).toMatchObject({
      title: 'Moved',
      start: '2026-08-02T16:00:00.000Z',
      recurrenceId: '2026-08-02T14:00:00Z',
    });
  });

  it('includes RDATE additions and omits cancelled exceptions', () => {
    const data = calendar(
      'BEGIN:VEVENT\r\nUID:dates\r\nDTSTART:20260801T140000Z\r\nDTEND:20260801T150000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nRDATE:20260810T140000Z\r\nSUMMARY:Dates\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:dates\r\nRECURRENCE-ID:20260802T140000Z\r\nDTSTART:20260802T140000Z\r\nDTEND:20260802T150000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled\r\nEND:VEVENT',
    );

    const events = mapCalendarResource(resource(data), 'personal', range);

    expect(events.map((event) => event.start)).toEqual([
      '2026-08-01T14:00:00.000Z',
      '2026-08-10T14:00:00.000Z',
    ]);
  });

  it('returns an exception moved into the range from a later recurrence slot', () => {
    const data = calendar(
      'BEGIN:VEVENT\r\nUID:moved-in\r\nDTSTART:20260801T140000Z\r\nDTEND:20260801T150000Z\r\nRRULE:FREQ=MONTHLY;COUNT=3\r\nSUMMARY:Original\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:moved-in\r\nRECURRENCE-ID:20260901T140000Z\r\nDTSTART:20260820T160000Z\r\nDTEND:20260820T170000Z\r\nSUMMARY:Moved into August\r\nEND:VEVENT',
    );

    const events = mapCalendarResource(resource(data), 'personal', range);

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      title: 'Moved into August',
      start: '2026-08-20T16:00:00.000Z',
    });
  });

  it('handles leap-day and month-end recurrence rules', () => {
    const data = calendar(
      'BEGIN:VEVENT\r\nUID:month-end\r\nDTSTART:20240131T140000Z\r\nDTEND:20240131T150000Z\r\nRRULE:FREQ=MONTHLY;COUNT=4;BYMONTHDAY=-1\r\nSUMMARY:Month end\r\nEND:VEVENT',
    );
    const events = mapCalendarResource(resource(data), 'personal', {
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-05-01T00:00:00Z'),
      maxOccurrences: 100,
    });

    expect(events.map((event) => event.start.slice(0, 10))).toEqual([
      '2024-01-31',
      '2024-02-29',
      '2024-03-31',
      '2024-04-30',
    ]);
  });

  it('keeps local wall time across a daylight-saving transition', () => {
    const data = calendar(
      'BEGIN:VTIMEZONE\r\nTZID:America/Toronto\r\nBEGIN:STANDARD\r\nDTSTART:19701101T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nTZNAME:EST\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700308T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nTZNAME:EDT\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:dst\r\nDTSTART;TZID=America/Toronto:20260301T090000\r\nDTEND;TZID=America/Toronto:20260301T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:DST safe\r\nEND:VEVENT',
    );
    const events = mapCalendarResource(resource(data), 'personal', {
      start: new Date('2026-03-01T00:00:00Z'),
      end: new Date('2026-03-22T00:00:00Z'),
      maxOccurrences: 100,
    });

    expect(events.map((event) => event.start)).toEqual([
      '2026-03-01T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-15T13:00:00.000Z',
    ]);
  });

  it('stops unbounded rules at the configured safety limit', () => {
    const data = calendar(
      'BEGIN:VEVENT\r\nUID:infinite\r\nDTSTART:20260801T140000Z\r\nDTEND:20260801T150000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Infinite\r\nEND:VEVENT',
    );

    expect(() =>
      mapCalendarResource(resource(data), 'personal', {
        ...range,
        maxOccurrences: 2,
      }),
    ).toThrowError(CalDavError);
  });
});

describe('calendar resource identifiers', () => {
  it('accepts only normalized HTTP calendar resource URLs', () => {
    const valid = 'https://radicale.test/calendars/personal/event.ics';
    expect(resourceUrl(Buffer.from(valid).toString('base64url'))).toBe(valid);
    for (const invalid of [
      'file:///etc/passwd',
      'https://user:secret@radicale.test/event.ics',
      'https://radicale.test/admin',
      'https://radicale.test/event.ics?delete=true',
    ]) {
      expect(() =>
        resourceUrl(Buffer.from(invalid).toString('base64url')),
      ).toThrow(CalDavError);
    }
  });
});
