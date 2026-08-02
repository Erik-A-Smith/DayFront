import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CalDavClient,
  CalDavError,
  ICalendarDocument,
} from '../src/caldav/index.js';

const fixtures = resolve(import.meta.dirname, '../../../tests/fixtures/caldav');
const fixture = (name: string) =>
  readFileSync(
    resolve(fixtures, name.endsWith('.xml') ? `${name}.fixture` : name),
    'utf8',
  );

const config = {
  url: 'http://caldav.test:5232',
  username: 'dayfront',
  password: 'secret',
  timeoutMs: 1_000,
};

function xmlResponse(name: string, status = 207): Response {
  return new Response(fixture(name), {
    status,
    headers: { 'content-type': 'application/xml' },
  });
}

describe('CalDavClient', () => {
  it('tolerates empty DAV property values', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',
          { status: 207 },
        ),
      );
    const client = new CalDavClient(config, { fetch: fetchMock });

    await expect(client.discover()).rejects.toMatchObject({
      code: 'CALDAV_PROTOCOL_ERROR',
    });
  });

  it('discovers the principal, calendar home, and calendar metadata', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(xmlResponse('principal.xml'))
      .mockResolvedValueOnce(xmlResponse('home.xml'))
      .mockResolvedValueOnce(xmlResponse('calendars.xml'));
    const client = new CalDavClient(config, { fetch: fetchMock });

    const result = await client.discover();

    expect(result.principalUrl).toBe('http://caldav.test:5232/dayfront/');
    expect(result.calendarHomeUrl).toBe('http://caldav.test:5232/dayfront/');
    expect(result.calendars).toEqual([
      expect.objectContaining({
        displayName: 'Personal',
        description: 'My calendar',
        color: '#5B8DEF',
        components: ['VEVENT', 'VTODO'],
      }),
    ]);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toMatch(/^Basic /);
  });

  it('queries a bounded date range and preserves resource URLs and ETags', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(xmlResponse('query.xml'));
    const client = new CalDavClient(config, { fetch: fetchMock });

    const resources = await client.queryCalendar(
      'http://caldav.test:5232/dayfront/personal/',
      new Date('2026-08-01T00:00:00.123Z'),
      new Date('2026-09-01T00:00:00.987Z'),
    );

    expect(resources[0]).toMatchObject({
      url: 'http://caldav.test:5232/dayfront/personal/event-1.ics',
      etag: '"event-v1"',
    });
    expect(resources[0]?.calendarData).toContain('UID:event-1');
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string')
      throw new Error('Expected a string request body.');
    expect(requestBody).toContain(
      'start="20260801T000000Z" end="20260901T000000Z"',
    );
  });

  it('uses ETag preconditions for update and delete', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 204, headers: { etag: '"v2"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const client = new CalDavClient(config, { fetch: fetchMock });

    await expect(
      client.putResource(
        'http://caldav.test:5232/dayfront/personal/event.ics',
        fixture('event.ics'),
        '"v1"',
      ),
    ).resolves.toBe('"v2"');
    await client.deleteResource(
      'http://caldav.test:5232/dayfront/personal/event.ics',
      '"v2"',
    );

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ 'If-Match': '"v1"' }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({ 'If-Match': '"v2"' }),
    );
  });

  it('creates, updates, and deletes calendar collections', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 207 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new CalDavClient(config, { fetch: fetchMock });
    const input = {
      name: 'Home & Work',
      description: 'Shared <calendar>',
      color: '#336699',
      components: ['VEVENT', 'VTODO'] as ('VEVENT' | 'VTODO')[],
    };

    await client.createCalendar(
      'http://caldav.test:5232/dayfront/',
      'http://caldav.test:5232/dayfront/new-calendar/',
      input,
    );
    await client.updateCalendar(
      'http://caldav.test:5232/dayfront/new-calendar/',
      input,
    );
    await client.deleteCalendar(
      'http://caldav.test:5232/dayfront/new-calendar/',
    );

    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      'MKCALENDAR',
      'PROPPATCH',
      'DELETE',
    ]);
    const createBody = fetchMock.mock.calls[0]?.[1]?.body;
    const updateBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(typeof createBody).toBe('string');
    expect(typeof updateBody).toBe('string');
    if (typeof createBody !== 'string' || typeof updateBody !== 'string')
      throw new Error('Expected XML request bodies.');
    expect(createBody).toContain('Home &amp; Work');
    expect(createBody).toContain('Shared &lt;calendar&gt;');
    expect(updateBody).toContain('calendar-color');
  });

  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'FORBIDDEN'],
    [412, 'VERSION_CONFLICT'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    const client = new CalDavClient(config, {
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status })),
    });

    await expect(client.discover()).rejects.toMatchObject({ code });
  });

  it('maps network failures without exposing credentials', async () => {
    const client = new CalDavClient(config, {
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('connect ECONNREFUSED secret')),
    });

    const promise = client.discover();
    await expect(promise).rejects.toMatchObject({
      code: 'CALDAV_UNAVAILABLE',
    });
    await expect(promise).rejects.not.toThrow('secret');
  });

  it('rejects malformed multistatus responses', async () => {
    const client = new CalDavClient(config, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<not-dav/>', {
          status: 207,
          headers: { 'content-type': 'application/xml' },
        }),
      ),
    });

    await expect(client.discover()).rejects.toMatchObject({
      name: CalDavError.name,
      code: 'CALDAV_PROTOCOL_ERROR',
    });
  });

  it('rejects oversized query ranges before making a request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new CalDavClient(config, { fetch: fetchMock });

    await expect(
      client.queryCalendar(
        'http://caldav.test:5232/dayfront/personal/',
        new Date('2025-01-01T00:00:00Z'),
        new Date('2027-01-01T00:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'CALDAV_PROTOCOL_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('iCalendar round trips', () => {
  it('preserves recurrence and unknown properties', () => {
    const document = ICalendarDocument.parse(fixture('event.ics'));
    const serialized = document.serialize();

    expect(document.componentNames()).toContain('VEVENT');
    expect(serialized).toContain('RRULE:FREQ=WEEKLY;COUNT=3');
    expect(serialized).toContain('EXDATE:20260808T140000Z');
    expect(serialized).toContain('X-DAYFRONT-FIXTURE:preserve-me');
    expect(serialized).toContain('X-CUSTOM-PROPERTY:custom-value');
    expect(() => ICalendarDocument.parse(serialized)).not.toThrow();
  });
});
