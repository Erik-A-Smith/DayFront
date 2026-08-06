import { z } from 'zod';

export const calendarSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  components: z.array(z.enum(['VEVENT', 'VTODO', 'VJOURNAL'])),
  readOnly: z.boolean().optional(),
});

export type Calendar = z.infer<typeof calendarSchema>;

export const calendarMutationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2_000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  components: z
    .array(z.enum(['VEVENT', 'VTODO']))
    .min(1)
    .default(['VEVENT', 'VTODO']),
});

export type CalendarMutation = z.infer<typeof calendarMutationSchema>;

export const calendarEventSchema = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  calendarId: z.string().min(1),
  uid: z.string().min(1),
  title: z.string(),
  start: z.string(),
  end: z.string().optional(),
  allDay: z.boolean(),
  description: z.string().optional(),
  location: z.string().optional(),
  version: z.string().min(1),
  entryType: z.enum(['event', 'note', 'todo']).default('event'),
  recurring: z.boolean(),
  recurrenceId: z.string().optional(),
  recurrenceRule: z.string().optional(),
  readOnly: z.boolean().optional(),
});

export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const eventMutationSchema = z
  .object({
    calendarId: z.string().min(1),
    title: z.string().trim().min(1).max(500),
    start: z.string().min(1),
    end: z.string().optional(),
    allDay: z.boolean(),
    description: z.string().max(100_000).optional(),
    location: z.string().max(2_000).optional(),
    recurrenceRule: z.string().max(2_000).nullable().optional(),
    recurrenceScope: z.enum(['series', 'occurrence']).optional(),
    recurrenceId: z.string().optional(),
    occurrenceStart: z.string().optional(),
  })
  .superRefine((value, context) => {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const valid = (date: string) =>
      value.allDay
        ? dateOnly.test(date)
        : Number.isFinite(new Date(date).getTime());
    if (!valid(value.start)) {
      context.addIssue({
        code: 'custom',
        path: ['start'],
        message: 'Start is invalid.',
      });
    }
    if (value.end && !valid(value.end)) {
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'End is invalid.',
      });
    }
    if (
      value.end &&
      valid(value.start) &&
      valid(value.end) &&
      new Date(value.start).getTime() >= new Date(value.end).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'Start must be before end.',
      });
    }
    if (value.recurrenceScope === 'occurrence' && !value.recurrenceId) {
      context.addIssue({
        code: 'custom',
        path: ['recurrenceId'],
        message: 'The occurrence identifier is required.',
      });
    }
  });

export type EventMutation = z.infer<typeof eventMutationSchema>;

export const taskStatusSchema = z.enum([
  'needs-action',
  'in-process',
  'completed',
  'cancelled',
]);

export const calendarTaskSchema = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  calendarId: z.string().min(1),
  uid: z.string().min(1),
  title: z.string(),
  start: z.string().optional(),
  due: z.string().optional(),
  allDay: z.boolean(),
  description: z.string().optional(),
  status: taskStatusSchema,
  completed: z.boolean(),
  completedAt: z.string().optional(),
  priority: z.number().int().min(0).max(9),
  version: z.string().min(1),
  entryType: z.literal('todo').default('todo'),
  recurring: z.boolean(),
  recurrenceRule: z.string().optional(),
  recurrenceId: z.string().optional(),
  parentUid: z.string().min(1).optional(),
  childUids: z.array(z.string().min(1)).optional(),
});

export type CalendarTask = z.infer<typeof calendarTaskSchema>;

export const taskMutationSchema = z
  .object({
    calendarId: z.string().min(1),
    title: z.string().trim().min(1).max(500),
    start: z.string().optional(),
    due: z.string().optional(),
    allDay: z.boolean(),
    description: z.string().max(100_000).optional(),
    status: taskStatusSchema.default('needs-action'),
    priority: z.number().int().min(0).max(9).default(0),
    recurrenceRule: z.string().max(2_000).nullable().optional(),
    recurrenceId: z.string().optional(),
    occurrenceStart: z.string().optional(),
    recurrenceScope: z.enum(['series', 'occurrence']).optional(),
    parentUid: z.string().min(1).nullable().optional(),
  })
  .superRefine((value, context) => {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    for (const field of ['start', 'due'] as const) {
      const item = value[field];
      if (
        item &&
        (value.allDay
          ? !dateOnly.test(item)
          : !Number.isFinite(new Date(item).getTime()))
      ) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is invalid.`,
        });
      }
    }
    if (
      value.start &&
      value.due &&
      new Date(value.start).getTime() > new Date(value.due).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['due'],
        message: 'Due must not be before start.',
      });
    }
    if (
      typeof value.recurrenceRule === 'string' &&
      !value.start &&
      !value.due
    ) {
      context.addIssue({
        code: 'custom',
        path: ['start'],
        message: 'Recurring tasks require a start or due date.',
      });
    }
  });

export type TaskMutation = z.infer<typeof taskMutationSchema>;

const responseMetaSchema = z.object({
  requestId: z.string().min(1),
  warnings: z.array(z.string()).optional(),
});

export const calendarTasksResponseSchema = z.object({
  data: z.array(calendarTaskSchema),
  meta: responseMetaSchema,
});

export const calendarTaskResponseSchema = z.object({
  data: calendarTaskSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export const calendarEventResponseSchema = z.object({
  data: calendarEventSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export const publicConfigSchema = z.object({
  data: z.object({
    authentication: z
      .object({ mode: z.enum(['single-user', 'caldav-login']) })
      .default({ mode: 'single-user' }),
    ui: z.object({
      defaultView: z.enum(['month', 'week', 'day', 'agenda']),
      darkMode: z.enum(['auto', 'light', 'dark']),
      timeFormat: z.enum(['12h', '24h']).default('12h'),
      defaultCalendar: z.string().optional(),
      sidebar: z
        .object({
          enabled: z.boolean(),
          defaultOpen: z.boolean().default(false),
          showBrand: z.boolean(),
          showTasks: z.boolean(),
          showCalendars: z.boolean(),
        })
        .default({
          enabled: true,
          defaultOpen: false,
          showBrand: true,
          showTasks: true,
          showCalendars: true,
        }),
    }),
    calendar: z.object({
      timezone: z.string(),
      weekStartsOn: z.union([
        z.literal('locale'),
        z.number().int().min(0).max(6),
      ]),
      maxOccurrences: z.number().int().positive(),
    }),
  }),
  meta: z.object({ requestId: z.string().min(1) }),
});

export const calendarsResponseSchema = z.object({
  data: z.array(calendarSchema),
  meta: responseMetaSchema,
});

export const calendarResponseSchema = z.object({
  data: calendarSchema,
  meta: z.object({ requestId: z.string().min(1) }),
});

export const calendarEventsResponseSchema = z.object({
  data: z.array(calendarEventSchema),
  meta: responseMetaSchema,
});
