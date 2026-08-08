interface Props {
  action: 'save' | 'delete';
  entryType: 'event' | 'task';
  onSelect: (scope: 'occurrence' | 'series') => void;
  onCancel: () => void;
}

export function RecurrenceActionDialog({
  action,
  entryType,
  onSelect,
  onCancel,
}: Props) {
  const verb = action === 'save' ? 'Apply changes to' : 'Delete';
  return (
    <div
      className="recurrence-action-backdrop"
      role="presentation"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <section
        className="recurrence-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurrence-action-title"
      >
        <div className="recurrence-action-heading">
          <span className="recurrence-action-icon" aria-hidden="true">
            ↻
          </span>
          <div>
            <h3 id="recurrence-action-title">{verb}…</h3>
            <p>This {entryType} is part of a recurring series.</p>
          </div>
        </div>
        <div className="recurrence-action-options">
          <button
            type="button"
            onClick={() => onSelect('occurrence')}
            autoFocus
          >
            <strong>This occurrence</strong>
            <span>Only the selected date</span>
          </button>
          <button type="button" onClick={() => onSelect('series')}>
            <strong>Entire series</strong>
            <span>Every occurrence in the series</span>
          </button>
        </div>
        <button
          type="button"
          className="recurrence-action-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </section>
    </div>
  );
}
