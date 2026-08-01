import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  getConfigurationWarnings,
  loadConfig,
} from '../src/config.js';

const requiredEnvironment = {
  DAYFRONT_CALDAV_URL: 'http://radicale:5232',
  DAYFRONT_CALDAV_USERNAME: 'dayfront',
  DAYFRONT_CALDAV_PASSWORD: 'secret',
};

function yamlFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'dayfront-config-'));
  const path = join(directory, 'dayfront.yaml');
  writeFileSync(path, contents);
  return path;
}

describe('configuration', () => {
  it('applies documented defaults', () => {
    const config = loadConfig({ environment: requiredEnvironment });

    expect(config).toMatchObject({
      caldav: { timeoutMs: 10_000 },
      server: { host: '0.0.0.0', port: 8080, trustProxy: false },
      ui: {
        defaultView: 'month',
        darkMode: 'auto',
        sidebar: {
          enabled: true,
          defaultOpen: true,
          showBrand: true,
          showTasks: true,
          showCalendars: true,
        },
      },
      calendar: {
        timezone: 'local',
        weekStartsOn: 'locale',
        maxOccurrences: 5_000,
      },
      logging: { level: 'info', format: 'json' },
      calendarSubscriptions: [],
    });
  });

  it('loads valid subscriptions and defaults optional fields', () => {
    const configFile = yamlFile(`
caldav:
  url: https://calendar.example.test
  username: user
  password: secret
calendar_subscriptions:
  - id: holidays
    name: Public holidays
    url: https://feeds.example.test/holidays.ics
`);
    const config = loadConfig({ environment: {}, configFile });
    expect(config.calendarSubscriptions).toEqual([
      {
        id: 'holidays',
        name: 'Public holidays',
        url: 'https://feeds.example.test/holidays.ics',
        enabled: true,
        refreshIntervalMs: 86_400_000,
      },
    ]);
    expect(getConfigurationWarnings(config)).toEqual([]);
  });

  it('ignores invalid and duplicate subscriptions without failing startup', () => {
    const configFile = yamlFile(`
caldav:
  url: https://calendar.example.test
  username: user
  password: secret
calendar_subscriptions:
  - id: duplicate
    name: First
    url: https://feeds.example.test/first.ics
  - id: duplicate
    name: Second
    url: https://feeds.example.test/second.ics
  - id: invalid-url
    name: Broken
    url: file:///etc/passwd
  - id: valid
    name: Valid
    url: http://feeds.example.test/valid.ics
    refresh_interval: 12h
    color: "#3b82f6"
`);
    const config = loadConfig({ environment: {}, configFile });
    expect(config.calendarSubscriptions.map((item) => item.id)).toEqual([
      'valid',
    ]);
    expect(config.calendarSubscriptions[0]?.refreshIntervalMs).toBe(43_200_000);
    expect(getConfigurationWarnings(config)).toHaveLength(3);
  });

  it('loads YAML values', () => {
    const configFile = yamlFile(`
caldav:
  url: https://calendar.example.test
  username: yaml-user
  password: yaml-secret
server:
  port: 9090
ui:
  darkMode: dark
  sidebar:
    defaultOpen: false
    showBrand: false
    showTasks: false
`);

    const config = loadConfig({ environment: {}, configFile });

    expect(config.caldav.username).toBe('yaml-user');
    expect(config.server.port).toBe(9090);
    expect(config.ui.darkMode).toBe('dark');
    expect(config.ui.sidebar).toMatchObject({
      enabled: true,
      defaultOpen: false,
      showBrand: false,
      showTasks: false,
      showCalendars: true,
    });
  });

  it('supports legacy Radicale configuration names with a warning', () => {
    const configFile = yamlFile(`
radicale:
  url: https://calendar.example.test
  username: legacy-user
  password: legacy-secret
`);
    const config = loadConfig({
      configFile,
      environment: { DAYFRONT_RADICALE_USERNAME: 'legacy-env-user' },
    });
    expect(config.caldav.username).toBe('legacy-env-user');
    expect(getConfigurationWarnings(config)).toContain(
      'The radicale configuration key is deprecated; rename it to caldav.',
    );
  });

  it('gives canonical CalDAV environment variables precedence over legacy names', () => {
    const config = loadConfig({
      environment: {
        DAYFRONT_RADICALE_URL: 'https://legacy.example.test',
        DAYFRONT_RADICALE_USERNAME: 'legacy',
        DAYFRONT_RADICALE_PASSWORD: 'legacy-secret',
        DAYFRONT_CALDAV_URL: 'https://calendar.example.test',
        DAYFRONT_CALDAV_USERNAME: 'canonical',
        DAYFRONT_CALDAV_PASSWORD: 'canonical-secret',
      },
    });
    expect(config.caldav).toMatchObject({
      url: 'https://calendar.example.test',
      username: 'canonical',
      password: 'canonical-secret',
    });
  });

  it('gives environment variables precedence over YAML', () => {
    const configFile = yamlFile(`
caldav:
  url: https://calendar.example.test
  username: yaml-user
  password: yaml-secret
server:
  port: 9090
`);

    const config = loadConfig({
      configFile,
      environment: {
        DAYFRONT_SERVER_PORT: '7070',
        DAYFRONT_CALDAV_USERNAME: 'env-user',
      },
    });

    expect(config.server.port).toBe(7070);
    expect(config.caldav.username).toBe('env-user');
  });

  it('loads every documented setting from environment variables', () => {
    const config = loadConfig({
      environment: {
        DAYFRONT_CALDAV_URL: 'https://calendar.example.test',
        DAYFRONT_CALDAV_USERNAME: 'env-user',
        DAYFRONT_CALDAV_PASSWORD: 'env-secret',
        DAYFRONT_CALDAV_TIMEOUT_MS: '12345',
        DAYFRONT_SERVER_HOST: '127.0.0.1',
        DAYFRONT_SERVER_PORT: '9091',
        DAYFRONT_SERVER_TRUST_PROXY: 'true',
        DAYFRONT_UI_DEFAULT_VIEW: 'agenda',
        DAYFRONT_UI_DARK_MODE: 'dark',
        DAYFRONT_UI_DEFAULT_CALENDAR: 'primary',
        DAYFRONT_UI_SIDEBAR_ENABLED: 'false',
        DAYFRONT_UI_SIDEBAR_DEFAULT_OPEN: 'false',
        DAYFRONT_UI_SIDEBAR_SHOW_BRAND: 'false',
        DAYFRONT_UI_SIDEBAR_SHOW_TASKS: 'false',
        DAYFRONT_UI_SIDEBAR_SHOW_CALENDARS: 'false',
        DAYFRONT_CALENDAR_TIMEZONE: 'America/Toronto',
        DAYFRONT_CALENDAR_WEEK_STARTS_ON: '1',
        DAYFRONT_CALENDAR_MAX_OCCURRENCES: '123',
        DAYFRONT_LOG_LEVEL: 'warn',
        DAYFRONT_LOG_FORMAT: 'pretty',
      },
    });

    expect(config).toEqual({
      caldav: {
        url: 'https://calendar.example.test',
        username: 'env-user',
        password: 'env-secret',
        timeoutMs: 12_345,
      },
      server: { host: '127.0.0.1', port: 9091, trustProxy: true },
      ui: {
        defaultView: 'agenda',
        darkMode: 'dark',
        defaultCalendar: 'primary',
        sidebar: {
          enabled: false,
          defaultOpen: false,
          showBrand: false,
          showTasks: false,
          showCalendars: false,
        },
      },
      calendar: {
        timezone: 'America/Toronto',
        weekStartsOn: 1,
        maxOccurrences: 123,
      },
      logging: { level: 'warn', format: 'pretty' },
      calendarSubscriptions: [],
    });
  });

  it('rejects unknown keys and invalid boolean values', () => {
    const configFile = yamlFile(`
caldav:
  url: https://calendar.example.test
  username: dayfront
  password: do-not-print-me
unexpected: true
`);

    expect(() =>
      loadConfig({
        configFile,
        environment: { DAYFRONT_SERVER_TRUST_PROXY: 'yes' },
      }),
    ).toThrow(ConfigurationError);

    try {
      loadConfig({
        configFile,
        environment: { DAYFRONT_SERVER_TRUST_PROXY: 'yes' },
      });
    } catch (error: unknown) {
      expect(String(error)).not.toContain('do-not-print-me');
      expect(String(error)).toContain('unexpected');
      expect(String(error)).toContain('server.trustProxy');
    }
  });

  it('reports a missing explicit file without leaking credentials', () => {
    expect(() =>
      loadConfig({
        configFile: '/definitely/missing/dayfront.yaml',
        environment: { DAYFRONT_CALDAV_PASSWORD: 'never-print-this' },
      }),
    ).toThrow('Configuration file not found');
  });
});
