import { describe, expect, it } from 'vitest';

import { mapTaskResource } from '../src/calendar/task-mapper.js';

function taskResource(calendarData: string) {
  return {
    url: 'http://caldav.test/calendars/personal/task.ics',
    etag: '"task-v1"',
    calendarData,
  };
}

describe('task mapping', () => {
  it('maps dated completed VTODO properties', () => {
    const tasks = mapTaskResource(
      taskResource(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:task-1\r\nSUMMARY:File taxes\r\nDTSTART;VALUE=DATE:20260810\r\nDUE;VALUE=DATE:20260815\r\nSTATUS:COMPLETED\r\nCOMPLETED:20260812T160000Z\r\nPRIORITY:2\r\nDESCRIPTION:Keep the receipt\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
      ),
      'personal',
    );

    expect(tasks[0]).toMatchObject({
      uid: 'task-1',
      title: 'File taxes',
      start: '2026-08-10',
      due: '2026-08-15',
      allDay: true,
      status: 'completed',
      completed: true,
      completedAt: '2026-08-12T16:00:00.000Z',
      priority: 2,
      version: '"task-v1"',
    });
  });

  it('maps undated recurring tasks with safe defaults', () => {
    const tasks = mapTaskResource(
      taskResource(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:task-2\r\nSUMMARY:Check backups\r\nRRULE:FREQ=WEEKLY\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
      ),
      'personal',
    );

    expect(tasks[0]).toMatchObject({
      status: 'needs-action',
      completed: false,
      priority: 0,
      recurring: true,
      recurrenceRule: 'FREQ=WEEKLY',
    });
    expect(tasks[0]?.due).toBeUndefined();
  });

  it('maps parent and child VTODO relationships', () => {
    const tasks = mapTaskResource(
      taskResource(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:parent-task\r\nSUMMARY:Parent\r\nRELATED-TO;RELTYPE=CHILD:child-task\r\nEND:VTODO\r\nBEGIN:VTODO\r\nUID:child-task\r\nSUMMARY:Child\r\nRELATED-TO;RELTYPE=PARENT:parent-task\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
      ),
      'personal',
    );

    expect(tasks.find((task) => task.uid === 'parent-task')).toMatchObject({
      childUids: ['child-task'],
    });
    expect(tasks.find((task) => task.uid === 'child-task')).toMatchObject({
      parentUid: 'parent-task',
    });
  });

  it('expands recurring task dates within the requested range', () => {
    const tasks = mapTaskResource(
      taskResource(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:task-3\r\nSUMMARY:Weekly review\r\nDTSTART;VALUE=DATE:20260801\r\nDUE;VALUE=DATE:20260803\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
      ),
      'personal',
      {
        start: new Date('2026-08-01T00:00:00Z'),
        end: new Date('2026-09-01T00:00:00Z'),
        maxOccurrences: 100,
      },
    );

    expect(tasks.map((task) => task.due)).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
    ]);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(3);
    expect(tasks.every((task) => task.recurring && task.recurrenceId)).toBe(
      true,
    );
  });
});
