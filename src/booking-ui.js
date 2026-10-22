export const MAX_PERIODS = 16;
export class BookingError extends Error {}
export function selectPeriods(periods, fromId, throughId) {
  const from = periods.findIndex(p => p.id === fromId);
  const through = periods.findIndex(p => p.id === throughId);
  if (from < 0 || through < from || through - from >= MAX_PERIODS) {
    throw new BookingError('Zgjidhni 1–16 periudha të njëpasnjëshme.');
  }
  return periods.slice(from, through + 1).map(p => p.id);
}
export function reservationTime(ids, periods) {
  const selected = ids.map(id => periods.find(p => p.id === id));
  if (!selected.length || selected.some(p => !p)) return 'Ora nuk është e disponueshme';
  selected.sort((a,b) => a.start.localeCompare(b.start));
  return `${selected[0].start}–${selected.at(-1).end}`;
}
export function errorText(error) {
  if (error instanceof BookingError) return error.message;
  const messages = {
    'auth/popup-closed-by-user':'Dritarja e hyrjes u mbyll. Provoni përsëri.',
    'auth/cancelled-popup-request':'Kërkesa e hyrjes u anulua. Provoni përsëri.',
    'auth/popup-blocked':'Shfletuesi bllokoi dritaren e hyrjes. Lejoni dritaret kërcyese për këtë faqe.',
    'auth/network-request-failed':'Lidhja me rrjetin dështoi. Kontrolloni internetin.',
    'auth/unauthorized-domain':'Hyrja nuk është aktivizuar për këtë faqe. Kontaktoni administratorin.',
    'auth/user-disabled':'Kjo llogari është çaktivizuar. Kontaktoni administratorin.',
    'permission-denied':'Veprimi nuk lejohet. Rifreskoni faqen dhe kontrolloni nëse llogaria juaj është miratuar.',
    'unavailable':'Shërbimi nuk është i disponueshëm. Kontrolloni internetin dhe provoni përsëri.',
    'aborted':'Disponueshmëria ndryshoi gjatë rezervimit. Rifreskoni faqen dhe provoni përsëri.',
    'resource-exhausted':'Shërbimi ka arritur kufirin e përdorimit. Provoni më vonë.',
    'deadline-exceeded':'Kërkesa zgjati shumë. Kontrolloni lidhjen dhe provoni përsëri.'
  };
  console.error(error);
  return messages[error?.code] || 'Ndodhi një gabim. Provoni përsëri ose kontaktoni administratorin.';
}
