import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarEntryContent } from '../src/App.js';

describe('calendar task quick-complete button', () => {
  afterEach(cleanup);
  it('completes a task without triggering the card click', () => {
    const complete = vi.fn();
    const open = vi.fn();
    render(
      <div onClick={open}>
        <CalendarEntryContent
          entry={{ entryType: 'todo', title: 'Write report', recurring: true }}
          timeText="9 AM"
          onCompleteTask={complete}
        />
      </div>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete Write report' }),
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not show a completion button on ordinary calendar events', () => {
    render(
      <CalendarEntryContent
        entry={{ entryType: 'event', title: 'Meeting', recurring: false }}
        timeText="10 AM"
      />,
    );
    expect(
      screen.queryByRole('button', { name: /Complete/ }),
    ).not.toBeInTheDocument();
  });
});
