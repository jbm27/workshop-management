export const KENYA_TIMEZONE = 'Africa/Nairobi';
export const KENYA_UTC_OFFSET = '+03:00';

/** Parse a device-local Kenya date/time string into a UTC Date. */
export function parseKenyaLocalDateTime(dateTimeStr) {
  const normalized = String(dateTimeStr ?? '')
    .trim()
    .replace(' ', 'T');

  if (!normalized) {
    throw new Error('dateTimeStr is required');
  }

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized)) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const parsed = new Date(`${normalized}${KENYA_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid Kenya local date/time: ${dateTimeStr}`);
  }
  return parsed;
}
