import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Calendar, CalendarTask } from '@dayfront/shared';

import { CalendarManager } from '../src/CalendarManager.js';
import { TaskDialog } from '../src/TaskDialog.js';

const calendar: Calendar = {
  id: 'calendar-1',
  displayName: 'Personal',
  color: '#8bb8ff',
  components: ['VEVENT', 'VTODO'],
  readOnly: false,
};

describe('dialog checkboxes', () => {
  it('updates calendar component choices', () => {
    render(
      <CalendarManager
        calendars={[calendar]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const events = screen.getByRole('checkbox', { name: 'Events' });
    const tasks = screen.getByRole('checkbox', { name: 'Tasks' });

    expect(events).toBeChecked();
    expect(tasks).toBeChecked();
    fireEvent.click(events);
    fireEvent.click(tasks);
    expect(events).not.toBeChecked();
    expect(tasks).not.toBeChecked();
  });

  it('updates a task completion state', () => {
    const task: CalendarTask = {
      id: 'task-1',
      resourceId: 'task-resource-1',
      uid: 'task-1',
      calendarId: calendar.id,
      title: 'Ship the refresh',
      allDay: true,
      status: 'needs-action',
      completed: false,
      priority: 0,
      recurring: false,
      entryType: 'todo',
      version: 'v1',
    };

    render(
      <TaskDialog
        calendars={[calendar]}
        task={task}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const completed = screen.getByRole('checkbox', { name: 'Completed' });
    expect(completed).not.toBeChecked();
    fireEvent.click(completed);
    expect(completed).toBeChecked();
  });
});
