import {
  formatEventTimeInput,
  parseEventDateInEventTimeZone,
} from '@/features/admin/utils/event-date.utils';
import {type EditableEvent} from '@/core/models/event.types';
import {type EventVisibility} from '@shared/domain/event-visibility';
import {logger} from '@/utils/logger';
import {getTodayInEventTimeZone} from '@/utils/event-date-format';

/**
 * Pure form-model helpers for the event editor: the string-based form shape,
 * USD/whole-number parsing, and the mapping between a loaded event and the
 * editable model. Kept in a sibling module so the component file stays within
 * its size budget and these functions can be unit-tested in isolation.
 */

export interface EventFormModel {
  title: string;
  date: Date | null;
  time: string;
  endDate: Date | null;
  endTime: string;
  location: string;
  description: string;
  price: string; // String for input compatibility
  totalTickets: string; // String for input compatibility
  slidingScaleEnabled: boolean;
  slidingScaleMin: string;
  slidingScaleMax: string;
  supporterDefaultPrice: string;
  maxTicketsPerUser: string;
  organizerId: string;
  visibility: EventVisibility;
}

export interface LoadedEventState {
  event: EditableEvent;
  currentPosterUrl: string | null;
  eventModel: EventFormModel;
}

export interface EventEditorSourceState {
  id: string | undefined;
  loadedState: LoadedEventState | undefined;
  createOrganizerId: string;
}

export const DEFAULT_NOTAFLOF_MAX_AMOUNT = '10';
const STRICT_USD_AMOUNT_PATTERN = /^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/;
const INVALID_USD_AMOUNT_MESSAGE = 'Use a dollar amount like 20 or 20.00';

export type StrictUsdParseResult =
  | {valid: true; cents: number}
  | {valid: false; reason: 'blank' | 'negative' | 'invalid'};

export function startOfToday(): Date {
  return getTodayInEventTimeZone();
}

export function createEmptyEventFormModel(organizerId = ''): EventFormModel {
  return {
    title: '',
    date: null,
    time: '20:00',
    endDate: null,
    endTime: '',
    location: '',
    description: '',
    price: '0',
    totalTickets: '100',
    slidingScaleEnabled: false,
    slidingScaleMin: '0',
    slidingScaleMax: DEFAULT_NOTAFLOF_MAX_AMOUNT,
    supporterDefaultPrice: '5',
    maxTicketsPerUser: '4',
    organizerId,
    visibility: 'private',
  };
}

export function parseStrictUsdCents(value: string): StrictUsdParseResult {
  const trimmed = value.trim();
  if (trimmed === '') {
    return {valid: false, reason: 'blank'};
  }

  if (trimmed.startsWith('-')) {
    return {valid: false, reason: 'negative'};
  }

  if (!STRICT_USD_AMOUNT_PATTERN.test(trimmed)) {
    return {valid: false, reason: 'invalid'};
  }

  const [dollarsPart, centsPart = ''] = trimmed.split('.');
  const dollars = dollarsPart === '' ? 0 : Number(dollarsPart);
  const cents = Number(centsPart.padEnd(2, '0'));
  return {valid: true, cents: dollars * 100 + cents};
}

export function parseOptionalStrictUsdCents(value: string): number | undefined {
  const parsed = parseStrictUsdCents(value);
  return parsed.valid ? parsed.cents : undefined;
}

export function invalidUsdAmountError(
  value: string,
): {kind: string; message: string} | null {
  const parsed = parseStrictUsdCents(value);
  if (parsed.valid || parsed.reason === 'blank') {
    return null;
  }

  if (parsed.reason === 'negative') {
    return {
      kind: 'negativePrice',
      message: 'Price cannot be negative',
    };
  }

  return {
    kind: 'invalidDecimal',
    message: INVALID_USD_AMOUNT_MESSAGE,
  };
}

export function invalidOptionalUsdAmountError(
  value: string,
): {kind: string; message: string} | null {
  const parsed = parseStrictUsdCents(value);
  return parsed.valid || parsed.reason === 'blank'
    ? null
    : {
        kind: 'invalidDecimal',
        message: INVALID_USD_AMOUNT_MESSAGE,
      };
}

export function requireStrictUsdCents(value: string, field: string): number {
  const parsed = parseStrictUsdCents(value);
  if (!parsed.valid) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed.cents;
}

export function parseOptionalWholeNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : Math.trunc(Number(trimmed));
}

export function buildEventFormModel(evt: EditableEvent): EventFormModel {
  const parsedDate = parseEventDateInEventTimeZone(evt.date);

  if (!parsedDate) {
    logger.warn(
      '[EventEditor] Event date could not be parsed, form will be invalid:',
      evt.date,
    );
  }

  return {
    title: evt.title,
    date: parsedDate,
    time: formatEventTimeInput(evt.date),
    endDate: evt.endDate ? parseEventDateInEventTimeZone(evt.endDate) : null,
    endTime: evt.endDate ? formatEventTimeInput(evt.endDate) : '',
    location: evt.location || '',
    description: evt.description || '',
    price: String((evt.price || 0) / 100),
    totalTickets: String(evt.totalTickets ?? 100),
    slidingScaleEnabled: evt.slidingScaleEnabled || false,
    slidingScaleMin: String((evt.slidingScaleMin || 0) / 100),
    slidingScaleMax: String((evt.slidingScaleMax || 0) / 100),
    // Absent (never set or cleared) must render as empty, not a default. A
    // default here would re-materialize the field on the next save and silently
    // undo a clear.
    supporterDefaultPrice:
      evt.supporterDefaultPrice !== undefined
        ? String(evt.supporterDefaultPrice / 100)
        : '',
    maxTicketsPerUser:
      evt.maxTicketsPerUser !== undefined ? String(evt.maxTicketsPerUser) : '',
    organizerId: evt.organizerId ?? '',
    visibility: evt.visibility ?? 'private',
  };
}

export function resolveFormModelFromSource(
  source: EventEditorSourceState,
  previous?: {source: EventEditorSourceState; value: EventFormModel},
): EventFormModel {
  if (source.loadedState) {
    return source.loadedState.eventModel;
  }

  if (!source.id) {
    if (!previous || previous.source.id !== undefined) {
      return createEmptyEventFormModel(source.createOrganizerId);
    }

    if (
      previous.source.createOrganizerId !== source.createOrganizerId &&
      source.createOrganizerId
    ) {
      return {...previous.value, organizerId: source.createOrganizerId};
    }

    return previous.value;
  }

  return previous?.value ?? createEmptyEventFormModel(source.createOrganizerId);
}

export function humanizeSaveError(message: string | null): string | null {
  const knownMessages: Record<string, string> = {
    scheduled_too_far: 'Choose a send time within the next 90 days.',
    scheduled_too_soon: 'Choose a send time at least 1 minute from now.',
  };

  return message ? (knownMessages[message] ?? message) : null;
}
