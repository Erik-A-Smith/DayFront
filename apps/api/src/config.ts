import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const strictObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict();

const subscriptionSchema = strictObject({
  id: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
      'Must be a stable identifier using letters, numbers, _ or -.',
    ),
  name: z.string().trim().min(1).max(200),
  url: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'Must use HTTP or HTTPS.',
    }),
  enabled: z.boolean().default(true),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a six-digit hex color.')
    .optional(),
  refreshIntervalMs: z.number().int().min(60_000).max(31_536_000_000),
});

export type CalendarSubscriptionConfig = z.infer<typeof subscriptionSchema>;

const configSchema = strictObject({
  caldav: strictObject({
    url: z
      .url()
      .refine(
        (value) => ['http:', 'https:'].includes(new URL(value).protocol),
        {
          message: 'Must use HTTP or HTTPS.',
        },
      ),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(120_000),
  }),
  authentication: strictObject({
    mode: z.enum(['single-user', 'caldav-login']),
    sessionSecret: z.string().min(32).optional(),
    sessionSecretFile: z.string().min(1).optional(),
    sessionTtlHours: z.number().int().min(1).max(8_760),
  }),
  server: strictObject({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
    trustProxy: z.boolean(),
  }),
  ui: strictObject({
    defaultView: z.enum(['month', 'week', 'day', 'agenda']),
    darkMode: z.enum(['auto', 'light', 'dark']),
    defaultCalendar: z.string().min(1).optional(),
    sidebar: strictObject({
      enabled: z.boolean(),
      defaultOpen: z.boolean(),
      showBrand: z.boolean(),
      showTasks: z.boolean(),
      showCalendars: z.boolean(),
    }),
  }),
  calendar: strictObject({
    timezone: z.string().min(1),
    weekStartsOn: z.union([
      z.literal('locale'),
      z.number().int().min(0).max(6),
    ]),
    maxOccurrences: z.number().int().positive().max(100_000),
  }),
  logging: strictObject({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    format: z.enum(['json', 'pretty']),
  }),
  calendarSubscriptions: z.array(subscriptionSchema),
}).superRefine((config, context) => {
  if (config.authentication.mode === 'single-user') {
    if (!config.caldav.username)
      context.addIssue({
        code: 'custom',
        path: ['caldav', 'username'],
        message: 'Required in single-user authentication mode.',
      });
    if (!config.caldav.password)
      context.addIssue({
        code: 'custom',
        path: ['caldav', 'password'],
        message: 'Required in single-user authentication mode.',
      });
  }
  if (
    config.authentication.mode === 'caldav-login' &&
    !config.authentication.sessionSecret
  )
    context.addIssue({
      code: 'custom',
      path: ['authentication', 'sessionSecret'],
      message:
        'Required in caldav-login mode and must contain at least 32 characters.',
    });
});

export type DayFrontConfig = z.infer<typeof configSchema>;
export type PublicConfig = Pick<DayFrontConfig, 'ui' | 'calendar'> & {
  authentication: { mode: DayFrontConfig['authentication']['mode'] };
};

const defaults = {
  caldav: { timeoutMs: 10_000 },
  authentication: { mode: 'single-user', sessionTtlHours: 24 * 30 },
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
} as const;

const configurationWarnings = new WeakMap<DayFrontConfig, readonly string[]>();

function parseDuration(value: unknown): number | undefined {
  if (value === undefined) return 24 * 60 * 60 * 1_000;
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+)(m|h|d)$/.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = { m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as 'm' | 'h' | 'd'
  ];
  const result = amount * multiplier;
  return Number.isSafeInteger(result) &&
    result >= 60_000 &&
    result <= 31_536_000_000
    ? result
    : undefined;
}

