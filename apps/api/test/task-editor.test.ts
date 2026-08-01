import { describe, expect, it } from 'vitest';

import {
  createTaskData,
  deleteTaskOccurrenceData,
  updateTaskData,
} from '../src/calendar/task-editor.js';
import { mapTaskResource } from '../src/calendar/task-mapper.js';

const input = {
  calendarId: 'personal',
  title: 'Ship DayFront',
  start: '2026-08-01',
  due: '2026-08-05',
  allDay: true,
  description: 'Finish milestone eight',
  status: 'needs-action' as const,
  priority: 1,
  recurrenceRule: 'FREQ=WEEKLY',
};

describe('task editing', () => {
  it('creates dated recurring VTODO data with priority', () => {
    const source = createTaskData(input);

    expect(source).toContain('BEGIN:VTODO');
    expect(source).toContain('DUE;VALUE=DATE:20260805');
    expect(source).toContain('PRIORITY:1');
    expect(source).toContain('RRULE:FREQ=WEEKLY');
  });

  it('anchors a due-only recurring task at its due date', () => {
    const source = createTaskData({
      ...input,
      start: undefined,
      due: '2026-08-05',
    });

    expect(source).toContain('DTSTART;VALUE=DATE:20260805');
    expect(source).toContain('DUE;VALUE=DATE:20260805');
    expect(source).toContain('RRULE:FREQ=WEEKLY');
  });

  it('creates and removes a parent relationship for a subtask', () => {
    const childInput = {
      calendarId: 'personal',
      title: 'Child task',
      allDay: true,
      status: 'needs-action' as const,
      priority: 0,
      recurrenceRule: null,
      parentUid: 'parent-task',
    };
    const source = createTaskData(childInput);
    expect(source).toContain('RELATED-TO;RELTYPE=PARENT:parent-task');

    const detached = updateTaskData(source, {
      ...childInput,
      parentUid: null,
    });
    expect(detached).not.toContain('RELATED-TO');
  });

  it('completes and reopens while preserving recurrence', () => {
    const completed = updateTaskData(createTaskData(input), {
      ...input,
      status: 'completed',
    });
    expect(completed).toContain('STATUS:COMPLETED');
    expect(completed).toContain('COMPLETED:');
    expect(completed).toContain('PERCENT-COMPLETE:100');
    expect(completed).toContain('RRULE:FREQ=WEEKLY');

    const reopened = updateTaskData(completed, {
      ...input,
      recurrenceRule: undefined,
    });
    expect(reopened).toContain('STATUS:NEEDS-ACTION');
    expect(reopened).not.toContain('COMPLETED:');
    expect(reopened).not.toContain('PERCENT-COMPLETE:');
    expect(reopened).toContain('RRULE:FREQ=WEEKLY');
  });

  it('completes and deletes one occurrence without changing the series', () => {
    const source = createTaskData(input);
    const completed = updateTaskData(source, {
      ...input,
      start: '2026-08-08',
      due: '2026-08-12',
      status: 'completed',
      recurrenceId: '2026-08-08',
      occurrenceStart: '2026-08-08',
      recurrenceScope: 'occurrence',
    });
    expect(completed).toContain('RECURRENCE-ID;VALUE=DATE:20260808');
    expect(completed.match(/STATUS:COMPLETED/g)).toHaveLength(1);
    expect(completed).toContain('RRULE:FREQ=WEEKLY');

    const tasks = mapTaskResource(
      {
        url: 'http://radicale.test/task.ics',
        etag: '"v2"',
        calendarData: completed,
      },
      'personal',
      {
        start: new Date('2026-08-01T00:00:00Z'),
        end: new Date('2026-08-20T00:00:00Z'),
        maxOccurrences: 100,
      },
    );
    expect(tasks.map((task) => task.completed)).toEqual([false, true, false]);

    const deleted = deleteTaskOccurrenceData(completed, '2026-08-08');
    expect(deleted).toContain('EXDATE;VALUE=DATE:20260808');
    expect(deleted).not.toContain('RECURRENCE-ID');
    expect(
      mapTaskResource(
        {
          url: 'http://radicale.test/task.ics',
          etag: '"v3"',
          calendarData: deleted,
        },
        'personal',
        {
          start: new Date('2026-08-01T00:00:00Z'),
          end: new Date('2026-08-20T00:00:00Z'),
          maxOccurrences: 100,
        },
      ),
    ).toHaveLength(2);
  });
});
