import dayGridPlugin from '@fullcalendar/daygrid';
import type { EventDropArg } from '@fullcalendar/core';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react';

import {
  calendarEventSchema,
  calendarTaskSchema,
  type Calendar,
  type CalendarEvent,
  type CalendarMutation,
  type CalendarTask,
  type EventMutation,
  type TaskMutation,
} from '@dayfront/shared';

import {
  createEvent,
  createCalendar,
  createTask,
  deleteEvent,
  deleteCalendar,
  deleteTask,
  getCalendars,
  getEvents,
  getPublicConfig,
  getTaskList,
  getTasks,
  updateEvent,
  updateCalendar,
  updateTask,
} from './api.js';
import { EventDialog } from './EventDialog.js';
import { CalendarManager } from './CalendarManager.js';
import { taskCalendarRange } from './calendar-display.js';
import { TaskDialog } from './TaskDialog.js';

const entrySymbols = {
  event: { symbol: '◆', label: 'Event' },
  note: { symbol: '▤', label: 'Note' },
  todo: { symbol: '☑', label: 'Todo' },
} as const;

export function CalendarEntryContent({
  entry,
  timeText,
}: {
  entry: {
    entryType: 'event' | 'note' | 'todo';
    title: string;
    recurring: boolean;
  };
  timeText: string;
}) {
  const type = entrySymbols[entry.entryType];
  return (
    <span className="calendar-entry-content">
      <span className="calendar-entry-title">{entry.title}</span>
      <span
        className={`calendar-entry-icon calendar-entry-type calendar-entry-${entry.entryType}`}
        aria-label={type.label}
        title={type.label}
      >
        {entry.entryType === 'note' ? type.symbol : null}
      </span>
      {entry.recurring && (
        <span
          className="calendar-entry-icon calendar-entry-repeat"
          aria-label="Recurring series"
          title="Recurring series"
        >
          ↻
        </span>
      )}
      {timeText && <span className="calendar-entry-time">{timeText}</span>}
    </span>
  );
}

const fallbackColors = [
  '#5b8def',
  '#53b175',
  '#df8b45',
  '#a978d1',
  '#dc6472',
  '#35a7a0',
];

const defaultSidebarSettings = {
  enabled: true,
  defaultOpen: true,
  showBrand: true,
  showTasks: true,
  showCalendars: true,
};

function colorFor(calendar: Calendar, index: number): string {
  return (
    calendar.color?.slice(0, 7) ??
    fallbackColors[index % fallbackColors.length] ??
    '#5b8def'
  );
}

function localDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateFromUrl(): string | undefined {
  const value = new URL(window.location.href).searchParams.get('date');
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function updateUrlDate(value: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get('date') === value) return;
  url.searchParams.set('date', value);
  window.history.replaceState(window.history.state, '', url);
}

function previousDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function sortedTasks(tasks: readonly CalendarTask[]): CalendarTask[] {
  return [...tasks].sort((left, right) => {
    const leftPriority = left.priority === 0 ? 10 : left.priority;
    const rightPriority = right.priority === 0 ? 10 : right.priority;
    return (
      leftPriority - rightPriority ||
      (left.due ?? left.start ?? '9999').localeCompare(
        right.due ?? right.start ?? '9999',
      ) ||
      left.title.localeCompare(right.title)
    );
  });
}

function taskHierarchy(tasks: readonly CalendarTask[]) {
  const byUid = new Map(tasks.map((task) => [task.uid, task]));
  const parentByUid = new Map<string, string>();
  tasks.forEach((task) => {
    if (task.parentUid && byUid.has(task.parentUid))
      parentByUid.set(task.uid, task.parentUid);
    task.childUids?.forEach((childUid) => {
      if (byUid.has(childUid) && !parentByUid.has(childUid))
        parentByUid.set(childUid, task.uid);
    });
  });
  const childrenByUid = new Map<string, CalendarTask[]>();
  tasks.forEach((task) => {
    const parentUid = parentByUid.get(task.uid);
    if (!parentUid) return;
    const children = childrenByUid.get(parentUid) ?? [];
    children.push(task);
    childrenByUid.set(parentUid, children);
  });
  childrenByUid.forEach((children, uid) =>
    childrenByUid.set(uid, sortedTasks(children)),
  );
  return {
    roots: tasks.filter((task) => !parentByUid.has(task.uid)),
    childrenByUid,
    childUids: new Set(parentByUid.keys()),
  };
}