function subscriptions(value: unknown): {
  data: CalendarSubscriptionConfig[];
  warnings: string[];
} {
  if (value === undefined) return { data: [], warnings: [] };
  if (!Array.isArray(value))
    return {
      data: [],
      warnings: [
        'calendar_subscriptions must be a list; all subscriptions were ignored.',
      ],
    };
  const counts = new Map<string, number>();
  for (const item of value)
    if (isRecord(item) && typeof item.id === 'string')
      counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  const data: CalendarSubscriptionConfig[] = [];
  const warnings: string[] = [];
  value.forEach((item, index) => {
    if (
      isRecord(item) &&
      typeof item.id === 'string' &&
      (counts.get(item.id) ?? 0) > 1
    ) {
      warnings.push(
        `calendar_subscriptions[${index}] has duplicate id "${item.id}" and was ignored.`,
      );
      return;
    }
    const refreshIntervalMs = isRecord(item)
      ? parseDuration(item.refresh_interval)
      : undefined;
    const normalized: unknown = isRecord(item)
      ? { ...item, refreshIntervalMs, enabled: item.enabled ?? true }
      : item;
    if (isRecord(normalized)) delete normalized.refresh_interval;
    const result = subscriptionSchema.safeParse(normalized);
    if (result.success) data.push(result.data);
    else
      warnings.push(
        `calendar_subscriptions[${index}] was ignored: ${result.error.issues.map((issue) => `${issue.path.join('.') || 'entry'} ${issue.message}`).join('; ')}`,
      );
  });
  return { data, warnings };
}

const envPaths = {
  DAYFRONT_CALDAV_URL: ['caldav', 'url'],
  DAYFRONT_CALDAV_USERNAME: ['caldav', 'username'],
  DAYFRONT_CALDAV_PASSWORD: ['caldav', 'password'],
  DAYFRONT_CALDAV_TIMEOUT_MS: ['caldav', 'timeoutMs'],
  DAYFRONT_AUTH_MODE: ['authentication', 'mode'],
  DAYFRONT_AUTH_SESSION_SECRET: ['authentication', 'sessionSecret'],
  DAYFRONT_AUTH_SESSION_SECRET_FILE: ['authentication', 'sessionSecretFile'],
  DAYFRONT_AUTH_SESSION_TTL_HOURS: ['authentication', 'sessionTtlHours'],
  DAYFRONT_SERVER_HOST: ['server', 'host'],
  DAYFRONT_SERVER_PORT: ['server', 'port'],
  DAYFRONT_SERVER_TRUST_PROXY: ['server', 'trustProxy'],
  DAYFRONT_UI_DEFAULT_VIEW: ['ui', 'defaultView'],
  DAYFRONT_UI_DARK_MODE: ['ui', 'darkMode'],
  DAYFRONT_UI_DEFAULT_CALENDAR: ['ui', 'defaultCalendar'],
  DAYFRONT_UI_SIDEBAR_ENABLED: ['ui', 'sidebar', 'enabled'],
  DAYFRONT_UI_SIDEBAR_DEFAULT_OPEN: ['ui', 'sidebar', 'defaultOpen'],
  DAYFRONT_UI_SIDEBAR_SHOW_BRAND: ['ui', 'sidebar', 'showBrand'],
  DAYFRONT_UI_SIDEBAR_SHOW_TASKS: ['ui', 'sidebar', 'showTasks'],
  DAYFRONT_UI_SIDEBAR_SHOW_CALENDARS: ['ui', 'sidebar', 'showCalendars'],
  DAYFRONT_CALENDAR_TIMEZONE: ['calendar', 'timezone'],
  DAYFRONT_CALENDAR_WEEK_STARTS_ON: ['calendar', 'weekStartsOn'],
  DAYFRONT_CALENDAR_MAX_OCCURRENCES: ['calendar', 'maxOccurrences'],
  DAYFRONT_LOG_LEVEL: ['logging', 'level'],
  DAYFRONT_LOG_FORMAT: ['logging', 'format'],
} as const;

const numericVariables = new Set([
  'DAYFRONT_CALDAV_TIMEOUT_MS',
  'DAYFRONT_AUTH_SESSION_TTL_HOURS',
  'DAYFRONT_SERVER_PORT',
  'DAYFRONT_CALENDAR_MAX_OCCURRENCES',
]);

