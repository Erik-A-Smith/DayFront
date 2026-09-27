export interface CalendarCollection {
  id: string;
  url: string;
  displayName: string;
  description?: string;
  color?: string;
  components: readonly ('VEVENT' | 'VTODO' | 'VJOURNAL')[];
  readOnly: boolean;
}

export interface CalendarResource {
  url: string;
  etag: string;
  calendarData: string;
}

export interface DiscoveryResult {
  principalUrl: string;
  calendarHomeUrl: string;
  calendars: readonly CalendarCollection[];
}
