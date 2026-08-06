import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { taskCalendarRange } from '../src/calendar-display.js';
import { CalendarManager } from '../src/CalendarManager.js';
import { ClockInput } from '../src/ClockInput.js';
import { EventDialog } from '../src/EventDialog.js';
import { TaskDialog } from '../src/TaskDialog.js';

describe('DayFront calendar', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('formats and selects time using a 24-hour clock', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ClockInput label="Start time" value="17:05" onChange={onChange} />,
    );
    expect(
      screen.getByRole('button', { name: 'Start time' }),
    ).toHaveTextContent('5:05 PM');

    rerender(
      <ClockInput
        label="Start time"
        value="17:05"
        timeFormat="24h"
        onChange={onChange}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Start time' }),
    ).toHaveTextContent('17:05');

    fireEvent.click(screen.getByRole('button', { name: 'Start time' }));
    fireEvent.click(screen.getByRole('button', { name: '23' }));
    fireEvent.click(screen.getByRole('button', { name: '30' }));

    expect(onChange).toHaveBeenCalledWith('23:30');
    expect(screen.queryByText('Choose AM or PM')).not.toBeInTheDocument();
  });

  it('prompts for CalDAV credentials in multi-user mode and signs in', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const data = url.endsWith('/config')
        ? {
            authentication: { mode: 'caldav-login' },
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
              maxOccurrences: 5000,
            },
          }
        : url.endsWith('/auth/session')
          ? { mode: 'caldav-login', authenticated: false }
          : url.endsWith('/auth/login')
            ? {
                mode: 'caldav-login',
                authenticated: true,
                username: 'alice',
              }
            : [];
      return Promise.resolve(
        new Response(
          JSON.stringify({ data, meta: { requestId: 'auth-request' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Sign in to DayFront' }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('button', { name: 'Sign out' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'alice', password: 'secret' }),
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Hide sidebar' }),
    );
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    const toolbarButtons = Array.from(
      signOut.closest('.fc-toolbar-chunk')?.querySelectorAll('button') ?? [],
    );
    expect(toolbarButtons.at(-1)).toBe(signOut);
    fireEvent.click(signOut);
    expect(
      await screen.findByRole('heading', { name: 'Sign in to DayFront' }),
    ).toBeVisible();
  });

  it('renders task start-to-due durations with an inclusive all-day due date', () => {
    expect(
      taskCalendarRange({
        start: '2026-08-04',
        due: '2026-08-05',
        allDay: true,
      }),
    ).toEqual({ start: '2026-08-04', end: '2026-08-06' });
    expect(
      taskCalendarRange({
        start: '2026-08-04T09:00:00.000Z',
        due: '2026-08-05T17:00:00.000Z',
        allDay: false,
      }),
    ).toEqual({
      start: '2026-08-04T09:00:00.000Z',
      end: '2026-08-05T17:00:00.000Z',
    });
  });

  it('can hide the complete sidebar from public configuration', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const body = url.includes('/api/v1/config')
        ? {
            data: {
              ui: {
                defaultView: 'month',
                darkMode: 'auto',
                sidebar: {
                  enabled: false,
                  showBrand: true,
                  showTasks: true,
                  showCalendars: true,
                },
              },
              calendar: {
                timezone: 'local',
                weekStartsOn: 'locale',
                maxOccurrences: 5000,
              },
            },
            meta: { requestId: 'config-request' },
          }
        : { data: [], meta: { requestId: 'empty-request' } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.queryByText('Loading DayFront…')).not.toBeInTheDocument();
      expect(document.querySelector('#sidebar')).toBeNull();
    });
    expect(
      screen.queryByRole('button', { name: 'Hide sidebar' }),
    ).not.toBeInTheDocument();
  });

  it('can start with the sidebar collapsed from public configuration', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const body = url.includes('/api/v1/config')
        ? {
            data: {
              ui: {
                defaultView: 'month',
                darkMode: 'auto',
                sidebar: {
                  enabled: true,
                  defaultOpen: false,
                  showBrand: true,
                  showTasks: true,
                  showCalendars: true,
                },
              },
              calendar: {
                timezone: 'local',
                weekStartsOn: 'locale',
                maxOccurrences: 5000,
              },
            },
            meta: { requestId: 'config-request' },
          }
        : { data: [], meta: { requestId: 'empty-request' } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Show sidebar' }),
      ).toBeVisible(),
    );
    expect(document.querySelector('#sidebar')).not.toBeVisible();
    expect(getComputedStyle(document.querySelector('#sidebar')!).display).toBe(
      'none',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(document.querySelector('#sidebar')).toBeVisible();
  });

  it('creates and safely deletes calendars from the manager', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const calendar = {
      id: 'personal',
      displayName: 'Personal',
      color: '#5b8def',
      components: ['VEVENT', 'VTODO'] as ('VEVENT' | 'VTODO')[],
    };
    render(
      <CalendarManager
        calendars={[calendar]}
        onClose={() => undefined}
        onSave={onSave}
        onDelete={onDelete}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Manage calendars' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'New calendar' }));
    expect(screen.getByRole('heading', { name: 'New calendar' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Projects' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          name: 'Projects',
          components: ['VEVENT', 'VTODO'],
        }),
      ),
    );

    vi.spyOn(window, 'prompt').mockReturnValue('Personal');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(calendar));
  });

  it('discovers calendars and renders their events', async () => {
    window.history.replaceState(null, '', '/?date=2026-03-12');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const body =
          init?.method === 'PUT' &&
          url.includes('/api/v1/tasks/task-resource-3')
            ? {
                data: {
                  id: 'subtask-1',
                  resourceId: 'task-resource-3',
                  calendarId: 'personal',
                  uid: 'subtask-1',
                  parentUid: 'task-1',
                  title: 'Nested fixture subtask',
                  allDay: true,
                  status: 'needs-action',
                  completed: false,
                  priority: 0,
                  version: '"task-v4"',
                  entryType: 'todo',
                  recurring: false,
                },
                meta: { requestId: 'task-update-request' },
              }
            : url.includes('/api/v1/config')
              ? {
                  data: {
                    ui: { defaultView: 'month', darkMode: 'auto' },
                    calendar: {
                      timezone: 'local',
                      weekStartsOn: 'locale',
                      maxOccurrences: 5000,
                    },
                  },
                  meta: { requestId: 'config-request' },
                }
              : url.includes('/calendars')
                ? {
                    data: [
                      {
                        id: 'personal',
                        displayName: 'Personal',
                        color: '#5b8def',
                        components: ['VEVENT'],
                      },
                    ],
                    meta: { requestId: 'calendar-request' },
                  }
                : url.includes('/tasks')
                  ? {
                      data: [
                        {
                          id: 'task-1',
                          resourceId: 'task-resource-1',
                          calendarId: 'personal',
                          uid: 'task-1',
                          title: 'Undated fixture task',
                          allDay: true,
                          status: 'needs-action',
                          completed: false,
                          priority: 0,
                          version: '"task-v1"',
                          entryType: 'todo',
                          recurring: false,
                          childUids: ['subtask-1'],
                        },
                        {
                          id: 'task-2',
                          resourceId: 'task-resource-2',
                          calendarId: 'personal',
                          uid: 'task-2',
                          title: 'Completed fixture task',
                          allDay: true,
                          status: 'completed',
                          completed: true,
                          priority: 0,
                          version: '"task-v2"',
                          entryType: 'todo',
                          recurring: false,
                        },
                        {
                          id: 'subtask-1',
                          resourceId: 'task-resource-3',
                          calendarId: 'personal',
                          uid: 'subtask-1',
                          parentUid: 'task-1',
                          title: 'Nested fixture subtask',
                          allDay: true,
                          status: 'needs-action',
                          completed: false,
                          priority: 0,
                          version: '"task-v3"',
                          entryType: 'todo',
                          recurring: false,
                        },
                        {
                          id: 'subtask-2',
                          resourceId: 'task-resource-4',
                          calendarId: 'personal',
                          uid: 'subtask-2',
                          parentUid: 'task-1',
                          title: 'Completed nested subtask',
                          allDay: true,
                          status: 'completed',
                          completed: true,
                          priority: 0,
                          version: '"task-v4"',
                          entryType: 'todo',
                          recurring: false,
                        },
                        {
                          id: 'subtask-3',
                          resourceId: 'task-resource-5',
                          calendarId: 'personal',
                          uid: 'subtask-3',
                          parentUid: 'task-2',
                          title: 'Incomplete child of completed task',
                          allDay: true,
                          status: 'needs-action',
                          completed: false,
                          priority: 0,
                          version: '"task-v5"',
                          entryType: 'todo',
                          recurring: false,
                        },
                      ],
                      meta: { requestId: 'task-request' },
                    }
                  : {
                      data: [
                        {
                          id: 'event-1',
                          resourceId: 'resource-1',
                          calendarId: 'personal',
                          uid: 'event-1',
                          title: 'Fixture event',
                          start: new Date().toISOString(),
                          allDay: false,
                          entryType: 'event',
                          recurring: false,
                          version: '"v1"',
                        },
                      ],
                      meta: { requestId: 'event-request' },
                    };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      });

    render(<App />);

    await waitFor(() =>
      expect(document.querySelector('.fc-toolbar-title')).toHaveTextContent(
        'March 2026',
      ),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show sidebar' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'DayFront' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Personal')).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('date')).toBe(
      '2026-03-12',
    );
    const calendarSummary = screen.getByText('Calendars').closest('summary');
    expect(screen.getByText('Personal')).not.toBeVisible();
    fireEvent.click(calendarSummary!);
    expect(screen.getByText('Personal')).toBeVisible();
    fireEvent.click(calendarSummary!);
    expect(screen.getByText('Personal')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'New task' })).toBeVisible();
    const taskSummary = screen.getByText('Tasks').closest('summary');
    fireEvent.click(taskSummary!);
    expect(screen.getByRole('button', { name: 'New task' })).not.toBeVisible();
    fireEvent.click(taskSummary!);
    expect(screen.getByRole('button', { name: 'New task' })).toBeVisible();
    expect(await screen.findByText('Undated fixture task')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Complete Undated fixture task' }),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          return (
            url.includes('/api/v1/tasks/task-resource-1') &&
            init?.method === 'PUT'
          );
        }),
      ).toBe(true);
    });
    expect(
      screen.queryByText('Nested fixture subtask'),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show subtasks for Undated fixture task',
      }),
    );
    expect(
      screen.getByText('Nested fixture subtask').closest('ul'),
    ).toHaveClass('subtask-list');
    fireEvent.click(screen.getByText('Nested fixture subtask'));
    expect(screen.getByRole('heading', { name: 'Edit subtask' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Completed' })).toBeVisible();
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument();
    expect(screen.queryByText('Repeats')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Complete Nested fixture subtask' }),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          return (
            url.includes('/api/v1/tasks/task-resource-3') &&
            init?.method === 'PUT'
          );
        }),
      ).toBe(true);
    });
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', {
          name: 'Complete Nested fixture subtask',
        }),
      ).not.toBeDisabled(),
    );

    const completedSummary = screen
      .getByText('Completed', {
        selector: '.task-group summary span:first-child',
      })
      .closest('summary');
    expect(completedSummary?.parentElement).not.toHaveAttribute('open');
    fireEvent.click(completedSummary!);
    expect(await screen.findByText('Completed fixture task')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(document.querySelector('#sidebar')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(document.querySelector('#sidebar')).toBeVisible();

    const titleBeforeWheel =
      document.querySelector('.fc-toolbar-title')?.textContent;
    fireEvent.wheel(screen.getByRole('main'), { deltaY: 100 });
    await waitFor(() =>
      expect(document.querySelector('.fc-toolbar-title')?.textContent).not.toBe(
        titleBeforeWheel,
      ),
    );
    expect(new URL(window.location.href).searchParams.get('date')).not.toBe(
      '2026-03-12',
    );

    const titleBeforeScrolling =
      document.querySelector('.fc-toolbar-title')?.textContent;
    const scrollSurface = document.createElement('div');
    scrollSurface.style.overflowY = 'auto';
    Object.defineProperty(scrollSurface, 'clientHeight', { value: 100 });
    Object.defineProperty(scrollSurface, 'scrollHeight', { value: 500 });
    screen.getByRole('main').append(scrollSurface);
    fireEvent.wheel(scrollSurface, { deltaY: 100 });
    expect(document.querySelector('.fc-toolbar-title')?.textContent).toBe(
      titleBeforeScrolling,
    );

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear completed' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          return (
            url.includes('/api/v1/tasks/task-resource-2') &&
            init?.method === 'DELETE'
          );
        }),
      ).toBe(true);
    });
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return (
          url.includes('/api/v1/tasks/task-resource-4') &&
          init?.method === 'DELETE'
        );
      }),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return (
          url.includes('/api/v1/tasks/task-resource-5') &&
          init?.method === 'DELETE'
        );
      }),
    ).toBe(true);

    fireEvent.click(screen.getByText('Undated fixture task'));
    expect(
      screen.getByRole('heading', { name: 'Edit task' }),
    ).toBeInTheDocument();
    const subtaskUpdatesBefore = fetchMock.mock.calls.filter(
      ([input, init]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return (
          url.includes('/api/v1/tasks/task-resource-3') &&
          init?.method === 'PUT'
        );
      },
    ).length;
    const taskDialog = within(screen.getByRole('dialog'));
    fireEvent.click(
      taskDialog.getByRole('checkbox', {
        name: 'Complete Nested fixture subtask',
      }),
    );
    await waitFor(() => {
      const updates = fetchMock.mock.calls.filter(([input, init]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return (
          url.includes('/api/v1/tasks/task-resource-3') &&
          init?.method === 'PUT'
        );
      }).length;
      expect(updates).toBeGreaterThan(subtaskUpdatesBefore);
    });
    fireEvent.change(screen.getByLabelText('New subtask title'), {
      target: { value: 'Another child' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          return (
            url.includes('/api/v1/calendars/personal/tasks') &&
            init?.method === 'POST' &&
            typeof init.body === 'string' &&
            init.body.includes('"title":"Another child"') &&
            init.body.includes('"parentUid":"task-1"')
          );
        }),
      ).toBe(true);
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Nested fixture subtask' }),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          return (
            url.includes('/api/v1/tasks/task-resource-3') &&
            init?.method === 'DELETE'
          );
        }),
      ).toBe(true);
    });
    fireEvent.click(
      taskDialog.getByRole('button', { name: 'Nested fixture subtask' }),
    );
    expect(screen.getByRole('heading', { name: 'Edit subtask' })).toBeVisible();
    expect(screen.getByLabelText('Title')).toHaveValue(
      'Nested fixture subtask',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Edit task' })).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Nested fixture subtask',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByRole('heading', { name: 'Edit task' }),
    ).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Nested fixture subtask',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByRole('heading', { name: 'Edit task' }),
    ).toBeVisible();
    const childDeletesBeforeParent = fetchMock.mock.calls.filter(
      ([input, init]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return (
          url.includes('/api/v1/tasks/task-resource-3') &&
          init?.method === 'DELETE'
        );
      },
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      const childDeletes = fetchMock.mock.calls.filter(([input, init]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return (
          url.includes('/api/v1/tasks/task-resource-3') &&
          init?.method === 'DELETE'
        );
      }).length;
      expect(childDeletes).toBeGreaterThan(childDeletesBeforeParent);
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          return (
            url.includes('/api/v1/tasks/task-resource-1') &&
            init?.method === 'DELETE'
          );
        }),
      ).toBe(true);
    });
    await waitFor(() => {
      const requestedEvents = fetchMock.mock.calls.some(([input]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return url.includes('/api/v1/events');
      });
      expect(requestedEvents).toBe(true);
    });
  });

  it('separates a selected date and time with a one-hour default', () => {
    render(
      <EventDialog
        calendars={[
          {
            id: 'personal',
            displayName: 'Personal',
            components: ['VEVENT'],
          },
          {
            id: 'work',
            displayName: 'Work',
            components: ['VEVENT'],
          },
        ]}
        initialDate="2026-08-04T14:30:00-04:00"
        onCancel={() => undefined}
        onSave={() => Promise.resolve()}
      />,
    );

    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-04');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-08-04');
    expect(
      screen.getByRole('button', { name: 'Start time' }),
    ).toHaveTextContent('2:30 PM');
    expect(screen.getByRole('button', { name: 'End time' })).toHaveTextContent(
      '3:30 PM',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start time' }));
    expect(
      document.querySelector('.clock-face button.is-selected'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(
      screen.getByRole('heading', { name: 'Choose minutes' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(screen.getByRole('heading', { name: 'Choose hour' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: '45' }));
    fireEvent.click(screen.getByRole('button', { name: 'PM' }));
    expect(
      screen.getByRole('button', { name: 'Start time' }),
    ).toHaveTextContent('3:45 PM');
    expect(screen.getByRole('button', { name: 'End time' })).toHaveTextContent(
      '4:45 PM',
    );

    fireEvent.click(screen.getByRole('button', { name: 'End time' }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '15' }));
    fireEvent.click(screen.getByRole('button', { name: 'PM' }));
    expect(
      screen.getByRole('button', { name: 'Start time' }),
    ).toHaveTextContent('12:15 PM');

    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-08-06' },
    });
    expect(screen.getByLabelText('End date')).toHaveValue('2026-08-06');
    fireEvent.change(screen.getByLabelText('End date'), {
      target: { value: '2026-08-03' },
    });
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-03');
  });

  it('initializes both all-day event dates from a calendar selection', () => {
    render(
      <EventDialog
        calendars={[
          {
            id: 'personal',
            displayName: 'Personal',
            components: ['VEVENT'],
          },
        ]}
        initialDate="2026-08-04"
        onCancel={() => undefined}
        onSave={() => Promise.resolve()}
      />,
    );

    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-04');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-08-04');
  });

  it('keeps a valid event end even when the duration is under one hour', () => {
    render(
      <EventDialog
        calendars={[
          {
            id: 'personal',
            displayName: 'Personal',
            components: ['VEVENT'],
          },
        ]}
        initialDate="2026-08-04T14:30:00-04:00"
        onCancel={() => undefined}
        onSave={() => Promise.resolve()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start time' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: '00' }));
    fireEvent.click(screen.getByRole('button', { name: 'PM' }));

    expect(
      screen.getByRole('button', { name: 'Start time' }),
    ).toHaveTextContent('3:00 PM');
    expect(screen.getByRole('button', { name: 'End time' })).toHaveTextContent(
      '3:30 PM',
    );
  });

  it('keeps task start and due dates ordered when either date changes', () => {
    render(
      <TaskDialog
        calendars={[
          {
            id: 'personal',
            displayName: 'Personal',
            components: ['VTODO'],
          },
        ]}
        task={{
          id: 'task-range',
          resourceId: 'task-range-resource',
          calendarId: 'personal',
          uid: 'task-range',
          title: 'Ranged task',
          start: '2026-08-04',
          due: '2026-08-05',
          allDay: true,
          status: 'needs-action',
          completed: false,
          priority: 0,
          version: 'v1',
          entryType: 'todo',
          recurring: false,
        }}
        onCancel={() => undefined}
        onSave={() => Promise.resolve()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-08-07' },
    });
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-07');
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-08-02' },
    });
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-02');

    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-08-09' },
    });
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-09');

    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-08-01' },
    });
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-01');
  });

  it('moves a recurring task series when its calendar changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskDialog
        calendars={[
          {
            id: 'personal',
            displayName: 'Personal',
            components: ['VTODO'],
          },
          { id: 'work', displayName: 'Work', components: ['VTODO'] },
        ]}
        task={{
          id: 'recurring-task',
          resourceId: 'recurring-task-resource',
          calendarId: 'personal',
          uid: 'recurring-task',
          title: 'Recurring task',
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
        }}
        onCancel={() => undefined}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText('Calendar')).toBeEnabled();
    expect(screen.getByLabelText('Apply changes to')).toHaveValue('occurrence');
    fireEvent.change(screen.getByLabelText('Calendar'), {
      target: { value: 'work' },
    });
    expect(screen.getByLabelText('Apply changes to')).toHaveValue('series');
    expect(
      screen.getByText('Changing calendars moves the entire recurring series.'),
    ).toBeVisible();
    expect(
      within(screen.getByLabelText('Apply changes to')).getByRole('option', {
        name: 'This occurrence',
      }),
    ).toBeDisabled();
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save' }).closest('form')!,
    );
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'work',
          recurrenceScope: 'series',
        }),
        [],
      ),
    );
  });

  it('presents all-day event end dates as inclusive while saving an exclusive DTEND', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EventDialog
        calendars={[
          {
            id: 'personal',
            displayName: 'Personal',
            components: ['VEVENT'],
          },
          {
            id: 'work',
            displayName: 'Work',
            components: ['VEVENT'],
          },
        ]}
        event={{
          id: 'multi-day-event',
          resourceId: 'multi-day-resource',
          calendarId: 'personal',
          uid: 'multi-day-event',
          title: 'Multi-day event',
          start: '2026-08-04',
          end: '2026-08-07',
          allDay: true,
          version: 'v1',
          entryType: 'event',
          recurring: false,
        }}
        onCancel={() => undefined}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText('End date')).toHaveValue('2026-08-06');
    expect(screen.getByLabelText('Calendar')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Calendar'), {
      target: { value: 'work' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          start: '2026-08-04',
          end: '2026-08-07',
          allDay: true,
          calendarId: 'work',
        }),
      ),
    );
  });

  it('collects subtasks while creating a new task', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskDialog
        calendars={[
          {
            id: 'personal',
            displayName: 'Personal',
            components: ['VTODO'],
          },
        ]}
        onCancel={() => undefined}
        onSave={onSave}
      />,
    );

    const input = screen.getByLabelText('New subtask title');
    fireEvent.change(input, { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Discard me' }));
    expect(screen.queryByText('Discard me')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'First child' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'New parent' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[1]).toEqual(['First child']);
  });
});