export class ConfigurationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(
      `Invalid DayFront configuration:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
    );
    this.name = 'ConfigurationError';
  }
}

type ConfigRecord = Record<string, unknown>;

function merge(base: ConfigRecord, override: ConfigRecord): ConfigRecord {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      isRecord(current) && isRecord(value) ? merge(current, value) : value;
  }
  return result;
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEnvironment(name: string, value: string): unknown {
  if (numericVariables.has(name)) return Number(value);
  if (
    name === 'DAYFRONT_SERVER_TRUST_PROXY' ||
    name.startsWith('DAYFRONT_UI_SIDEBAR_')
  ) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  if (name === 'DAYFRONT_CALENDAR_WEEK_STARTS_ON' && value !== 'locale') {
    return Number(value);
  }
  return value;
}

function environmentConfig(environment: NodeJS.ProcessEnv): ConfigRecord {
  const result: ConfigRecord = {};
  for (const [name, path] of Object.entries(envPaths)) {
    const value = environment[name];
    if (value === undefined) continue;
    let section = result;
    for (const key of path.slice(0, -1))
      section = (section[key] ??= {}) as ConfigRecord;
    section[path.at(-1)!] = parseEnvironment(name, value);
  }
  return result;
}

function readYaml(path: string, required: boolean): ConfigRecord {
  try {
    const parsed: unknown = parseYaml(readFileSync(path, 'utf8'));
    if (parsed === null || parsed === undefined) return {};
    if (!isRecord(parsed))
      throw new ConfigurationError(['Configuration root must be an object.']);
    return parsed;
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) throw error;
    if (isMissingFile(error) && !required) return {};
    if (isMissingFile(error))
      throw new ConfigurationError([`Configuration file not found: ${path}`]);
    throw new ConfigurationError([
      `Could not parse configuration file: ${path}`,
    ]);
  }
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

export interface LoadConfigOptions {
  environment?: NodeJS.ProcessEnv;
  configFile?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): DayFrontConfig {
  const environment = options.environment ?? process.env;
  const explicitPath = options.configFile ?? environment.DAYFRONT_CONFIG_FILE;
  const path = explicitPath ?? '/config/config.yaml';
  const yaml = readYaml(path, explicitPath !== undefined);
  const parsedSubscriptions = subscriptions(yaml.calendar_subscriptions);
  delete yaml.calendar_subscriptions;
  const candidate = merge(
    merge(defaults, yaml),
    environmentConfig(environment),
  );
  const authentication = candidate.authentication;
  if (
    isRecord(authentication) &&
    authentication.mode === 'caldav-login' &&
    authentication.sessionSecret === undefined &&
    typeof authentication.sessionSecretFile === 'string'
  ) {
    authentication.sessionSecret = sessionSecret(
      authentication.sessionSecretFile,
    );
  }
  candidate.calendarSubscriptions = parsedSubscriptions.data;
  const result = configSchema.safeParse(candidate);

  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`,
      ),
    );
  }
  configurationWarnings.set(result.data, parsedSubscriptions.warnings);
  return result.data;
}

function sessionSecret(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (error: unknown) {
    if (!isMissingFile(error))
      throw new ConfigurationError([
        `Could not read authentication session secret file: ${path}`,
      ]);
  }

  const generated = randomBytes(48).toString('base64url');
  try {
    writeFileSync(path, `${generated}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    return generated;
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'EEXIST') {
      try {
        return readFileSync(path, 'utf8').trim();
      } catch {
        // Fall through to the actionable configuration error below.
      }
    }
    throw new ConfigurationError([
      `Could not create authentication session secret file: ${path}`,
    ]);
  }
}

export function getConfigurationWarnings(
  config: DayFrontConfig,
): readonly string[] {
  return configurationWarnings.get(config) ?? [];
}

export function getPublicConfig(config: DayFrontConfig): PublicConfig {
  return {
    ui: config.ui,
    calendar: config.calendar,
    authentication: { mode: config.authentication.mode },
  };
}
