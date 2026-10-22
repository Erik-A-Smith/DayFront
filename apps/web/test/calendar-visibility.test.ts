import { describe, expect, it } from 'vitest';
import { showTaskOnCalendar } from '../src/calendar-display.js';

describe('calendar task visibility', () => {
  it('shows unfinished tasks', () => {
    expect(
      showTaskOnCalendar({ status: 'needs-action', completed: false }),
    ).toBe(true);
    expect(showTaskOnCalendar({ status: 'in-process', completed: false })).toBe(
      true,
    );
  });

  it('hides completed tasks from the calendar without deleting them', () => {
    expect(showTaskOnCalendar({ status: 'completed', completed: true })).toBe(
      false,
    );
    expect(showTaskOnCalendar({ status: 'completed', completed: false })).toBe(
      false,
    );
    expect(
      showTaskOnCalendar({ status: 'needs-action', completed: true }),
    ).toBe(false);
  });

  it('hides cancelled tasks', () => {
    expect(showTaskOnCalendar({ status: 'cancelled', completed: false })).toBe(
      false,
    );
  });
});
