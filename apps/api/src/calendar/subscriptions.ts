import type { Calendar, CalendarEvent } from '@dayfront/shared';
import type { Logger } from 'pino';

import type { CalendarSubscriptionConfig } from '../config.js';
import type { CalendarResource } from '../caldav/types.js';
import { mapCalendarResource } from './event-mapper.js';

const MAX_FEED_BYTES = 10 * 1024 * 1024;
const PREFIX = 'subscription:';

interface CachedFeed {
  calendarData: string;
  etag: string;
  lastModified?: string;
  refreshAt: number;
}

export interface SubscriptionLoadResult {
  events: CalendarEvent[];
  warnings: string[];
}

export class CalendarSubscriptionService {
  private readonly active: CalendarSubscriptionConfig[];
  private readonly cache = new Map<string, CachedFeed>();
  private readonly pending = new Map<string, Promise<CachedFeed>>();

  constructor(
    subscriptions: readonly CalendarSubscriptionConfig[],
    private readonly logger: Logger,
    private readonly fetchFeed: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.active = subscriptions.filter((item) => item.enabled);
  }

  calendars(): Calendar[] {
    return this.active.map((item) => ({
      id: `${PREFIX}${item.id}`,
      displayName: item.name,
      ...(item.color ? { color: item.color } : {}),
      components: ['VEVENT'],
      readOnly: true,
    }));
  }

  isCalendar(id: string): boolean {
    return id.startsWith(PREFIX);
  }

  async events(
    selected: ReadonlySet<string> | undefined,
    start: Date,
    end: Date,
    maxOccurrences: number,
  ): Promise<SubscriptionLoadResult> {
    const subscriptions = this.active.filter((item) =>
      selected ? selected.has(`${PREFIX}${item.id}`) : true,
    );
    const results = await Promise.allSettled(
      subscriptions.map(async (item) => {
        const feed = await this.load(item);
        const resource: CalendarResource = {
          // Never expose a configured feed URL (which may contain a secret token)
          // through the event resource identifier returned to the browser.
          url: `https://subscription.invalid/${encodeURIComponent(item.id)}.ics`,
          etag: feed.etag,
          calendarData: feed.calendarData,
        };
        return mapCalendarResource(resource, `${PREFIX}${item.id}`, {
          start,
          end,
          maxOccurrences,
        }).map((event) => ({ ...event, readOnly: true }));
      }),
    );
    const events: CalendarEvent[] = [];
    const warnings: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') events.push(...result.value);
      else {
        const item = subscriptions[index];
        warnings.push(`Could not load ${item?.name ?? 'external calendar'}.`);
        this.logger.warn(
          { subscriptionId: item?.id },
          'external calendar subscription could not be loaded',
        );
      }
    });
    return { events, warnings };
  }

  private load(item: CalendarSubscriptionConfig): Promise<CachedFeed> {
    const cached = this.cache.get(item.id);
    if (cached && cached.refreshAt > this.now()) return Promise.resolve(cached);
    const current = this.pending.get(item.id);
    if (current) return current;
    const request = this.refresh(item, cached).finally(() =>
      this.pending.delete(item.id),
    );
    this.pending.set(item.id, request);
    return request;
  }

  private async refresh(
    item: CalendarSubscriptionConfig,
    stale?: CachedFeed,
  ): Promise<CachedFeed> {
    try {
      const headers = new Headers({
        accept: 'text/calendar, text/plain;q=0.8',
      });
      if (stale?.etag) headers.set('if-none-match', stale.etag);
      if (stale?.lastModified)
        headers.set('if-modified-since', stale.lastModified);
      const response = await this.fetchFeed(item.url, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 304 && stale) {
        const refreshed = {
          ...stale,
          refreshAt: this.now() + item.refreshIntervalMs,
        };
        this.cache.set(item.id, refreshed);
        return refreshed;
      }
      if (!response.ok)
        throw new Error(`Feed returned HTTP ${response.status}.`);
      const declaredSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_FEED_BYTES)
        throw new Error('Feed exceeds the 10 MB size limit.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_FEED_BYTES)
        throw new Error('Feed exceeds the 10 MB size limit.');
      const calendarData = new TextDecoder().decode(bytes);
      if (!/^BEGIN:VCALENDAR\s*$/im.test(calendarData))
        throw new Error('Response is not an iCalendar feed.');
      const refreshed: CachedFeed = {
        calendarData,
        etag: response.headers.get('etag') ?? `subscription-${this.now()}`,
        ...(response.headers.get('last-modified')
          ? { lastModified: response.headers.get('last-modified')! }
          : {}),
        refreshAt: this.now() + item.refreshIntervalMs,
      };
      this.cache.set(item.id, refreshed);
      return refreshed;
    } catch (error: unknown) {
      if (stale) {
        this.logger.warn(
          { subscriptionId: item.id },
          'using stale external calendar subscription',
        );
        return stale;
      }
      throw error;
    }
  }
}
