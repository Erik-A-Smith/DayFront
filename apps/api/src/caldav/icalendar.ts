import ICAL from 'ical.js';

import { CalDavError } from './errors.js';

export class ICalendarDocument {
  private constructor(private readonly component: ICAL.Component) {}

  static parse(source: string): ICalendarDocument {
    try {
      // ical.js ships a legacy `any` return type for its validated jCal parser.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const component = new ICAL.Component(ICAL.parse(source));
      if (component.name !== 'vcalendar')
        throw new Error('Root component is not VCALENDAR.');
      return new ICalendarDocument(component);
    } catch (error: unknown) {
      throw new CalDavError(
        'CALDAV_PROTOCOL_ERROR',
        'Calendar resource contains invalid iCalendar data.',
        undefined,
        { cause: error },
      );
    }
  }

  serialize(): string {
    return this.component.toString();
  }

  componentNames(): string[] {
    return this.component
      .getAllSubcomponents()
      .map((component) => component.name.toUpperCase());
  }
}
