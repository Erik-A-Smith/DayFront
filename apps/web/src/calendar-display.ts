import type { CalendarEvent, CalendarTask } from '@dayfront/shared';

export function taskCalendarRange(
  task: Pick<CalendarTask, 'start' | 'due' | 'allDay'>,
): { start: string; end?: string } | undefined {
  const point = task.due ?? task.start;
  if (!point) return undefined;
  if (!task.start || !task.due) return { start: point };
  if (!task.allDay) {
    return task.start < task.due
      ? { start: task.start, end: task.due }
      : { start: point };
  }

  // FullCalendar treats an all-day end as exclusive. VTODO's due date is the
  // final day users expect to see, so advance the display end by one day.
  const [year, month, day] = task.due.split('-').map(Number);
  const exclusiveEnd = new Date(Date.UTC(year!, month! - 1, day! + 1))
    .toISOString()
    .slice(0, 10);
  return { start: task.start, end: exclusiveEnd };
}

/** Use DTEND when available: DTSTART alone does not tell us an event is over. */
export function eventHasEnded(
  event: Pick<CalendarEvent, 'end'>,
  now: Date = new Date(),
): boolean {
  if (!event.end) return false;
  const end = Date.parse(event.end);
  return Number.isFinite(end) && end <= now.getTime();
}
