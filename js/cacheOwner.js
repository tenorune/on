// js/cacheOwner.js
//
// localStorage is per-origin, but most of what we store in it is
// ACCOUNT-scoped, not device-scoped. Normally that distinction doesn't
// matter because one origin = one account for the lifetime of the install.
// It breaks down in two places: the Telegram in-app webview (the same
// origin can be linked/unlinked across different Telegram accounts, each
// getting its own KnockKnock identity) and a browser profile restoring a
// different recovery phrase than the one last used on that device. Either
// way, the new account boots and silently inherits the previous account's
// cached following list, favorites, prefs, etc.
//
// The sharpest edge of this: following.js's empty-server migration
// heuristic (see syncFollowingFromServer) treats a non-empty local
// `statusapp_following` cache paired with an empty server list as "this is
// a first-run migration, push local up to the server." If the cache is
// actually leftover from a *different* account, that heuristic uploads the
// old account's whole contact list as one-way follows onto the new
// account. This happened in testing with a Telegram-derived account
// inheriting a phrase account's contacts.
//
// ensureCacheOwner(uid) is the guard: call it as early as possible in boot,
// before anything else reads or writes account-scoped cache. It stamps a
// marker with the currently-active uid; when the uid it's called with
// doesn't match the stamped marker, it wipes every account-scoped key
// before adopting the new uid.
//
// Note on the "first run" case: an absent marker does NOT mean "wipe". It
// means either a fresh install (no cache to wipe anyway) or an *existing*
// single-account install upgrading to this code for the first time (which
// has a real, wanted cache that must survive). So an absent marker adopts
// the given uid without touching anything else.
//
// Cosmetic nuance: the inline theme-restore script in index.template.html
// reads statusapp_theme directly (before any bundle code runs, to avoid a
// flash of the wrong theme on normal boots). On an account switch, that
// script can render one frame of the *previous* account's theme before this
// module's wipe lands. That one-frame flash is accepted as a cosmetic cost;
// fixing it would require moving owner-checking into the inline script
// itself, which is out of scope here. (about.template.html has the same
// inline reads of statusapp_theme/statusapp_palette_state and never runs
// this module at all — also cosmetic-only: the about page never writes or
// migrates account state.)

const OWNER_KEY = 'statusapp_cache_owner';

// Exact account-scoped keys. Anything account-shaped that isn't device
// identity/push-plumbing lives here.
const ACCOUNT_SCOPED_KEYS = [
  'statusapp_following',
  'statusapp_favorites',
  'statusapp_favorites_collapsed',
  'statusapp_palette_state',
  'statusapp_palette', // legacy pre-palette-state key; still cleared on switch.
  'statusapp_theme',
  'statusapp_last_timeout',
  'statusapp_current_context',
  'statusapp_notify_prefs',
  'statusapp_follower_names',
  'statusapp_made_call_count',
  'statusapp_answered_call_count',
  'statusapp_inbox_seen',
  'statusapp_follow_requested',
  'statusapp_seen_bolt',
  'statusapp_seen_flower',
  'statusapp_seen_theme',
  'statusapp_seen_strip_peek_done',
  'statusapp_seen_longpress',
  'statusapp_seen_swipe',
  'statusapp_went_avail_custom',
  'statusapp_seen_notify_promo',
];

// Account-scoped key PREFIXES: one entry per group, so they can't be listed
// exactly. Scanned and removed by prefix match.
const ACCOUNT_SCOPED_PREFIXES = [
  'statusapp_group_chip_',
  'statusapp_group_palette_',
];

// Deliberately KEPT — device-scoped, not account-scoped:
//   statusapp_identity                  — the account pointer itself; this
//                                          module reads it indirectly via the
//                                          uid the caller passes in, and
//                                          wiping it here would just cause
//                                          re-derivation churn.
//   statusapp_push_token                — tied to this device's push
//                                          subscription, not to who's signed in.
//   statusapp_notify_reprompt_dismissed — a device-level "don't ask again"
//                                          flag for the notification prompt.
//   statusapp_notify_debug              — a device-level debug opt-in.

function removeAccountScopedKeys() {
  for (const key of ACCOUNT_SCOPED_KEYS) {
    try { localStorage.removeItem(key); } catch { /* private mode / quota */ }
  }

  // Scan backwards so removing an entry doesn't shift indices out from
  // under a forward scan.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (ACCOUNT_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        try { localStorage.removeItem(key); } catch { /* private mode / quota */ }
      }
    }
  } catch { /* private mode / quota */ }
}

// Wipe cached account-scoped state before it can be read by anything else,
// whenever the active uid differs from whoever last owned this origin's
// cache. Call this as the very first thing after identity resolves, before
// initOwnStatus/initNav/initPrefs or any other cache consumer.
export function ensureCacheOwner(uid) {
  if (!uid) return;

  let marker;
  try {
    marker = localStorage.getItem(OWNER_KEY);
  } catch {
    // Can't read localStorage (private mode / disabled) — nothing we can do,
    // and boot must not break because of it.
    return;
  }

  if (marker === uid) return;

  if (marker) {
    // A different account previously owned this cache — wipe it before
    // stamping the new owner.
    removeAccountScopedKeys();
  }
  // else: no marker means first run on this origin, OR an existing
  // single-account install upgrading to this code for the first time.
  // Either way there's nothing to wipe — adopt the uid as-is so a
  // pre-existing single-account cache is preserved.

  try { localStorage.setItem(OWNER_KEY, uid); } catch { /* private mode / quota */ }
}
