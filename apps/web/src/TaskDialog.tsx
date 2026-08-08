import type { Calendar, CalendarTask, TaskMutation } from '@dayfront/shared';
import { useRef, useState, type FormEvent } from 'react';

import { ClockInput, type TimeFormat } from './ClockInput.js';

interface Props {
  calendars: readonly Calendar[];
  timeFormat?: TimeFormat;
  task?: CalendarTask;
  initialDate?: string;
  initialEnd?: string;
  simple?: boolean;
  subtasks?: readonly CalendarTask[];
  onCancel: () => void;
  onDelete?: (scope: 'series' | 'occurrence') => Promise<void>;
  onAddSubtask?: (title: string) => Promise<void>;
  onRemoveSubtask?: (task: CalendarTask) => Promise<void>;
  onToggleSubtask?: (task: CalendarTask, completed: boolean) => Promise<void>;
  onEditSubtask?: (task: CalendarTask) => void;
  onSave: (input: TaskMutation, subtasks: readonly string[]) => Promise<void>;
}

const rules = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
} as const;

function localValue(value: string, allDay: boolean): string {
  if (allDay) return value.slice(0, 10);
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function timedValue(value: string, fallbackTime = '09:00'): string {
  return value.includes('T') ? value.slice(0, 16) : `${value}T${fallbackTime}`;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function timePart(value: string): string {
  return value.includes('T') ? value.slice(11, 16) : '';
}

function withDate(value: string, date: string): string {
  return date ? `${date}T${timePart(value) || '09:00'}` : '';
}

function withTime(value: string, time: string): string {
  const date = datePart(value);
  return date && time ? `${date}T${time}` : value;
}

function shiftTime(value: string, hours: number): string {
  const date = new Date(value.slice(0, 16));
  date.setHours(date.getHours() + hours);
  return localValue(date.toISOString(), false);
}

function ruleChoice(rule?: string) {
  if (!rule) return 'none';
  return (
    Object.entries(rules).find(([, value]) => value === rule)?.[0] ?? 'custom'
  );
}

export function TaskDialog({
  calendars,
  timeFormat = '12h',
  task,
  initialDate,
  initialEnd,
  simple = false,
  subtasks = [],
  onCancel,
  onDelete,
  onAddSubtask,
  onRemoveSubtask,
  onToggleSubtask,
  onEditSubtask,
  onSave,
}: Props) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [calendarId, setCalendarId] = useState(
    task?.calendarId ?? calendars[0]?.id ?? '',
  );
  const initialAllDay = task?.allDay ?? !initialDate?.includes('T');
  const [allDay, setAllDay] = useState(initialAllDay);
  const [start, setStart] = useState(
    task?.start
      ? localValue(task.start, task.allDay)
      : (initialDate?.slice(0, initialAllDay ? 10 : 16) ?? ''),
  );
  const [due, setDue] = useState(
    task?.due
      ? localValue(task.due, task.allDay)
      : (initialEnd?.slice(0, initialAllDay ? 10 : 16) ??
          initialDate?.slice(0, initialAllDay ? 10 : 16) ??
          ''),
  );
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskMutation['status']>(
    task?.status ?? 'needs-action',
  );
  const [priority, setPriority] = useState(task?.priority ?? 0);
  const [recurrenceScope, setRecurrenceScope] = useState<
    'series' | 'occurrence'
  >(task?.recurring && task.recurrenceId ? 'occurrence' : 'series');
  const initialRuleChoice = ruleChoice(task?.recurrenceRule);
  const [recurrence, setRecurrence] = useState(initialRuleChoice);
  const [customRule, setCustomRule] = useState(
    initialRuleChoice === 'custom' ? (task?.recurrenceRule ?? '') : '',
  );
  const [busy, setBusy] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [draftSubtasks, setDraftSubtasks] = useState<string[]>([]);
  const [subtaskBusy, setSubtaskBusy] = useState(false);
  const [updatingSubtaskIds, setUpdatingSubtaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [error, setError] = useState<string>();
  const operation = useRef(false);
  const movingRecurringSeries = Boolean(
    task?.recurring && task.recurrenceId && calendarId !== task.calendarId,
  );

  const date = (value: string) =>
    allDay || !value ? value : new Date(value).toISOString();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onSave(
        simple
          ? {
              calendarId,
              title,
              allDay: true,
              status,
              priority: 0,
              recurrenceRule: null,
            }
          : {
              calendarId,
              title,
              ...(start ? { start: date(start) } : {}),
              ...(due ? { due: date(due) } : {}),
              allDay,
              ...(description ? { description } : {}),
              status,
              priority,
              recurrenceRule:
                recurrence === 'none'
                  ? null
                  : recurrence === 'custom'
                    ? customRule
                    : rules[recurrence as keyof typeof rules],
              ...(task?.recurrenceId
                ? {
                    recurrenceId: task.recurrenceId,
                    occurrenceStart: task.start ?? task.due,
                    recurrenceScope: movingRecurringSeries
                      ? 'series'
                      : recurrenceScope,
                  }
                : {}),
            },
        draftSubtasks,
      );
    } catch {
      operation.current = false;
      setBusy(false);
      setError('The task could not be saved. Reload and try again.');
    }
  }

  async function remove() {
    if (
      operation.current ||
      !onDelete ||
      !window.confirm(
        subtasks.length > 0
          ? 'Delete this task and all of its subtasks?'
          : 'Delete this task?',
      )
    )
      return;
    operation.current = true;
    setBusy(true);
    try {
      await onDelete(recurrenceScope);
    } catch {
      operation.current = false;
      setBusy(false);
      setError('The task could not be deleted. Reload and try again.');
    }
  }

  async function addSubtask() {
    const value = subtaskTitle.trim();
    if (!value || subtaskBusy) return;
    if (!task) {
      setDraftSubtasks((current) => [...current, value]);
      setSubtaskTitle('');
      return;
    }
    if (!onAddSubtask) return;
    setSubtaskBusy(true);
    setError(undefined);
    try {
      await onAddSubtask(value);
      setSubtaskTitle('');
    } catch {
      setError('The subtask could not be added. Reload and try again.');
    } finally {
      setSubtaskBusy(false);
    }
  }

  async function removeSubtask(child: CalendarTask) {
    if (
      !onRemoveSubtask ||
      subtaskBusy ||
      !window.confirm(`Permanently delete the subtask “${child.title}”?`)
    )
      return;
    setSubtaskBusy(true);
    setError(undefined);
    try {
      await onRemoveSubtask(child);
    } catch {
      setError('The subtask could not be removed. Reload and try again.');
    } finally {
      setSubtaskBusy(false);
    }
  }

  async function toggleSubtask(child: CalendarTask, completed: boolean) {
    if (!onToggleSubtask || updatingSubtaskIds.has(child.id)) return;
    setUpdatingSubtaskIds((current) => new Set(current).add(child.id));
    try {
      await onToggleSubtask(child, completed);
    } finally {
      setUpdatingSubtaskIds((current) => {
        const next = new Set(current);
        next.delete(child.id);
        return next;
      });
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="event-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="task-dialog-title">
            {task ? (simple ? 'Edit subtask' : 'Edit task') : 'New task'}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              autoFocus
            />
          </label>
          {!simple && (
            <label>
              Calendar
              <select
                aria-label="Calendar"
                value={calendarId}
                onChange={(event) => {
                  setCalendarId(event.target.value);
                  if (
                    task?.recurring &&
                    task.recurrenceId &&
                    event.target.value !== task.calendarId
                  )
                    setRecurrenceScope('series');
                }}
              >
                {calendars.map((calendar) => (
                  <option value={calendar.id} key={calendar.id}>
                    {calendar.displayName}
                  </option>
                ))}
              </select>
              {task?.recurring && task.recurrenceId && (
                <span className="field-hint">
                  Changing calendars moves the entire recurring series.
                </span>
              )}
            </label>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={status === 'completed'}
              onChange={(event) =>
                setStatus(event.target.checked ? 'completed' : 'needs-action')
              }
            />
            Completed
          </label>
          {!simple && (!task || onAddSubtask) && (
            <section
              className="subtask-editor"
              aria-labelledby="subtask-heading"
            >
              <div className="subtask-editor-heading">
                <h3 id="subtask-heading">Subtasks</h3>
                <span>{subtasks.length + draftSubtasks.length}</span>
              </div>
              {subtasks.length > 0 && (
                <ul>
                  {subtasks.map((child) => (
                    <li className="saved-subtask-row" key={child.id}>
                      <span
                        className={`task-checkbox-shell dialog-task-checkbox-shell${updatingSubtaskIds.has(child.id) ? ' is-updating' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={child.completed}
                          disabled={
                            subtaskBusy || updatingSubtaskIds.has(child.id)
                          }
                          aria-label={`${child.completed ? 'Reopen' : 'Complete'} ${child.title}`}
                          onChange={(event) =>
                            void toggleSubtask(child, event.target.checked)
                          }
                        />
                      </span>
                      <button
                        type="button"
                        className={`subtask-edit-button${child.completed ? ' is-completed' : ''}`}
                        onClick={() => onEditSubtask?.(child)}
                      >
                        {child.title}
                      </button>
                      {onRemoveSubtask && (
                        <button
                          type="button"
                          className="subtask-remove-button"
                          disabled={subtaskBusy}
                          aria-label={`Remove ${child.title}`}
                          onClick={() => void removeSubtask(child)}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {draftSubtasks.length > 0 && (
                <ul>
                  {draftSubtasks.map((draft, index) => (
                    <li key={`${draft}-${index}`}>
                      <span>☐ {draft}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${draft}`}
                        onClick={() =>
                          setDraftSubtasks((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="subtask-add-row">
                <input
                  aria-label="New subtask title"
                  value={subtaskTitle}
                  placeholder="Add a subtask"
                  disabled={subtaskBusy}
                  onChange={(event) => setSubtaskTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addSubtask();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!subtaskTitle.trim() || subtaskBusy}
                  onClick={() => void addSubtask()}
                >
                  Add
                </button>
              </div>
            </section>
          )}
          {!simple && (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setAllDay(checked);
                    if (checked) {
                      setStart((value) => value.slice(0, 10));
                      setDue((value) => value.slice(0, 10));
                    } else {
                      setStart((value) => (value ? timedValue(value) : value));
                      setDue((value) => (value ? timedValue(value) : value));
                    }
                  }}
                />
                All day
              </label>
              {task?.recurring && task.recurrenceId && (
                <label>
                  Apply changes to
                  <select
                    value={movingRecurringSeries ? 'series' : recurrenceScope}
                    onChange={(event) =>
                      setRecurrenceScope(
                        event.target.value as 'series' | 'occurrence',
                      )
                    }
                  >
                    <option value="occurrence" disabled={movingRecurringSeries}>
                      This occurrence
                    </option>
                    <option value="series">Entire series</option>
                  </select>
                </label>
              )}
              <div className="date-fields">
                <div className="date-time-field">
                  <span>Starts</span>
                  <div className="date-time-inputs">
                    <input
                      aria-label="Start date"
                      type="date"
                      value={datePart(start)}
                      onChange={(event) => {
                        const value = allDay
                          ? event.target.value
                          : withDate(start, event.target.value);
                        setStart(value);
                        if (value) {
                          if (!due) setDue(value);
                          else if (datePart(value) > datePart(due))
                            setDue(
                              allDay
                                ? datePart(value)
                                : withDate(due, datePart(value)),
                            );
                        }
                      }}
                    />
                    {!allDay && (
                      <ClockInput
                        label="Start time"
                        value={timePart(start)}
                        timeFormat={timeFormat}
                        onChange={(time) => {
                          const value = withTime(start, time);
                          setStart(value);
                          if (value && due && value >= due)
                            setDue(shiftTime(value, 1));
                        }}
                      />
                    )}
                  </div>
                </div>
                <div className="date-time-field">
                  <span>Due</span>
                  <div className="date-time-inputs">
                    <input
                      aria-label="Due date"
                      type="date"
                      value={datePart(due)}
                      onChange={(event) => {
                        const value = allDay
                          ? event.target.value
                          : withDate(due, event.target.value);
                        setDue(value);
                        if (value) {
                          if (!start) setStart(value);
                          else if (datePart(value) < datePart(start))
                            setStart(
                              allDay
                                ? datePart(value)
                                : withDate(start, datePart(value)),
                            );
                        }
                      }}
                    />
                    {!allDay && (
                      <ClockInput
                        label="Due time"
                        value={timePart(due)}
                        timeFormat={timeFormat}
                        onChange={(time) => {
                          const value = withTime(due, time);
                          setDue(value);
                          if (value && start && value <= start)
                            setStart(shiftTime(value, -1));
                          else if (recurrence !== 'none' && !start)
                            setStart(value);
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
              <label>
                Priority
                <select
                  value={priority}
                  onChange={(event) => setPriority(Number(event.target.value))}
                >
                  <option value={0}>Unspecified</option>
                  {Array.from({ length: 9 }, (_, index) => (
                    <option value={index + 1} key={index + 1}>
                      {index + 1}
                      {index === 0
                        ? ' — highest'
                        : index === 8
                          ? ' — lowest'
                          : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Repeats
                <select
                  value={recurrence}
                  onChange={(event) => {
                    const value = event.target.value;
                    setRecurrence(value);
                    if (value !== 'none' && !start && due) setStart(due);
                  }}
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom RRULE</option>
                </select>
              </label>
              {recurrence === 'custom' && (
                <label>
                  Recurrence rule
                  <input
                    value={customRule}
                    onChange={(event) => setCustomRule(event.target.value)}
                    placeholder="FREQ=WEEKLY;BYDAY=MO"
                    required
                  />
                </label>
              )}
              <label>
                Description
                <textarea
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {task && (
              <button
                type="button"
                className="danger"
                onClick={() => void remove()}
                disabled={busy}
              >
                Delete
              </button>
            )}
            <span />
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
