import { createHash } from 'node:crypto';

import type { DayFrontConfig } from '../config.js';
import type { CalendarMutation } from '@dayfront/shared';
import { CalDavError } from './errors.js';
import type {
  CalendarCollection,
  CalendarResource,
  DiscoveryResult,
} from './types.js';
import {
  componentNames,
  hasProperty,
  parseMultiStatus,
  propertyHref,
  text,
} from './xml.js';

const discoveryBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;

const homeBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`;

const calendarsBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ical="http://apple.com/ns/ical/">
  <d:prop><d:resourcetype/><d:displayname/><d:getetag/><c:calendar-description/><c:supported-calendar-component-set/><ical:calendar-color/><cs:getctag/></d:prop>
</d:propfind>`;

export interface CalDavClientOptions {
  fetch?: typeof fetch;
}

export class CalDavClient {
  private readonly baseUrl: URL;
  private readonly authorization: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(
    private readonly config: DayFrontConfig['caldav'],
    options: CalDavClientOptions = {},
  ) {
    this.baseUrl = new URL(
      config.url.endsWith('/') ? config.url : `${config.url}/`,
    );
    this.authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  async discover(): Promise<DiscoveryResult> {
    const principalProperties = await this.propfind(
      this.baseUrl.href,
      '0',
      discoveryBody,
    );
    const principalHref = propertyHref(
      this.firstProperties(principalProperties, 'current-user-principal'),
      'current-user-principal',
    );
    if (!principalHref)
      this.protocolError(
        'CalDAV server did not provide a current-user-principal.',
      );
    const principalUrl = this.resolveHref(principalHref).href;

    const homeProperties = await this.propfind(principalUrl, '0', homeBody);
    const homeHref = propertyHref(
      this.firstProperties(homeProperties, 'calendar-home-set'),
      'calendar-home-set',
    );
    if (!homeHref)
      this.protocolError('CalDAV server did not provide a calendar-home-set.');
    const calendarHomeUrl = this.resolveHref(homeHref).href;

    const collections = await this.propfind(
      calendarHomeUrl,
      '1',
      calendarsBody,
    );
    const calendars = collections.flatMap(
      ({ href, properties }): CalendarCollection[] => {
        if (!hasProperty(properties, 'resourcetype', 'calendar')) return [];
        const url = this.resolveHref(href).href;
        const displayName =
          text(properties.displayname) ??
          new URL(url).pathname.split('/').filter(Boolean).at(-1) ??
          'Calendar';
        const description = text(properties['calendar-description']);
        const color = text(properties['calendar-color']);
        return [
          {
            id: createHash('sha256')
              .update(url)
              .digest('base64url')
              .slice(0, 22),
            url,
            displayName,
            ...(description ? { description } : {}),
            ...(color ? { color } : {}),
            components: componentNames(properties),
          },
        ];
      },
    );

    return { principalUrl, calendarHomeUrl, calendars };
  }

  async queryCalendar(
    calendarUrl: string,
    start: Date,
    end: Date,
  ): Promise<CalendarResource[]> {
    this.assertRange(start, end);
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${this.dateTime(start)}" end="${this.dateTime(end)}"/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
    const response = await this.request(calendarUrl, {
      method: 'REPORT',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    this.expectStatus(response, [207]);
    const resources = parseMultiStatus(await response.text());
    return resources.flatMap(({ href, properties }): CalendarResource[] => {
      const etag = text(properties.getetag);
      const calendarData = text(properties['calendar-data']);
      if (!etag || !calendarData) return [];
      return [{ url: this.resolveHref(href).href, etag, calendarData }];
    });
  }

  async searchCalendar(
    calendarUrl: string,
    query: string,
  ): Promise<CalendarResource[]> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="SUMMARY"><c:text-match collation="i;unicode-casemap">${this.xml(query)}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
    const response = await this.request(calendarUrl, {
      method: 'REPORT',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    this.expectStatus(response, [207]);
    const resources = parseMultiStatus(await response.text());
    return resources.flatMap(({ href, properties }): CalendarResource[] => {
      const etag = text(properties.getetag);
      const calendarData = text(properties['calendar-data']);
      return etag && calendarData
        ? [{ url: this.resolveHref(href).href, etag, calendarData }]
        : [];
    });
  }

  async queryTasks(
    calendarUrl: string,
    start?: Date,
    end?: Date,
  ): Promise<CalendarResource[]> {
    if ((start && !end) || (!start && end))
      this.protocolError('Task range requires both start and end.');
    if (start && end) this.assertRange(start, end);
    const timeRange =
      start && end
        ? `<c:time-range start="${this.dateTime(start)}" end="${this.dateTime(end)}"/>`
        : '';
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO">${timeRange}</c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
    const response = await this.request(calendarUrl, {
      method: 'REPORT',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    this.expectStatus(response, [207]);
    const resources = parseMultiStatus(await response.text());
    return resources.flatMap(({ href, properties }): CalendarResource[] => {
      const etag = text(properties.getetag);
      const calendarData = text(properties['calendar-data']);
      return etag && calendarData
        ? [{ url: this.resolveHref(href).href, etag, calendarData }]
        : [];
    });
  }

  async getResource(resourceUrl: string): Promise<CalendarResource> {
    const response = await this.request(resourceUrl, { method: 'GET' });
    this.expectStatus(response, [200]);
    const etag = response.headers.get('etag');
    if (!etag)
      this.protocolError('Calendar resource response did not include an ETag.');
    return {
      url: this.resolveHref(resourceUrl).href,
      etag,
      calendarData: await response.text(),
    };
  }

  async putResource(
    resourceUrl: string,
    calendarData: string,
    etag?: string,
  ): Promise<string> {
    const response = await this.request(resourceUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
      },
      body: calendarData,
    });
    this.expectStatus(response, [201, 204]);
    return response.headers.get('etag') ?? etag ?? '';
  }

  async deleteResource(resourceUrl: string, etag: string): Promise<void> {
    const response = await this.request(resourceUrl, {
      method: 'DELETE',
      headers: { 'If-Match': etag },
    });
    // RFC 4918 commonly uses 204 for DELETE, while some deployments and
    // intermediaries may return another successful 2xx response.
    if (!response.ok) this.expectStatus(response, []);
  }

  async createCalendar(
    calendarHomeUrl: string,
    calendarUrl: string,
    input: CalendarMutation,
  ): Promise<void> {
    const home = this.resolveHref(calendarHomeUrl);
    const target = this.resolveHref(calendarUrl);
    if (!target.pathname.startsWith(home.pathname) || target.href === home.href)
      this.protocolError('New calendar URL is outside the calendar home.');
    const components = input.components
      .map((component) => `<c:comp name="${component}"/>`)
      .join('');
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <d:set><d:prop>
    <d:displayname>${this.xml(input.name)}</d:displayname>
    <c:calendar-description>${this.xml(input.description ?? '')}</c:calendar-description>
    ${input.color ? `<ical:calendar-color>${this.xml(input.color)}</ical:calendar-color>` : ''}
    <c:supported-calendar-component-set>${components}</c:supported-calendar-component-set>
  </d:prop></d:set>
</c:mkcalendar>`;
    const response = await this.request(target.href, {
      method: 'MKCALENDAR',
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    this.expectStatus(response, [201, 204]);
  }

  async updateCalendar(
    calendarUrl: string,
    input: CalendarMutation,
  ): Promise<void> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <d:set><d:prop>
    <d:displayname>${this.xml(input.name)}</d:displayname>
    <c:calendar-description>${this.xml(input.description ?? '')}</c:calendar-description>
    ${input.color ? `<ical:calendar-color>${this.xml(input.color)}</ical:calendar-color>` : ''}
    <c:supported-calendar-component-set>${input.components.map((component) => `<c:comp name="${component}"/>`).join('')}</c:supported-calendar-component-set>
  </d:prop></d:set>
  ${input.color ? '' : '<d:remove><d:prop><ical:calendar-color/></d:prop></d:remove>'}
</d:propertyupdate>`;
    const response = await this.request(calendarUrl, {
      method: 'PROPPATCH',
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    this.expectStatus(response, [207]);
  }

  async deleteCalendar(calendarUrl: string): Promise<void> {
    const response = await this.request(calendarUrl, { method: 'DELETE' });
    if (!response.ok) this.expectStatus(response, []);
  }

  private async propfind(url: string, depth: '0' | '1', body: string) {
    const response = await this.request(url, {
      method: 'PROPFIND',
      headers: {
        Depth: depth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    });
    this.expectStatus(response, [207]);
    return parseMultiStatus(await response.text());
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const target = this.resolveHref(url);
    try {
      return await this.fetchImplementation(target, {
        ...init,
        headers: {
          Accept: 'application/xml, text/calendar',
          Authorization: this.authorization,
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
        redirect: 'manual',
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new CalDavError(
          'REQUEST_TIMEOUT',
          'CalDAV request timed out.',
          undefined,
          { cause: error },
        );
      }
      throw new CalDavError(
        'CALDAV_UNAVAILABLE',
        'CalDAV server could not be reached.',
        undefined,
        {
          cause: error,
        },
      );
    }
  }

  private resolveHref(href: string | URL): URL {
    const resolved = new URL(href, this.baseUrl);
    if (resolved.origin !== this.baseUrl.origin) {
      this.protocolError('CalDAV server returned a cross-origin resource URL.');
    }
    return resolved;
  }

  private expectStatus(response: Response, expected: readonly number[]): void {
    if (expected.includes(response.status)) return;
    if (response.status === 401)
      throw new CalDavError(
        'AUTHENTICATION_FAILED',
        'CalDAV server rejected the configured credentials.',
        401,
      );
    if (response.status === 403)
      throw new CalDavError(
        'FORBIDDEN',
        'CalDAV server denied access to the requested resource.',
        403,
      );
    if (response.status === 404)
      throw new CalDavError(
        'NOT_FOUND',
        'The requested CalDAV resource was not found.',
        404,
      );
    if (response.status === 409 || response.status === 412)
      throw new CalDavError(
        'VERSION_CONFLICT',
        'The CalDAV resource was modified remotely.',
        response.status,
      );
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      `CalDAV server returned unexpected HTTP status ${response.status}.`,
      response.status,
    );
  }

  private firstProperties(
    sets: Awaited<ReturnType<CalDavClient['propfind']>>,
    requiredProperty: string,
  ) {
    const properties = sets.find((set) =>
      Object.hasOwn(set.properties, requiredProperty),
    )?.properties;
    if (!properties)
      this.protocolError(`CalDAV response omitted ${requiredProperty}.`);
    return properties;
  }

  private protocolError(message: string): never {
    throw new CalDavError('CALDAV_PROTOCOL_ERROR', message);
  }

  private assertRange(start: Date, end: Date): void {
    const duration = end.getTime() - start.getTime();
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 366 * 24 * 60 * 60 * 1000
    ) {
      throw new CalDavError(
        'CALDAV_PROTOCOL_ERROR',
        'Calendar query range must be positive and no longer than 366 days.',
      );
    }
  }

  private dateTime(date: Date): string {
    return date
      .toISOString()
      .replaceAll('-', '')
      .replaceAll(':', '')
      .replace(/\.\d{3}Z$/, 'Z');
  }

  private xml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }
}
