// js/hints.js
// Centralized predicates for "should this hint be visible right now?". Each
// renderer (palettes.js, groupContext.js, following.js, favorites.js) used
// to re-derive these gates inline as long isHintSeen() chains. The duplicates
// drifted — theme-hint silently went missing in group context because someone
// porting palettes.js's swatch row to group context skipped one block. New
// hints (or changes to existing gates) belong in this file so every call
// site stays consistent.
//
// Context-specific guards (PALETTES_ENABLED feature flag, override.enabled
// in group, "is the peer currently available", "is this their own combo")
// remain at the call site — they vary per renderer and don't belong in the
// shared hint-state predicates.
import { isHintSeen } from './prefs.js';

// Rolling wave attractor across unselected swatches in either swatch row.
// Per-set: shows on the active set while that set's selectedKey is its
// default. Switching sets continues to nudge until the user picks a non-
// default swatch in the now-active set. Going Available with a custom color
// hides the wave everywhere.
export function shouldShowSwatchWave(paletteState) {
  if (isHintSeen('customAvail')) return false;
  const activeSet = paletteState.activeSet;
  const defaultKey = activeSet === 1 ? 'forest' : 'volt';
  return paletteState.sets[String(activeSet)].selectedKey === defaultKey;
}

// Pulsing dotted ring on the currently-selected swatch, nudging the user to
// long-press it to enter palette mode.
export function shouldShowThemeHint() {
  return isHintSeen('customAvail') && !isHintSeen('theme');
}

// Colored pulse on the availability dot, nudging the user to tap it to go
// Available after they've picked a non-default swatch.
export function shouldShowDotGoHint({ isNonDefault, dotAvailable }) {
  return !isHintSeen('customAvail') && isNonDefault && !dotAvailable;
}

// First-use pulse on the bolt/tree set-toggle icon. Stops once the user has
// tapped the icon to discover the other palette set.
export function shouldShowSetTogglePulse(activeSet) {
  return !isHintSeen(activeSet === 1 ? 'bolt' : 'flower');
}

// The longpress/swipe hints sit at the end of the FTU chain; both require
// customAvail+theme+stripPeek seen first. Eligibility here just covers the
// hint-state chain — call sites combine this with context guards (peer is
// available, not in a call, override is on, peer's combo isn't already mine).
export function isLongpressHintEligible() {
  return isHintSeen('customAvail')
      && isHintSeen('theme')
      && isHintSeen('stripPeek')
      && !isHintSeen('longpress');
}

export function isSwipeHintEligible() {
  return isHintSeen('customAvail')
      && isHintSeen('theme')
      && isHintSeen('stripPeek')
      && !isHintSeen('swipe');
}
