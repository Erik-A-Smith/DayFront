import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  calendarEventResponseSchema,
  calendarResponseSchema,
  calendarEventsResponseSchema,
  calendarTasksResponseSchema,
  calendarTaskResponseSchema,
  calendarsResponseSchema,
} from '@dayfront/shared';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { CalDavClient } from '../src/caldav/client.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const fixtures = resolve(import.meta.dirname, '../../../tests/fixtures/caldav');
const fixture = (name: string) => readFileSync(resolve(fixtures, name), 'utf8');
const response = (name: string) => new Response(fixture(name), { status: 207 });
const config = loadConfig({
  environment: {
    DAYFRONT_CALDAV_URL: 'http://radicale.test:5232',
    DAYFRONT_CALDAV_USERNAME: 'dayfront',
    DAYFRONT_CALDAV_PASSWORD: 'secret',
  },
});

function testApp(fetchMock: typeof fetch) {
  return createApp({
    config,
    logger: createLogger({ level: 'fatal', format: 'json' }),
    caldav: new CalDavClient(config.caldav, { fetch: fetchMock }),
  });
}

describe('calendar API', () => {
  it('lists discovered calendars without exposing Radicale URLs', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('principal.xml'))
      .mockResolvedValueOnce(response('home.xml'))
      .mockResolvedValueOnce(response('calendars.xml'));

    const result = await request(testApp(fetchMock))
      .get('/api/v1/calendars')
      .expect(200);
    const body = calendarsResponseSchema.parse(result.body);

    expect(body.data[0]).toMatchObject({
      displayName: 'Personal',
      components: ['VEVENT', 'VTODO'],
    });
    expect(JSON.stringify(body)).not.toContain('radicale.test');
  });

  it('updates calendar collection metadata', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('principal.xml'))
      .mockResolvedValueOnce(response('home.xml'))
      .mockResolvedValueOnce(response('calendars.xml'))
      .mockResolvedValueOnce(new Response(null, { status: 207 }))
      .mockResolvedValueOnce(response('principal.xml'))
      .mockResolvedValueOnce(response('home.xml'))
      .mockResolvedValueOnce(response('calendars.xml'));
    const id = createHash('sha256')
      .update('http://radicale.test:5232/dayfront/personal/')
      .digest('base64url')
      .slice(0, 22);

    const result = await request(testApp(fetchMock))
      .put(`/api/v1/calendars/${id}`)
      .send({
        name: 'Renamed',
        color: '#336699',
        components: ['VEVENT', 'VTODO'],
      })
      .expect(200);

    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('PROPPATCH');
    const updateBody = fetchMock.mock.calls[3]?.[1]?.body;
    expect(typeof updateBody).toBe('string');
    if (typeof updateBody !== 'string')
      throw new Error('Expected an XML request body.');
    expect(updateBody).toContain('Renamed');
    expect(calendarResponseSchema.parse(result.body).data.id).toBe(id);
  });

  it('returns mapped events for the requested range', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('principal.xml'))
      .mockResolvedValueOnce(response('home.xml'))
      .mockResolvedValueOnce(response('calendars.xml'))
      .mockResolvedValueOnce(response('query.xml'));

    const result = await request(testApp(fetchMock))
      .get('/api/v1/events')
      .query({ start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' })
      .expect(200);
    const body = calendarEventsResponseSchema.parse(result.body);

    expect(body.data[0]).toMatchObject({
      uid: 'event-1',
      title: 'Fixture event',
      start: '2026-08-01T14:00:00.000Z',
      version: '"event-v1"',
    });
  });

  it('validates event date ranges', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await request(testApp(fetchMock))
      .get('/api/v1/events')
      .expect(400);

    expect(result.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns dated VTODO tasks for a requested range', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('principal.xml'))
      .mockResolvedValueOnce(response('home.xml'))
      .mockResolvedValueOnce(response('calendars.xml'))
      .mockResolvedValueOnce(response('tasks.xml'));

    const result = await request(testApp(fetchMock))
      .get('/api/v1/tasks')
      .query({ start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' })
      .expect(200);
    const body = calendarTasksResponseSchema.parse(result.body);

    expect(body.data[0]).toMatchObject({
      title: 'Fixture task',
      due: '2026-08-15',
      status: 'needs-action',
      priority: 3,
      entryType: 'todo',
    });
    const reportBody = fetchMock.mock.calls[3]?.[1]?.body;
    expect(typeof reportBody === 'string' ? reportBody : '').toContain(
      '<c:comp-filter name="VTODO">',
    );
  });

  it('creates, updates, completes, and deletes a task with ETags', async () => {
    let stored = '';
    let propfind = 0;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      if (init?.method === 'PROPFIND') {
        const names = ['principal.xml', 'home.xml', 'calendars.xml'];
        return Promise.resolve(response(names[propfind++ % names.length]!));
      }
      if (init?.method === 'PUT') {
        if (typeof init.body !== 'string')
          throw new Error('Expected task data.');
        stored = init.body;
        return Promise.resolve(
          new Response(null, { status: 204, headers: { etag: '"task-v2"' } }),
        );
      }
      if (init?.method === 'DELETE')
        return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(
        new Response(stored, {
          status: 200,
          headers: { etag: '"task-v2"', 'content-type': 'text/calendar' },
        }),
      );
    });
    const calendarUrl = 'http://radicale.test:5232/dayfront/personal/';
    const calendarId = createHash('sha256')
      .update(calendarUrl)
      .digest('base64url')
      .slice(0, 22);
    const app = testApp(fetchMock);
    const taskInput = {
      calendarId,
      title: 'CRUD task',
      due: '2026-08-20',
      allDay: true,
      status: 'needs-action',
      priority: 4,
    };

    const created = await request(app)
      .post(`/api/v1/calendars/${calendarId}/tasks`)
      .send(taskInput)
      .expect(201);
    const task = calendarTaskResponseSchema.parse(created.body).data;
    expect(stored).toContain('BEGIN:VTODO');

    const updated = await request(app)
      .put(`/api/v1/tasks/${task.resourceId}`)
      .set('If-Match', task.version)
      .send({ ...taskInput, status: 'completed' })
      .expect(200);
    expect(calendarTaskResponseSchema.parse(updated.body).data.completed).toBe(
      true,
    );
    expect(stored).toContain('STATUS:COMPLETED');

    await request(app)
      .delete(`/api/v1/tasks/${task.resourceId}`)
      .set('If-Match', '"task-v2"')
      .expect(204);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
  });

  it('creates an event in the selected calendar', async () => {
    let createdData = '';
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      const call = fetchMock.mock.calls.length;
      if (call === 1) return Promise.resolve(response('principal.xml'));
      if (call === 2) return Promise.resolve(response('home.xml'));
      if (call === 3) return Promise.resolve(response('calendars.xml'));
      if (init?.method === 'PUT') {
        if (typeof init.body !== 'string')
          throw new Error('Expected string calendar data.');
        createdData = init.body;
        return Promise.resolve(
          new Response(null, {
            status: 201,
            headers: { etag: '"created"' },
          }),
        );
      }
      return Promise.resolve(
        new Response(createdData, {
          status: 200,
          headers: { etag: '"created"', 'content-type': 'text/calendar' },
        }),
      );
    });
    const calendarUrl = 'http://radicale.test:5232/dayfront/personal/';
    const calendarId = createHash('sha256')
      .update(calendarUrl)
      .digest('base64url')
      .slice(0, 22);

    const result = await request(testApp(fetchMock))
      .post(`/api/v1/calendars/${calendarId}/events`)
      .send({
        calendarId,
        title: 'Created in DayFront',
        start: '2026-08-05T14:00:00.000Z',
        end: '2026-08-05T15:00:00.000Z',
        allDay: false,
      })
      .expect(201);

    expect(calendarEventResponseSchema.parse(result.body).data).toMatchObject({
      title: 'Created in DayFront',
      version: '"created"',
    });
    expect(createdData).toContain('SUMMARY:Created in DayFront');
  });

  it('moves an event resource when its calendar changes', async () => {
    const personalUrl = 'http://radicale.test:5232/dayfront/personal/';
    const workUrl = 'http://radicale.test:5232/dayfront/work/';
    const personalId = createHash('sha256')
      .update(personalUrl)
      .digest('base64url')
      .slice(0, 22);
    const workId = createHash('sha256')
      .update(workUrl)
      .digest('base64url')
      .slice(0, 22);
    const collections = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  ${['personal', 'work']
    .map(
      (name) =>
        `<d:response><d:href>/dayfront/${name}/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype><d:displayname>${name}</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
    )
    .join('')}
</d:multistatus>`;
    let propfind = 0;
    let saved = fixture('event.ics');
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (init?.method === 'PROPFIND') {
        const cycle = propfind++ % 3;
        return Promise.resolve(
          cycle === 0
            ? response('principal.xml')
            : cycle === 1
              ? response('home.xml')
              : new Response(collections, { status: 207 }),
        );
      }
      if (init?.method === 'PUT') {
        if (typeof init.body !== 'string')
          throw new Error('Expected event data.');
        saved = init.body;
        const requestedUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        expect(requestedUrl).toContain('/dayfront/work/');
        expect(new Headers(init.headers).get('If-None-Match')).toBe('*');
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (init?.method === 'DELETE')
        return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(
        new Response(saved, { status: 200, headers: { etag: '"v1"' } }),
      );
    });
    const resourceId = Buffer.from(`${personalUrl}event.ics`).toString(
      'base64url',
    );

    const result = await request(testApp(fetchMock))
      .put(`/api/v1/events/${resourceId}`)
      .set('If-Match', '"v1"')
      .send({
        calendarId: workId,
        title: 'Moved event',
        start: '2026-08-01T14:00:00.000Z',
        end: '2026-08-01T15:00:00.000Z',
        allDay: false,
      })
      .expect(200);

    expect(calendarEventResponseSchema.parse(result.body).data.calendarId).toBe(
      workId,
    );
    expect(personalId).not.toBe(workId);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
  });

  it('requires and forwards ETags for deletion', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const url = 'http://radicale.test:5232/dayfront/personal/event.ics';
    const resourceId = Buffer.from(url).toString('base64url');
    const app = testApp(fetchMock);

    await request(app).delete(`/api/v1/events/${resourceId}`).expect(428);
    await request(app)
      .delete(`/api/v1/events/${resourceId}`)
      .set('If-Match', '"v1"')
      .expect(204);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ 'If-Match': '"v1"' }),
    );
  });

  it('deletes one recurring occurrence by updating the series resource', async () => {
    let updatedData = '';
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      if (init?.method === 'PUT') {
        if (typeof init.body !== 'string')
          throw new Error('Expected string calendar data.');
        updatedData = init.body;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        new Response(fixture('event.ics'), {
          status: 200,
          headers: { etag: '"v1"', 'content-type': 'text/calendar' },
        }),
      );
    });
    const url = 'http://radicale.test:5232/dayfront/personal/event.ics';
    const resourceId = Buffer.from(url).toString('base64url');

    await request(testApp(fetchMock))
      .delete(`/api/v1/events/${resourceId}`)
      .query({
        scope: 'occurrence',
        recurrenceId: '2026-08-15T14:00:00Z',
      })
      .set('If-Match', '"v1"')
      .expect(204);

    expect(updatedData).toContain('EXDATE:20260815T140000Z');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({ 'If-Match': '"v1"' }),
    );
  });
});
