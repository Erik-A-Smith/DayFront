import { XMLParser } from 'fast-xml-parser';

import { CalDavError } from './errors.js';

type XmlRecord = Record<string, unknown>;

export interface DavPropertySet {
  href: string;
  properties: XmlRecord;
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['response', 'propstat', 'comp'].includes(name),
});

function record(value: unknown): XmlRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as XmlRecord)
    : undefined;
}

export function text(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  const object = record(value);
  return object ? text(object['#text']) : undefined;
}

export function parseMultiStatus(xml: string): DavPropertySet[] {
  let document: unknown;
  try {
    document = parser.parse(xml) as unknown;
  } catch (error: unknown) {
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'CalDAV server returned malformed XML.',
      undefined,
      { cause: error },
    );
  }

  const root = record(document);
  const multistatus = record(root?.multistatus);
  const responses = multistatus?.response;
  if (!Array.isArray(responses)) {
    throw new CalDavError(
      'CALDAV_PROTOCOL_ERROR',
      'CalDAV response was not a DAV multistatus.',
    );
  }

  return responses.flatMap((item): DavPropertySet[] => {
    const response = record(item);
    const href = text(response?.href);
    const propstats = response?.propstat;
    if (!href || !Array.isArray(propstats)) return [];
    const entries: unknown[] = propstats;

    const successful = entries.find((entry) => {
      const status = text(record(entry)?.status);
      return status?.includes(' 200 ') ?? false;
    });
    const properties = record(record(successful)?.prop);
    return properties ? [{ href, properties }] : [];
  });
}

export function propertyHref(
  properties: XmlRecord,
  name: string,
): string | undefined {
  return text(record(properties[name])?.href ?? properties[name]);
}

export function hasProperty(
  properties: XmlRecord,
  container: string,
  name: string,
): boolean {
  const value = record(properties[container]);
  return value !== undefined && Object.hasOwn(value, name);
}

export function componentNames(
  properties: XmlRecord,
): ('VEVENT' | 'VTODO' | 'VJOURNAL')[] {
  const supported = record(properties['supported-calendar-component-set']);
  const components = supported?.comp;
  if (!Array.isArray(components)) return [];
  return components.flatMap((component) => {
    const name = record(component)?.['@_name'];
    return name === 'VEVENT' || name === 'VTODO' || name === 'VJOURNAL'
      ? [name]
      : [];
  });
}
