/**
 * Normalizes card expiry month or year to exactly two digits for the API.
 * One digit → leading zero (7 → "07"). Two digits → unchanged (24 → "24").
 * More than two digits → last two (2024 → "24").
 */
export function normalizeCardExpiryTwoDigits(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) {
    return '';
  }
  if (digits.length === 1) {
    return `0${digits}`;
  }
  return digits.slice(-2);
}
