import {ConvexError} from 'convex/values';
import {isRecord} from '@shared/type-guards';

function getObjectStringProperty(
  value: object,
  propertyName: string,
): string | null {
  const propertyValue: unknown = Reflect.get(value, propertyName);
  return typeof propertyValue === 'string' ? propertyValue : null;
}

export function extractConvexErrorMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }

  const data: unknown = error.data;
  if (typeof data === 'string') {
    return data;
  }
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  return getObjectStringProperty(data, 'message');
}

export function normalizeRuntimeErrorMessage(message: string): string {
  let normalized = message;

  const prefixes = ['Uncaught ConvexError: ', 'Uncaught Error: '];
  for (const prefix of prefixes) {
    if (normalized.includes(prefix)) {
      const parts = normalized.split(prefix);
      normalized = parts[parts.length - 1].split('\n')[0].trim();
      break;
    }
  }

  const convexPrefixMatch = normalized.match(/^\[CONVEX [A-Z]\([^)]+\)]\s*/);
  if (convexPrefixMatch) {
    normalized = normalized.slice(convexPrefixMatch[0].length).trim();
  }

  return normalized.replace(/^Server Error\s+/, '').trim();
}

const MAX_REJECTION_DEPTH = 10;

function extractErrorMessageImpl(error: unknown, depth: number): string {
  const convexMessage = extractConvexErrorMessage(error);
  if (convexMessage !== null) {
    return normalizeRuntimeErrorMessage(convexMessage);
  }

  if (error instanceof ConvexError) {
    return '';
  }

  if (error instanceof Error) {
    return normalizeRuntimeErrorMessage(error.message);
  }

  // Unwrap Angular router rejection-wrapped errors.
  // Depth guard prevents stack overflow on circular rejection references.
  if (isRecord(error)) {
    const rejection = error['rejection'];
    if (isRecord(rejection) && depth < MAX_REJECTION_DEPTH) {
      return extractErrorMessageImpl(rejection, depth + 1);
    }
    if (typeof error['message'] === 'string') {
      return normalizeRuntimeErrorMessage(error['message']);
    }
  }

  if (typeof error === 'string') {
    return normalizeRuntimeErrorMessage(error);
  }

  return normalizeRuntimeErrorMessage(String(error));
}

export function extractErrorMessage(error: unknown): string {
  return extractErrorMessageImpl(error, 0);
}
