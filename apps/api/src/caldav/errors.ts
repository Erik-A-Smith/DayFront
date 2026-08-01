export type CalDavErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'CALDAV_UNAVAILABLE'
  | 'CALDAV_PROTOCOL_ERROR'
  | 'REQUEST_TIMEOUT';

export class CalDavError extends Error {
  constructor(
    public readonly code: CalDavErrorCode,
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CalDavError';
  }
}
