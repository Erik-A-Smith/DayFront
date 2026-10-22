import { describe, expect, it } from 'vitest';
import { eventHasEnded } from '../src/calendar-display.js';

const now = new Date('2026-10-21T17:00:00.000Z');
describe('past event state', () => {
  it('dims events only after their end instant', () => {
    expect(eventHasEnded({ end: '2026-10-21T16:00:00Z' }, now)).toBe(true);
    expect(eventHasEnded({ end: '2026-10-21T18:00:00Z' }, now)).toBe(false);
    expect(eventHasEnded({ end: '2026-10-21T17:00:00Z' }, now)).toBe(true);
  });

  it('respects exclusive all-day end dates', () => {
    expect(eventHasEnded({ end: '2026-10-21' }, now)).toBe(true);
    expect(eventHasEnded({ end: '2026-10-22' }, now)).toBe(false);
  });

  it('does not dim unknown or invalid end dates', () => {
    expect(eventHasEnded({}, now)).toBe(false);
    expect(eventHasEnded({ end: 'invalid' }, now)).toBe(false);
  });
});
