import { describe, expect, it } from 'vitest';
import { taskStatusInput } from '../src/App.js';
import type { CalendarTask } from '@dayfront/shared';

const task: CalendarTask = {
  id: 'today',
  resourceId: 'resource',
  calendarId: 'cal',
  uid: 'routine',
  title: 'Daily routine',
  start: '2026-08-04',
  due: '2026-08-04',
  allDay: true,
  status: 'needs-action',
  completed: false,
  priority: 0,
  version: 'v1',
  entryType: 'todo',
  recurring: true,
  recurrenceRule: 'FREQ=DAILY',
  recurrenceId: '2026-08-04',
};

describe('recurring task checkbox changes', () => {
  it('completes only the selected recurrence', () => {
    expect(taskStatusInput(task, 'completed')).toMatchObject({
      status: 'completed',
      recurrenceId: '2026-08-04',
      occurrenceStart: '2026-08-04',
      recurrenceScope: 'occurrence',
    });
  });

  it('reopens only the selected recurrence', () => {
    expect(taskStatusInput(task, 'needs-action')).toMatchObject({
      status: 'needs-action',
      recurrenceScope: 'occurrence',
      recurrenceId: '2026-08-04',
    });
  });

  it('does not invent recurrence scope for a nonrecurring task', () => {
    const result = taskStatusInput(
      { ...task, recurring: false, recurrenceId: undefined },
      'completed',
    );
    expect(result).not.toHaveProperty('recurrenceScope');
    expect(result).not.toHaveProperty('recurrenceId');
  });
});
