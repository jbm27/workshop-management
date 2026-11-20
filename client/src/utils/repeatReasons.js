/** Why a car came back (repeat / goodwill job). Mirrors server/src/repeatReasons.js. */
export const REPEAT_REASONS = [
  { value: 'workmanship', label: 'Our workmanship' },
  { value: 'faulty_part', label: 'Faulty part' },
  { value: 'misdiagnosis', label: 'Misdiagnosis' },
  { value: 'not_our_fault', label: 'Not our fault (customer / unrelated)' },
  { value: 'other', label: 'Other' },
];

export function repeatReasonLabel(v) {
  return REPEAT_REASONS.find((r) => r.value === v)?.label || 'Not recorded';
}
