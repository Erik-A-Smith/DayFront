import { z } from 'zod';

export const healthResponseSchema = z.object({
  data: z.object({
    status: z.literal('ok'),
    service: z.literal('dayfront-api'),
  }),
  meta: z.object({
    requestId: z.string().min(1),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  data: z.object({
    status: z.enum(['ready', 'not-ready']),
    checks: z.object({
      configuration: z.enum(['pending', 'ok', 'failed']),
      caldav: z.enum(['pending', 'ok', 'failed']),
    }),
  }),
  meta: z.object({
    requestId: z.string().min(1),
  }),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
