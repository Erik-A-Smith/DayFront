import { describe, expect, it } from 'vitest';

import { CalDavClient, ICalendarDocument } from '../src/caldav/index.js';
import { mapCalendarResource } from '../src/calendar/event-mapper.js';
import { mapTaskResource } from '../src/calendar/task-mapper.js';
import { loadConfig } from '../src/config.js';

const integrationEnabled = process.env.DAYFRONT_INTEGRATION_TEST === 'true';

describe.skipIf(!integrationEnabled)('CalDAV integration', () => {
  it('discovers calendars from the configured server', async () => {
    const config = loadConfig();
    const client = new CalDavClient(config.caldav);
    const discovery = await client.discover();

    expect(discovery.principalUrl).toMatch(/^https?:\/\//);
    expect(discovery.calendarHomeUrl).toMatch(/^https?:\/\//);
    expect(discovery.calendars).toBeInstanceOf(Array);

    const eventCalendar = discovery.calendars.find((calendar) =>
      calendar.components.includes('VEVENT'),
    );
    if (eventCalendar) {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 31);
      const end = new Date();
      end.setUTCDate(end.getUTCDate() + 62);
      const resources = await client.queryCalendar(
        eventCalendar.url,
        start,
        end,
      );
      resources.forEach((resource) => {
        expect(() =>
          ICalendarDocument.parse(resource.calendarData),
        ).not.toThrow();
        expect(resource.etag).not.toBe('');
        expect(() =>
          mapCalendarResource(resource, eventCalendar.id, {
            start,
            end,
            maxOccurrences: config.calendar.maxOccurrences,
          }),
        ).not.toThrow();
      });
    }

    const taskCalendar = discovery.calendars.find((calendar) =>
      calendar.components.includes('VTODO'),
    );
    if (taskCalendar) {
      const resources = await client.queryTasks(taskCalendar.url);
      resources.forEach((resource) => {
        expect(() => mapTaskResource(resource, taskCalendar.id)).not.toThrow();
      });
    }
  });
});
