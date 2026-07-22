// js/telegramLinkCopy.ts — shared, dependency-free copy for the Telegram link
// flows. Kept standalone (no imports) so both the heavy redeem module
// (telegramLinkArrival.js) and the settings drawer (telegramSettings.js) can
// share it without dragging each other's dependency graphs along.

// The ONE place the "linking replaces the temporary account" warning is spelled
// (C6 — was duplicated byte-for-byte across the two flows). Count-aware when the
// server reports what would be lost (redeem's replace branch, U2.1); falls back
// to the generic sentence when counts are unknown (the manual link screen, which
// has none). The redeem replace branch only fires with contacts>0 or groups>0,
// so a count-aware call always names at least one.
export function linkReplaceWarning(
  counts?: { contacts?: number, groups?: number } | null,
): string {
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  let what = 'contacts and groups';
  if (counts) {
    const parts = [];
    if (counts.contacts) parts.push(plural(counts.contacts, 'contact'));
    if (counts.groups) parts.push(plural(counts.groups, 'group'));
    if (parts.length) what = parts.join(' and ');
  }
  return `Linking replaces this temporary Telegram account — its ${what} will be removed.`;
}
