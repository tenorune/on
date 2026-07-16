// js/status.ts — the single source of truth for status propagation: the
// effective-status merge (override-vs-primary) plus the availability time-chip
// table. Both were hand-duplicated before — the merge across four render sites
// (groupNav.paintNavCard, groupContext.memberEffectiveAvailable/paintRosterRow/
// renderOwnStatusRow) and CHIP_VALUES/chipIndexForMinutes across me.ts and
// groupContext.ts.
import { isAvailable } from './utils.js';

// Presentation-bearing presence shape. The ambient PresenceNode/StatusOverride
// wire types (types/app.d.ts) are deliberately MINIMAL — status/availableUntil
// only — but statusColor/paletteKey exist at runtime on presence and override
// nodes, so the selector reads them off this richer local shape (same reason
// groupContext/groupNav carry local PresenceLike/OverrideEntry typedefs).
export type StatusInput = {
  status?: string | null;
  availableUntil?: number | null;
  statusColor?: string | null;
  paletteKey?: string | null;
};
export type OverrideInput = StatusInput & { enabled?: boolean | null };

export type EffectiveStatus = {
  available: boolean;
  statusColor: string | null;
  paletteKey: string | null;
  availableUntil: number | null;
};

/**
 * Merge an own/member primary presence with its group override into the one
 * effective status every render site paints.
 *
 * The single rule, identical across all four former call sites: the override
 * wins IFF it is explicitly enabled (`enabled === true`); otherwise the primary
 * wins. Whichever is chosen is taken WHOLESALE — no per-field fall-through to
 * the other (an override-on member who left their group card unthemed, i.e.
 * paletteKey null, must not pick up their Direct theme). Availability is then
 * `isAvailable(status, availableUntil)` on the chosen source — the client
 * fail-open predicate (js/utils.ts), NOT the server's fail-closed variant; that
 * divergence is tripwired by tests/presencePredicateParity.test.js and must not
 * be "fixed" here.
 *
 * Presentation defaults stay at the call sites: this returns raw nulls, so
 * paintNavCard/paintDirectCard keep their own '#22c55e' color fallback while
 * the other three sites keep their null.
 *
 * Note: an enabled-but-expired override renders unavailable and is NOT replaced
 * by the primary — matching every current site. That input is unreachable (no
 * writer emits an expired override), so the choice is behavior-preserving.
 */
export function effectiveStatus(
  primary: StatusInput | null,
  override: OverrideInput | null,
): EffectiveStatus {
  const overrideOn = !!(override && override.enabled === true);
  const source = overrideOn ? override : primary;
  return {
    available: isAvailable(source?.status, source?.availableUntil),
    statusColor: source?.statusColor ?? null,
    paletteKey: source?.paletteKey ?? null,
    availableUntil: source?.availableUntil ?? null,
  };
}

// The availability time-chip table: the durations the "go available for …" chip
// cycles through. Single copy — moved here from me.ts and groupContext.ts.
export const CHIP_VALUES = [
  { minutes: 30,   text: '30 minutes' },
  { minutes: 60,   text: '1 hour' },
  { minutes: 90,   text: '1 hour 30 minutes' },
  { minutes: 120,  text: '2 hours' },
  { minutes: 180,  text: '3 hours' },
  { minutes: 240,  text: '4 hours' },
  { minutes: 360,  text: '6 hours' },
  { minutes: 480,  text: '8 hours' },
  { minutes: 720,  text: '12 hours' },
  { minutes: 1080, text: '18 hours' },
  { minutes: 1440, text: '24 hours' },
];

// Index of the chip whose minutes are closest to `minutes`. Legacy sub-13
// values were stored as hours — scale ×60 before matching.
export function chipIndexForMinutes(minutes: number) {
  let m = minutes;
  if (m <= 12) m = m * 60; // legacy: some old values were stored as hours
  let bestIndex = 0;
  let bestDist = Math.abs(CHIP_VALUES[0].minutes - m);
  for (let i = 1; i < CHIP_VALUES.length; i++) {
    const dist = Math.abs(CHIP_VALUES[i].minutes - m);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}
