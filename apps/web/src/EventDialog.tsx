import type { Calendar, CalendarEvent, EventMutation } from '@dayfront/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { ClockInput, type TimeFormat } from './ClockInput.js';

interface EventDialogProps {
  calendars: readonly Calendar[];
  event?: CalendarEvent;
  initialDate?: string;
  initialEnd?: string;
  timeFormat?: TimeFormat;
  onCancel: () => void;
  onDelete?: (scope: 'series' | 'occurrence') => Promise<void>;
  onSave: (input: EventMutation) => Promise<void>;
}

function localDateTime(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function timedValue(value: string, fallbackTime: string): string {
  return value.includes('T') ? value.slice(0, 16) : `${value}T${fallbackTime}`;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function timePart(value: string): string {
  return value.includes('T') ? value.slice(11, 16) : '';
}

function withDate(value: string, date: string, fallbackTime: string): string {
  return date ? `${date}T${timePart(value) || fallbackTime}` : '';
}

function withTime(value: string, time: string): string {
  const date = datePart(value);
  return date && time ? `${date}T${time}` : value;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function oneHourAfter(value: string): string {
  const date = new Date(value.slice(0, 16));
  date.setHours(date.getHours() + 1);
  return localDateTime(date.toISOString());
}

function oneHourBefore(value: string): string {
  const date = new Date(value.slice(0, 16));
  date.setHours(date.getHours() - 1);
  return localDateTime(date.toISOString());
}

const commonRules = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
} as const;

function recurrenceChoice(rule?: string): string {
  if (!rule) return 'none';
  return (
    Object.entries(commonRules).find(([, value]) => value === rule)?.[0] ??
    'custom'
  );
}

export function EventDialog({
  calendars,
  event,
  initialDate,
  initialEnd,
  timeFormat = '12h',
  onCancel,
  onDelete,
  onSave,
}: EventDialogProps) {
  const initialAllDay = event?.allDay ?? !initialDate?.includes('T');
  const [allDay, setAllDay] = useState(initialAllDay);
  const [title, setTitle] = useState(event?.title ?? '');
  const [calendarId, setCalendarId] = useState(
    event?.calendarId ?? calendars[0]?.id ?? '',
  );
  const [start, setStart] = useState(
    event
      ? event.allDay
        ? event.start.slice(0, 10)
        : localDateTime(event.start)
      : (initialDate?.slice(0, initialAllDay ? 10 : 16) ?? ''),
  );
  const [end, setEnd] = useState(
    event?.end
      ? event.allDay
        ? shiftDate(event.end, -1)
        : localDateTime(event.end)
      : initialDate && !initialAllDay
        ? oneHourAfter(initialDate)
        : (initialEnd?.slice(0, 10) ?? initialDate?.slice(0, 10) ?? ''),
  );
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [recurrence, setRecurrence] = useState(
    recurrenceChoice(event?.recurrenceRule),
  );
  const [customRule, setCustomRule] = useState(
    recurrenceChoice(event?.recurrenceRule) === 'custom'
      ? (event?.recurrenceRule ?? '')
      : '',
  );
  const [recurrenceScope, setRecurrenceScope] = useState<
    'series' | 'occurrence'
  >(event?.recurring && event.recurrenceId ? 'occurrence' : 'series');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const operationInFlight = useRef(false);
  const movingRecurringSeries = Boolean(
    event?.recurring && event.recurrenceId && calendarId !== event.calendarId,
  );

  useEffect(
    () => document.querySelector<HTMLInputElement>('#event-title')?.focus(),
    [],
  );

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onSave({
        calendarId,
        title,
        start: allDay ? start : new Date(start).toISOString(),
        ...(end
          ? {
              end: allDay ? shiftDate(end, 1) : new Date(end).toISOString(),
            }
          : {}),
        allDay,
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
        recurrenceRule:
          recurrence === 'none'
            ? null
            : recurrence === 'custom'
              ? customRule
              : commonRules[recurrence as keyof typeof commonRules],
        ...(event?.recurring
          ? {
              recurrenceScope: movingRecurringSeries
                ? 'series'
                : recurrenceScope,
              ...(event.recurrenceId
                ? {
                    recurrenceId: event.recurrenceId,
                    occurrenceStart: event.start,
                  }
                : {}),
            }
          : {}),
      });
    } catch {
      operationInFlight.current = false;
      setError(
        'The event could not be saved. Reload if it was changed by another client.',
      );
      setBusy(false);
    }
  }

  async function remove() {
    if (
      operationInFlight.current ||
      !onDelete ||
      !window.confirm('Delete this event?')
    )
      return;
    operationInFlight.current = true;
    setBusy(true);
    try {
      await onDelete(recurrenceScope);
    } catch {
      operationInFlight.current = false;
      setError('The event could not be deleted. Reload and try again.');
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="event-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="event-dialog-title">{event ? 'Edit event' : 'New event'}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form onSubmit={(formEvent) => void submit(formEvent)}>
          <label>
            Title
            <input
              id="event-title"
              value={title}
              onChange={(change) => setTitle(change.target.value)}
              required
            />
          </label>
          <label>
            Calendar
            <select
              aria-label="Calendar"
              value={calendarId}
              onChange={(change) => {
                setCalendarId(change.target.value);
                if (
                  event?.recurring &&
                  event.recurrenceId &&
                  change.target.value !== event.calendarId
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
            {event?.recurring && event.recurrenceId && (
              <span className="field-hint">
                Changing calendars moves the entire recurring series.
              </span>
            )}
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(change) => {
                const checked = change.target.checked;
                setAllDay(checked);
                if (checked) {
                  setStart((value) => value.slice(0, 10));
                  setEnd((value) => value.slice(0, 10));
                } else {
                  setStart((value) =>
                    value ? timedValue(value, '09:00') : value,
                  );
                  setEnd((value) =>
                    value ? timedValue(value, '10:00') : value,
                  );
                }
              }}
            />
            All day
          </label>
          <div className="date-fields">
            <div className="date-time-field">
              <span>Starts</span>
              <div className="date-time-inputs">
                <input
                  aria-label="Start date"
                  type="date"
                  value={datePart(start)}
                  onChange={(change) => {
                    const next = allDay
                      ? change.target.value
                      : withDate(start, change.target.value, '09:00');
                    setStart(next);
                    if (next)
                      setEnd((current) => {
                        if (!current)
                          return allDay
                            ? datePart(next)
                            : !event
                              ? oneHourAfter(next)
                              : withDate('', datePart(next), '10:00');
                        return datePart(next) > datePart(current)
                          ? allDay
                            ? datePart(next)
                            : withDate(current, datePart(next), '10:00')
                          : current;
                      });
                  }}
                  required
                />
                {!allDay && (
                  <ClockInput
                    label="Start time"
                    value={timePart(start)}
                    timeFormat={timeFormat}
                    onChange={(time) => {
                      const next = withTime(start, time);
                      setStart(next);
                      if (next)
                        setEnd((current) => {
                          if (!current || next >= current)
                            return oneHourAfter(next);
                          return current;
                        });
                    }}
                  />
                )}
              </div>
            </div>
            <div className="date-time-field">
              <span>Ends</span>
              <div className="date-time-inputs">
                <input
                  aria-label="End date"
                  type="date"
                  value={datePart(end)}
                  onChange={(change) => {
                    const next = allDay
                      ? change.target.value
                      : withDate(end, change.target.value, '10:00');
                    setEnd(next);
                    if (next) {
                      if (!start)
                        setStart(
                          allDay
                            ? datePart(next)
                            : withDate('', datePart(next), '09:00'),
                        );
                      else if (datePart(next) < datePart(start))
                        setStart(
                          allDay
                            ? datePart(next)
                            : withDate(start, datePart(next), '09:00'),
                        );
                    }
                  }}
                />
                {!allDay && (
                  <ClockInput
                    label="End time"
                    value={timePart(end)}
                    timeFormat={timeFormat}
                    onChange={(time) => {
                      const next = withTime(end || datePart(start), time);
                      setEnd(next);
                      if (next && start && next <= start)
                        setStart(oneHourBefore(next));
                    }}
                  />
                )}
              </div>
            </div>
          </div>
          <label>
            Repeats
            <select
              value={recurrence}
              onChange={(change) => setRecurrence(change.target.value)}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom RRULE</option>
            </select>
          </label>
          {event?.recurring && event.recurrenceId && (
            <label>
              Apply changes to
              <select
                value={movingRecurringSeries ? 'series' : recurrenceScope}
                onChange={(change) =>
                  setRecurrenceScope(
                    change.target.value as 'series' | 'occurrence',
                  )
                }
              >
                <option value="occurrence" disabled={movingRecurringSeries}>
                  This occurrence
                </option>
                <option value="future" disabled>
                  This and future occurrences — not yet supported
                </option>
                <option value="series">Entire series</option>
              </select>
            </label>
          )}
          {recurrence === 'custom' && (
            <label>
              Recurrence rule
              <input
                value={customRule}
                onChange={(change) => setCustomRule(change.target.value)}
                placeholder="FREQ=WEEKLY;BYDAY=MO,WE"
                required
              />
            </label>
          )}
          <label>
            Location
            <input
              value={location}
              onChange={(change) => setLocation(change.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              rows={4}
              value={description}
              onChange={(change) => setDescription(change.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {event && (
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
