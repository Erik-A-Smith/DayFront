import type { Calendar, CalendarMutation } from '@dayfront/shared';
import { useState, type FormEvent } from 'react';

interface Props {
  calendars: readonly Calendar[];
  onClose: () => void;
  onSave: (
    calendar: Calendar | undefined,
    input: CalendarMutation,
  ) => Promise<void>;
  onDelete: (calendar: Calendar) => Promise<void>;
}

export function CalendarManager({
  calendars,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState<Calendar | null>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#5b8def');
  const [events, setEvents] = useState(true);
  const [tasks, setTasks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function edit(calendar?: Calendar) {
    setEditing(calendar ?? null);
    setName(calendar?.displayName ?? '');
    setDescription(calendar?.description ?? '');
    setColor(calendar?.color?.slice(0, 7) ?? '#5b8def');
    setEvents(calendar?.components.includes('VEVENT') ?? true);
    setTasks(calendar?.components.includes('VTODO') ?? true);
    setError(undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (!events && !tasks)) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSave(editing ?? undefined, {
        name,
        ...(description ? { description } : {}),
        color,
        components: [
          ...(events ? (['VEVENT'] as const) : []),
          ...(tasks ? (['VTODO'] as const) : []),
        ],
      });
      setEditing(undefined);
    } catch {
      setError('The calendar could not be saved. Reload and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(calendar: Calendar) {
    const typed = window.prompt(
      `Deleting “${calendar.displayName}” permanently removes every event and task in it. Type the calendar name to continue.`,
    );
    if (typed !== calendar.displayName || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onDelete(calendar);
    } catch {
      setError('The calendar could not be deleted. Reload and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="event-dialog calendar-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="calendar-manager-title">
            {editing === undefined
              ? 'Manage calendars'
              : editing
                ? 'Edit calendar'
                : 'New calendar'}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {error && <p className="dialog-error">{error}</p>}
        {editing === undefined ? (
          <>
            <div className="calendar-manager-list">
              {calendars.map((calendar) => (
                <div className="calendar-manager-row" key={calendar.id}>
                  <span
                    className="calendar-color"
                    style={{
                      backgroundColor: calendar.color?.slice(0, 7) ?? '#5b8def',
                    }}
                  />
                  <span>{calendar.displayName}</span>
                  <button type="button" onClick={() => edit(calendar)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={() => void remove(calendar)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => edit()}
            >
              New calendar
            </button>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label>
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
            <fieldset className="calendar-components">
              <legend>Contents</legend>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={events}
                  onChange={(event) => setEvents(event.target.checked)}
                />
                Events
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={tasks}
                  onChange={(event) => setTasks(event.target.checked)}
                />
                Tasks
              </label>
            </fieldset>
            {!events && !tasks && (
              <p className="dialog-error">Select events, tasks, or both.</p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={busy || !name.trim() || (!events && !tasks)}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
