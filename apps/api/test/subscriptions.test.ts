import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { CalendarSubscriptionService } from '../src/calendar/subscriptions.js';

const feed = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:holiday-1\r
DTSTART;VALUE=DATE:20260803\r
DTEND;VALUE=DATE:20260804\r
SUMMARY:Civic Holiday\r
END:VEVENT\r
END:VCALENDAR\r
`;

const subscription = {
  id: 'holidays',
  name: 'Holidays',
  url: 'https://feeds.example.test/holidays.ics',
  enabled: true,
  color: '#3b82f6',
  refreshIntervalMs: 86_400_000,
} as const;

describe('external calendar subscriptions', () => {
  it('exposes enabled feeds as read-only calendars and events', async () => {
    const fetchFeed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(feed, { status: 200, headers: { etag: 'v1' } }),
      );
    const service = new CalendarSubscriptionService(
      [subscription, { ...subscription, id: 'off', enabled: false }],
      pino({ level: 'silent' }),
      fetchFeed,
    );

    expect(service.calendars()).toEqual([
      expect.objectContaining({
        id: 'subscription:holidays',
        displayName: 'Holidays',
        readOnly: true,
        color: '#3b82f6',
      }),
    ]);
    const result = await service.events(
      new Set(['subscription:holidays']),
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
      100,
    );
    expect(result.warnings).toEqual([]);
    expect(result.events).toEqual([
      expect.objectContaining({
        title: 'Civic Holiday',
        calendarId: 'subscription:holidays',
        readOnly: true,
      }),
    ]);
  });

  it('caches a feed until its refresh interval expires', async () => {
    let now = 1_000;
    const fetchFeed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(feed, { status: 200, headers: { etag: 'v1' } }),
      );
    const service = new CalendarSubscriptionService(
      [{ ...subscription, refreshIntervalMs: 60_000 }],
      pino({ level: 'silent' }),
      fetchFeed,
      () => now,
    );
    const range = [
      undefined,
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
      100,
    ] as const;
    await service.events(...range);
    await service.events(...range);
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    now += 60_001;
    await service.events(...range);
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    const requestHeaders = fetchFeed.mock.calls[1]?.[1]?.headers;
    expect(requestHeaders).toBeInstanceOf(Headers);
    expect(new Headers(requestHeaders).get('if-none-match')).toBe('v1');
  });

  it('isolates a failed feed and returns a useful warning', async () => {
    const service = new CalendarSubscriptionService(
      [subscription],
      pino({ level: 'silent' }),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('nope')),
    );
    const result = await service.events(
      undefined,
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
      100,
    );
    expect(result.events).toEqual([]);
    expect(result.warnings).toEqual(['Could not load Holidays.']);
  });
});