function taskStatusInput(
  task: CalendarTask,
  status: 'needs-action' | 'completed',
): TaskMutation {
  return {
    calendarId: task.calendarId,
    title: task.title,
    ...(task.start ? { start: task.start } : {}),
    ...(task.due ? { due: task.due } : {}),
    allDay: task.allDay,
    ...(task.description ? { description: task.description } : {}),
    status,
    priority: task.priority,
    recurrenceRule: task.recurrenceRule ?? null,
    ...(task.parentUid ? { parentUid: task.parentUid } : {}),
  };
}

function TaskTreeItem({
  task,
  childrenByUid,
  onSelect,
  onToggle,
  updatingIds,
  ancestors = new Set<string>(),
}: {
  task: CalendarTask;
  childrenByUid: ReadonlyMap<string, readonly CalendarTask[]>;
  onSelect: (task: CalendarTask) => void;
  onToggle: (task: CalendarTask, completed: boolean) => void;
  updatingIds: ReadonlySet<string>;
  ancestors?: ReadonlySet<string>;
}) {
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const children = ancestors.has(task.uid)
    ? []
    : (childrenByUid.get(task.uid) ?? []);
  const nextAncestors = new Set(ancestors).add(task.uid);
  const subtaskListId = `subtasks-${task.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return (
    <li className={task.completed ? 'is-completed' : ''}>
      <div className="task-list-row">
        {children.length > 0 && (
          <button
            type="button"
            className="subtask-toggle"
            aria-expanded={subtasksOpen}
            aria-controls={subtaskListId}
            aria-label={`${subtasksOpen ? 'Hide' : 'Show'} subtasks for ${task.title}`}
            onClick={() => setSubtasksOpen((open) => !open)}
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
        <span
          className={`task-checkbox-shell${updatingIds.has(task.id) ? ' is-updating' : ''}`}
        >
          <input
            className="task-list-checkbox"
            type="checkbox"
            checked={task.completed}
            disabled={updatingIds.has(task.id)}
            aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`}
            onChange={(event) => onToggle(task, event.target.checked)}
          />
        </span>
        <button
          type="button"
          className="task-title-button"
          onClick={() => onSelect(task)}
        >
          <span className="task-list-title">{task.title}</span>
          {task.priority > 0 && (
            <span className="task-priority" title={`Priority ${task.priority}`}>
              P{task.priority}
            </span>
          )}
        </button>
      </div>
      {children.length > 0 && subtasksOpen && (
        <ul className="subtask-list" id={subtaskListId}>
          {children.map((child) => (
            <TaskTreeItem
              task={child}
              childrenByUid={childrenByUid}
              onSelect={onSelect}
              onToggle={onToggle}
              updatingIds={updatingIds}
              ancestors={nextAncestors}
              key={child.id}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function isOnScrollableSurface(
  target: EventTarget | null,
  boundary: HTMLElement,
): boolean {
  if (!(target instanceof Element)) return false;
  let element: Element | null = target;
  while (element) {
    if (element instanceof HTMLElement) {
      const style = window.getComputedStyle(element);
      const scrollsVertically =
        /(auto|scroll)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight;
      const scrollsHorizontally =
        /(auto|scroll)/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth;
      if (scrollsVertically || scrollsHorizontally) return true;
    }
    if (element === boundary) break;
    element = element.parentElement;
  }
  return false;
}

function TaskGroup({
  title,
  tasks,
  childrenByUid,
  onSelect,
  onToggle,
  updatingIds,
}: {
  title: string;
  tasks: readonly CalendarTask[];
  childrenByUid: ReadonlyMap<string, readonly CalendarTask[]>;
  onSelect: (task: CalendarTask) => void;
  onToggle: (task: CalendarTask, completed: boolean) => void;
  updatingIds: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(title !== 'Completed');
  return (
    <details
      className="task-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span> <span>{tasks.length}</span>
      </summary>
      {tasks.length > 0 && (
        <ul>
          {tasks.map((task) => (
            <TaskTreeItem
              task={task}
              childrenByUid={childrenByUid}
              onSelect={onSelect}
              onToggle={onToggle}
              updatingIds={updatingIds}
              key={task.id}
            />
          ))}
        </ul>
      )}
    </details>
  );
}

function EntryTypeDialog({
  date,
  onCancel,
  onSelect,
}: {
  date: string;
  onCancel: () => void;
  onSelect: (type: 'event' | 'task') => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="entry-type-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-type-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="entry-type-title">Create on {date.slice(0, 10)}</h2>
        <p>What would you like to add?</p>
        <div className="entry-type-actions">
          <button type="button" onClick={() => onSelect('event')} autoFocus>
            <span aria-hidden="true">◆</span> New event
          </button>
          <button type="button" onClick={() => onSelect('task')}>
            <span aria-hidden="true">☑</span> New task
          </button>
        </div>
        <button type="button" className="entry-type-cancel" onClick={onCancel}>
          Cancel
        </button>
      </section>
    </div>
  );
}

export function App() {
  const calendarRef = useRef<FullCalendar>(null);
  const wheelDistance = useRef(0);
  const wheelReset = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [loadingCalendars, setLoadingCalendars] = useState(true);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [editor, setEditor] = useState<{
    event?: CalendarEvent;
    initialDate?: string;
  }>();
  const [taskEditor, setTaskEditor] = useState<CalendarTask | null>();
  const [taskEditorReturn, setTaskEditorReturn] = useState<CalendarTask>();
  const [taskInitialDate, setTaskInitialDate] = useState<string>();
  const [creationDate, setCreationDate] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSettings, setSidebarSettings] = useState(
    defaultSidebarSettings,
  );
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [taskPickerOpen, setTaskPickerOpen] = useState(true);
  const [calendarManagerOpen, setCalendarManagerOpen] = useState(false);
  const [deletingCompleted, setDeletingCompleted] = useState(false);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [initialCalendarDate] = useState(() => dateFromUrl());

  useEffect(() => {
    const navigateFromHistory = () => {
      const date = dateFromUrl();
      if (date) calendarRef.current?.getApi().gotoDate(date);
    };
    window.addEventListener('popstate', navigateFromHistory);
    return () => window.removeEventListener('popstate', navigateFromHistory);
  }, []);

  useEffect(() => {
    void getPublicConfig()
      .then((config) => {
        document.documentElement.dataset.theme = config.ui.darkMode;
        setSidebarSettings(config.ui.sidebar);
        setSidebarOpen(
          config.ui.sidebar.enabled && config.ui.sidebar.defaultOpen,
        );
        const views = {
          month: 'dayGridMonth',
          week: 'timeGridWeek',
          day: 'timeGridDay',
          agenda: 'listMonth',
        };
        calendarRef.current?.getApi().changeView(views[config.ui.defaultView]);
      })
      .catch(() => {
        document.documentElement.dataset.theme = 'auto';
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getCalendars(controller.signal)
      .then((items) => {
        setCalendars(items);
        setSelected(new Set(items.map((calendar) => calendar.id)));
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError')
          return;
        setError('DayFront could not load calendars from the CalDAV server.');
      })
      .finally(() => setLoadingCalendars(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    calendarRef.current?.getApi().refetchEvents();
  }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingTasks(true);
    void getTaskList([...selected], controller.signal)
      .then(setTasks)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError'))
          setError(
            'DayFront could not load the task list from the CalDAV server.',
          );
      })
      .finally(() => setLoadingTasks(false));
    return () => controller.abort();
  }, [selected]);

  const today = localDateKey(new Date().toISOString());
  const hierarchy = taskHierarchy(tasks);
  const activeTasks = sortedTasks(
    hierarchy.roots.filter(
      (task) => !task.completed && task.status !== 'cancelled',
    ),
  );
  const completedTasks = sortedTasks(
    hierarchy.roots.filter(
      (task) => task.completed || task.status === 'cancelled',
    ),
  );
  const taskGroups = {
    Overdue: activeTasks.filter((task) => {
      const date = task.due ?? task.start;
      return date ? localDateKey(date) < today : false;
    }),
    Today: activeTasks.filter((task) => {
      const date = task.due ?? task.start;
      return date ? localDateKey(date) === today : false;
    }),
    Upcoming: activeTasks.filter((task) => {
      const date = task.due ?? task.start;
      return date ? localDateKey(date) > today : false;
    }),
    Completed: sortedTasks(
      hierarchy.roots.filter(
        (task) => task.completed || task.status === 'cancelled',
      ),
    ),
    Undated: activeTasks.filter((task) => !task.due && !task.start),
  };

  const loadEvents = useCallback(
    async (
      info: { start: Date; end: Date },
      success: (events: object[]) => void,
      failure: (error: Error) => void,
    ) => {
      try {
        const range = {
          start: info.start,
          end: info.end,
          calendarIds: [...selected],
        };
        const [events, tasks] = await Promise.all([
          getEvents(range),
          getTasks(range),
        ]);
        const colors = new Map(
          calendars.map((calendar, index) => [
            calendar.id,
            colorFor(calendar, index),
          ]),
        );
        const calendarEntries: object[] = events.map(
          (event: CalendarEvent) => ({
            id: event.id,
            title: event.title,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            backgroundColor: colors.get(event.calendarId),
            borderColor: colors.get(event.calendarId),
            editable: !event.readOnly,
            startEditable: !event.readOnly,
            durationEditable: false,
            extendedProps: event,
          }),
        );
        const linkedChildren = new Set(
          tasks.flatMap((task) => task.childUids ?? []),
        );
        calendarEntries.push(
          ...tasks.flatMap((task) => {
            if (task.parentUid || linkedChildren.has(task.uid)) return [];
            const range = taskCalendarRange(task);
            if (!range) return [];
            return [
              {
                id: `task-${task.id}`,
                title: task.title,
                ...range,
                allDay: task.allDay,
                backgroundColor: colors.get(task.calendarId),
                borderColor: colors.get(task.calendarId),
                editable: true,
                startEditable: true,
                durationEditable: false,
                classNames: task.completed
                  ? ['task-completed']
                  : ['task-entry'],
                extendedProps: { ...task, entryType: 'todo' as const },
              },
            ];
          }),
        );
        success(calendarEntries);
        setError(undefined);
      } catch (reason: unknown) {
        const eventError =
          reason instanceof Error ? reason : new Error('Event loading failed.');
        setError('DayFront could not load events for this date range.');
        failure(eventError);
      }
    },
    [calendars, selected],
  );

  function toggleCalendar(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function moveCalendarEntry(info: EventDropArg) {
    const taskResult = calendarTaskSchema.safeParse(info.event.extendedProps);
    const eventResult = calendarEventSchema.safeParse(info.event.extendedProps);
    try {
      if (taskResult.success) {
        const task = taskResult.data;
        const movedStart = task.allDay
          ? info.event.startStr.slice(0, 10)
          : info.event.start?.toISOString();
        if (!movedStart) throw new Error('Dropped task has no start.');
        const movedEnd = task.allDay
          ? info.event.endStr
            ? previousDate(info.event.endStr)
            : undefined
          : info.event.end?.toISOString();
        await updateTask(task.resourceId, task.version, {
          calendarId: task.calendarId,
          title: task.title,
          ...(task.start ? { start: movedStart } : {}),
          ...(task.due
            ? { due: task.start && movedEnd ? movedEnd : movedStart }
            : {}),
          allDay: task.allDay,
          ...(task.description ? { description: task.description } : {}),
          status: task.status,
          priority: task.priority,
          recurrenceRule: task.recurrenceRule ?? null,
          ...(task.recurrenceId
            ? {
                recurrenceId: task.recurrenceId,
                occurrenceStart: task.start ?? task.due,
                recurrenceScope: 'occurrence' as const,
              }
            : {}),
          ...(task.parentUid ? { parentUid: task.parentUid } : {}),
        });
        await refreshTasks();
      } else if (eventResult.success && !eventResult.data.readOnly) {
        const event = eventResult.data;
        const movedStart = event.allDay
          ? info.event.startStr.slice(0, 10)
          : info.event.start?.toISOString();
        if (!movedStart) throw new Error('Dropped event has no start.');
        const movedEnd = event.allDay
          ? info.event.endStr
            ? info.event.endStr.slice(0, 10)
            : undefined
          : info.event.end?.toISOString();
        await updateEvent(event.resourceId, event.version, {
          calendarId: event.calendarId,
          title: event.title,
          start: movedStart,
          ...(movedEnd ? { end: movedEnd } : {}),
          allDay: event.allDay,
          ...(event.description ? { description: event.description } : {}),
          ...(event.location ? { location: event.location } : {}),
          recurrenceRule: event.recurrenceRule ?? null,
          ...(event.recurrenceId
            ? {
                recurrenceId: event.recurrenceId,
                occurrenceStart: event.start,
                recurrenceScope: 'occurrence' as const,
              }
            : {}),
        });
        calendarRef.current?.getApi().refetchEvents();
      } else {
        info.revert();
      }
      setError(undefined);
    } catch {
      info.revert();
      setError(
        'The entry could not be moved. It may have changed on the CalDAV server; the calendar has been refreshed.',
      );
      await refreshTasks().catch(() => undefined);
      calendarRef.current?.getApi().refetchEvents();
    }
  }

  async function saveEvent(input: EventMutation) {
    if (editor?.event) {
      await updateEvent(editor.event.resourceId, editor.event.version, input);
    } else {
      await createEvent(input);
    }
    setEditor(undefined);
    calendarRef.current?.getApi().refetchEvents();
  }

  async function removeEvent(scope: 'series' | 'occurrence') {
    if (!editor?.event) return;
    await deleteEvent(
      editor.event.resourceId,
      editor.event.version,
      scope === 'occurrence' && editor.event.recurrenceId
        ? { recurrenceId: editor.event.recurrenceId }
        : undefined,
    );
    setEditor(undefined);
    calendarRef.current?.getApi().refetchEvents();
  }

  async function refreshTasks() {
    setTasks(await getTaskList([...selected]));
    calendarRef.current?.getApi().refetchEvents();
  }

  async function refreshCalendars(preferredId?: string) {
    const items = await getCalendars();
    const validIds = new Set(items.map((calendar) => calendar.id));
    const nextSelected = new Set(
      [...selected].filter((id) => validIds.has(id)),
    );
    if (preferredId && validIds.has(preferredId)) nextSelected.add(preferredId);
    setCalendars(items);
    setSelected(nextSelected);
    setTasks(nextSelected.size > 0 ? await getTaskList([...nextSelected]) : []);
    calendarRef.current?.getApi().refetchEvents();
  }

  async function saveCalendar(
    calendar: Calendar | undefined,
    input: CalendarMutation,
  ) {
    const saved = calendar
      ? await updateCalendar(calendar.id, input)
      : await createCalendar(input);
    await refreshCalendars(saved.id);
  }

  async function removeCalendar(calendar: Calendar) {
    await deleteCalendar(calendar.id);
    await refreshCalendars();
  }

  function descendantsOf(task: CalendarTask): CalendarTask[] {
    const descendants: CalendarTask[] = [];
    const seen = new Set([task.uid]);
    const pending = [...(hierarchy.childrenByUid.get(task.uid) ?? [])];
    while (pending.length > 0) {
      const child = pending.shift();
      if (!child || seen.has(child.uid)) continue;
      seen.add(child.uid);
      descendants.push(child);
      pending.push(...(hierarchy.childrenByUid.get(child.uid) ?? []));
    }
    return descendants;
  }

  async function completeDescendants(task: CalendarTask): Promise<number> {
    const incomplete = descendantsOf(task).filter((child) => !child.completed);
    const results = await Promise.allSettled(
      incomplete.map((child) =>
        updateTask(
          child.resourceId,
          child.version,
          taskStatusInput(child, 'completed'),
        ),
      ),
    );
    return results.filter((result) => result.status === 'rejected').length;
  }

  async function saveTask(input: TaskMutation, subtasks: readonly string[]) {
    const returnEditor = taskEditorReturn;
    let failedCompletions = 0;
    let failedMoves = 0;
    if (taskEditor) {
      await updateTask(taskEditor.resourceId, taskEditor.version, input);
      if (input.calendarId !== taskEditor.calendarId) {
        const results = await Promise.allSettled(
          descendantsOf(taskEditor).map((child) =>
            updateTask(child.resourceId, child.version, {
              calendarId: input.calendarId,
              title: child.title,
              ...(child.start ? { start: child.start } : {}),
              ...(child.due ? { due: child.due } : {}),
              allDay: child.allDay,
              ...(child.description ? { description: child.description } : {}),
              status: input.status === 'completed' ? 'completed' : child.status,
              priority: child.priority,
              recurrenceRule: child.recurrenceRule ?? null,
              ...(child.parentUid ? { parentUid: child.parentUid } : {}),
            }),
          ),
        );
        failedMoves = results.filter(
          (result) => result.status === 'rejected',
        ).length;
      }
      if (
        input.calendarId === taskEditor.calendarId &&
        input.status === 'completed' &&
        !taskEditor.completed
      )
        failedCompletions = await completeDescendants(taskEditor);
    } else {
      const parent = await createTask(input);
      const results = await Promise.allSettled(
        subtasks.map((title) =>
          createTask({
            calendarId: parent.calendarId,
            title,
            allDay: true,
            status: 'needs-action',
            priority: 0,
            recurrenceRule: null,
            parentUid: parent.uid,
          }),
        ),
      );
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length > 0)
        setError(
          `The task was created, but ${failed.length} subtask${failed.length === 1 ? '' : 's'} could not be saved.`,
        );
    }
    if (failedCompletions > 0)
      setError(
        `The task was completed, but ${failedCompletions} subtask${failedCompletions === 1 ? '' : 's'} could not be completed.`,
      );
    if (failedMoves > 0)
      setError(
        `The task was moved, but ${failedMoves} subtask${failedMoves === 1 ? '' : 's'} could not be moved.`,
      );
    await refreshTasks();
    setTaskEditor(returnEditor);
    setTaskEditorReturn(undefined);
  }

  async function addSubtask(title: string) {
    if (!taskEditor) return;
    await createTask({
      calendarId: taskEditor.calendarId,
      title,
      allDay: true,
      status: 'needs-action',
      priority: 0,
      recurrenceRule: null,
      parentUid: taskEditor.uid,
    });
    await refreshTasks();
  }

  async function removeSubtask(task: CalendarTask) {
    await deleteTaskTree(task);
    await refreshTasks();
  }

  async function deleteTaskTree(
    task: CalendarTask,
    occurrence?: { recurrenceId: string },
  ) {
    if (!occurrence) {
      // CalDAV stores every subtask as its own resource. Delete descendants
      // from the leaves upward so no orphaned children remain.
      for (const descendant of descendantsOf(task).reverse())
        await deleteTask(descendant.resourceId, descendant.version);
    }
    await deleteTask(task.resourceId, task.version, occurrence);
  }

  async function removeTask(scope: 'series' | 'occurrence') {
    if (!taskEditor) return;
    const returnEditor = taskEditorReturn;
    await deleteTaskTree(
      taskEditor,
      scope === 'occurrence' && taskEditor.recurrenceId
        ? { recurrenceId: taskEditor.recurrenceId }
        : undefined,
    );
    await refreshTasks();
    setTaskEditor(returnEditor);
    setTaskEditorReturn(undefined);
  }

  async function toggleSubtask(task: CalendarTask, completed: boolean) {
    if (updatingTaskIds.has(task.id)) return;
    setUpdatingTaskIds((current) => new Set(current).add(task.id));
    try {
      await updateTask(
        task.resourceId,
        task.version,
        taskStatusInput(task, completed ? 'completed' : 'needs-action'),
      );
      if (completed) {
        const failed = await completeDescendants(task);
        if (failed > 0)
          setError(
            `The task was completed, but ${failed} subtask${failed === 1 ? '' : 's'} could not be completed.`,
          );
      }
      await refreshTasks();
    } catch {
      setError(
        `The subtask “${task.title}” could not be updated. The task list has been refreshed.`,
      );
      await refreshTasks();
    } finally {
      setUpdatingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  async function removeCompletedTasks() {
    const completed = completedTasks;
    if (completed.length === 0 || deletingCompleted) return;
    if (
      !window.confirm(
        `Permanently delete ${completed.length} completed ${completed.length === 1 ? 'task' : 'tasks'} and all of their subtasks? This cannot be undone.`,
      )
    )
      return;

    setDeletingCompleted(true);
    setError(undefined);
    const unique = new Map<string, CalendarTask>();
    completed.forEach((task) => {
      [...descendantsOf(task)].reverse().forEach((descendant) => {
        unique.set(
          `${descendant.resourceId}:${descendant.recurrenceId ?? 'series'}`,
          descendant,
        );
      });
      unique.set(`${task.resourceId}:${task.recurrenceId ?? 'series'}`, task);
    });
    try {
      for (const task of unique.values()) {
        await deleteTask(
          task.resourceId,
          task.version,
          task.recurrenceId ? { recurrenceId: task.recurrenceId } : undefined,
        );
      }
    } catch {
      setError(
        'Some completed tasks could not be deleted. The task list has been refreshed.',
      );
    } finally {
      setDeletingCompleted(false);
      await refreshTasks();
    }
  }

  function navigateWithWheel(event: WheelEvent<HTMLElement>) {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isOnScrollableSurface(event.target, event.currentTarget) ||
      (event.target instanceof Element &&
        event.target.closest(
          'button, input, select, textarea, a, [role="dialog"]',
        ))
    )
      return;

    const movement =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    if (movement === 0) return;
    event.preventDefault();
    wheelDistance.current += movement;
    clearTimeout(wheelReset.current);
    wheelReset.current = setTimeout(() => {
      wheelDistance.current = 0;
    }, 180);
    if (Math.abs(wheelDistance.current) < 40) return;
    const calendar = calendarRef.current?.getApi();
    if (wheelDistance.current > 0) calendar?.next();
    else calendar?.prev();
    wheelDistance.current = 0;
  }

  const sidebarVisible = sidebarSettings.enabled && sidebarOpen;

  return (
    <div className={`app-shell${sidebarVisible ? '' : ' sidebar-collapsed'}`}>
      {sidebarSettings.enabled && (
        <aside className="sidebar" id="sidebar" hidden={!sidebarOpen}>
          {sidebarSettings.showBrand && (
            <header className="brand">
              <span className="mark" aria-hidden="true">
                D
              </span>
              <div>
                <p className="eyebrow">Own your day. Own your data.</p>
                <h1>DayFront</h1>
              </div>
            </header>
          )}

          {sidebarSettings.showCalendars && (
            <details
              className="calendar-picker"
              open={calendarPickerOpen}
              onToggle={(event) =>
                setCalendarPickerOpen(event.currentTarget.open)
              }
            >
              <summary className="picker-summary">
                <h2 id="calendar-heading">Calendars</h2>
                {!loadingCalendars && (
                  <span>
                    {selected.size}/{calendars.length}
                  </span>
                )}
              </summary>
              {loadingCalendars && (
                <p className="muted">Discovering calendars…</p>
              )}
              {!loadingCalendars && calendars.length === 0 && (
                <p className="muted">No event calendars were found.</p>
              )}
              <div className="calendar-list">
                {calendars.map((calendar, index) => (
                  <label className="calendar-option" key={calendar.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(calendar.id)}
                      onChange={() => toggleCalendar(calendar.id)}
                    />
                    <span
                      className="calendar-color"
                      style={{ backgroundColor: colorFor(calendar, index) }}
                      aria-hidden="true"
                    />
                    <span>{calendar.displayName}</span>
                    {calendar.readOnly && (
                      <span
                        className="calendar-readonly"
                        aria-label="Read-only calendar"
                        title="Read-only calendar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                          <circle cx="12" cy="12" r="2.75" />
                        </svg>
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="manage-calendars-button"
                onClick={() => setCalendarManagerOpen(true)}
              >
                Manage calendars
              </button>
            </details>
          )}
          {sidebarSettings.showTasks && (
            <details
              className="task-list"
              open={taskPickerOpen}
              onToggle={(event) => setTaskPickerOpen(event.currentTarget.open)}
            >
              <summary className="picker-summary">
                <h2 id="task-list-heading">Tasks</h2>
              </summary>
              <div className="task-actions">
                <button
                  type="button"
                  className="task-action primary-task-action"
                  onClick={() => {
                    setTaskInitialDate(undefined);
                    setTaskEditorReturn(undefined);
                    setTaskEditor(null);
                  }}
                >
                  <span aria-hidden="true">＋</span>
                  New task
                </button>
                {completedTasks.length > 0 && (
                  <button
                    type="button"
                    className="task-action clear-task-action"
                    disabled={deletingCompleted}
                    onClick={() => void removeCompletedTasks()}
                  >
                    <span aria-hidden="true">×</span>
                    {deletingCompleted ? 'Deleting…' : 'Clear completed'}
                  </button>
                )}
              </div>
              {loadingTasks ? (
                <p className="muted">Loading tasks…</p>
              ) : (
                Object.entries(taskGroups).map(([title, items]) => (
                  <TaskGroup
                    title={title}
                    tasks={items}
                    childrenByUid={hierarchy.childrenByUid}
                    updatingIds={updatingTaskIds}
                    onToggle={(task, completed) =>
                      void toggleSubtask(task, completed)
                    }
                    onSelect={(task) => {
                      setTaskInitialDate(undefined);
                      setTaskEditorReturn(undefined);
                      setTaskEditor(task);
                    }}
                    key={title}
                  />
                ))
              )}
            </details>
          )}
        </aside>
      )}

      <main className="calendar-main" onWheel={navigateWithWheel}>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              type="button"
              onClick={() => calendarRef.current?.getApi().refetchEvents()}
            >
              Retry
            </button>
          </div>
        )}
        <FullCalendar
          ref={calendarRef}
          {...(initialCalendarDate ? { initialDate: initialCalendarDate } : {})}
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
          ]}
          initialView="dayGridMonth"
          customButtons={{
            sidebarToggle: {
              text: sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
              hint: sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar',
              click: () => setSidebarOpen((open) => !open),
            },
          }}
          headerToolbar={{
            left: sidebarSettings.enabled
              ? 'sidebarToggle prev,next today'
              : 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth',
          }}
          buttonText={{
            month: 'Month',
            week: 'Week',
            day: 'Day',
            list: 'Agenda',
          }}
          events={loadEvents}
          datesSet={(info) =>
            updateUrlDate(
              localDateKey(info.view.calendar.getDate().toISOString()),
            )
          }
          eventContent={(info) => {
            const entry = calendarEventSchema
              .or(calendarTaskSchema)
              .safeParse(info.event.extendedProps);
            return entry.success ? (
              <CalendarEntryContent
                entry={entry.data}
                timeText={info.timeText}
              />
            ) : (
              info.event.title
            );
          }}
          eventDrop={(info) => void moveCalendarEntry(info)}
          height="100%"
          nowIndicator
          dayMaxEvents
          eventDisplay="block"
          selectable
          dateClick={(info) => setCreationDate(info.dateStr)}
          eventClick={(info) => {
            const task = calendarTaskSchema.safeParse(info.event.extendedProps);
            if (task.success) {
              setTaskInitialDate(undefined);
              setTaskEditorReturn(undefined);
              setTaskEditor(task.data);
              return;
            }
            const result = calendarEventSchema.safeParse(
              info.event.extendedProps,
            );
            if (result.success && !result.data.readOnly)
              setEditor({ event: result.data });
          }}
        />
      </main>
      {editor && (
        <EventDialog
          calendars={calendars.filter(
            (calendar) =>
              !calendar.readOnly && calendar.components.includes('VEVENT'),
          )}
          {...(editor.event ? { event: editor.event } : {})}
          {...(editor.initialDate ? { initialDate: editor.initialDate } : {})}
          onCancel={() => setEditor(undefined)}
          onSave={saveEvent}
          {...(editor.event ? { onDelete: removeEvent } : {})}
        />
      )}
      {taskEditor !== undefined && (
        <TaskDialog
          key={taskEditor?.id ?? 'new-task'}
          calendars={calendars.filter(
            (calendar) =>
              !calendar.readOnly && calendar.components.includes('VTODO'),
          )}
          {...(taskEditor ? { task: taskEditor } : {})}
          simple={Boolean(
            taskEditor && hierarchy.childUids.has(taskEditor.uid),
          )}
          subtasks={
            taskEditor
              ? (hierarchy.childrenByUid.get(taskEditor.uid) ?? [])
              : []
          }
          {...(taskInitialDate ? { initialDate: taskInitialDate } : {})}
          onCancel={() => {
            setTaskEditor(taskEditorReturn);
            setTaskEditorReturn(undefined);
          }}
          onSave={saveTask}
          {...(taskEditor && !hierarchy.childUids.has(taskEditor.uid)
            ? {
                onAddSubtask: addSubtask,
                onRemoveSubtask: removeSubtask,
                onToggleSubtask: toggleSubtask,
                onEditSubtask: (task: CalendarTask) => {
                  setTaskEditorReturn(taskEditor);
                  setTaskEditor(task);
                },
              }
            : {})}
          {...(taskEditor ? { onDelete: removeTask } : {})}
        />
      )}
      {creationDate && (
        <EntryTypeDialog
          date={creationDate}
          onCancel={() => setCreationDate(undefined)}
          onSelect={(type) => {
            const date = creationDate;
            setCreationDate(undefined);
            if (type === 'event') setEditor({ initialDate: date });
            else {
              setTaskInitialDate(date);
              setTaskEditorReturn(undefined);
              setTaskEditor(null);
            }
          }}
        />
      )}
      {calendarManagerOpen && (
        <CalendarManager
          calendars={calendars.filter((calendar) => !calendar.readOnly)}
          onClose={() => setCalendarManagerOpen(false)}
          onSave={saveCalendar}
          onDelete={removeCalendar}
        />
      )}
    </div>
  );
}
