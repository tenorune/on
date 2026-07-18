// types/app.d.ts — ambient shapes for the RTDB contract seams. Global (no
// import/export at top level) so plain-JS files can reference them from JSDoc
// as {UserPrefs} etc. without importing. These document the WIRE shapes —
// everything is optional/nullable because RTDB nodes can be absent.

// Client code never sees a real Node `process`: esbuild's `define` replaces
// `process.env.X` expressions textually at bundle time (scripts/build.js).
// This narrow declaration types exactly that seam — deliberately NOT
// @types/node, which would let browser code reference Node globals that
// don't exist at runtime. If functions/ checking (plan Task 5) needs real
// Node types, scope them there rather than widening this.
declare const process: { env: Record<string, string | undefined> };

/** users/{uid}/userPrefs — the cross-device account prefs node. */
interface UserPrefs {
  /** Linked-Telegram marker: non-null iff the account is linked (set on link,
   * cleared on unlink). The three-reader notify contract keys off this plus
   * notifyChannel — see shared/notifyDelivery.js. */
  telegram?: object | null;
  /** Delivery channel. MISSING/unknown reads as 'telegram' for a linked
   * account (only an explicit 'push' opts out) — shared/notifyDelivery.js. */
  notifyChannel?: string | null;
  /** Registered web-push registrations, keyed by token id. */
  pushTokens?: Record<string, unknown> | null;
  // ── Fields below are read only by js/prefs.js syncFromServer (the
  //    localStorage-cache reconciler); typed from how that code uses them. ──
  /** Seen-hint flags, keyed by short hint name (js/prefs.js HINT_KEYS). */
  hints?: Record<string, boolean> | null;
  /** "(swipe right to answer)" hint counter — server's larger value wins. */
  madeCallCount?: number | null;
  /** Same contract as madeCallCount, for answered calls. */
  answeredCallCount?: number | null;
  /** Favorites strip collapsed/expanded. */
  favoritesCollapsed?: boolean | null;
  /** Direct-context palette state lives under .direct (perGroup carries the
   * group-context ones). Opaque here: the client round-trips store.js's
   * shape without field access at this seam. */
  paletteState?: { direct?: unknown } | null;
  /** Saved palette combos. Written as an array; RTDB may echo it back as a
   * keyed object when entries are missing/non-sequential — readers normalize
   * (js/prefs.js syncFromServer). */
  favorites?: unknown[] | Record<string, unknown> | null;
  /** 'direct' | 'group:{groupId}'. */
  currentContext?: string | null;
  /** Direct "go available for N" chip default. */
  lastTimeoutMinutes?: number | null;
  /** Per-group bundles, keyed by group id. */
  perGroup?: Record<string, {
    paletteState?: unknown;
    lastTimeoutMinutes?: number | null;
  } | null> | null;
  /** Per-person notification prefs, keyed by target uid. */
  notify?: Record<string, NotifyPrefsEntry | null> | null;
}

/** userPrefs/{uid}/notify/{targetUid} — per-person notification toggles. */
interface NotifyPrefsEntry {
  knock?: boolean | null;
  call?: boolean | null;
  availability?: boolean | null;
}

/** users/{uid}/presence-shaped nodes (primary presence, and the presence half
 * of a group statusOverride). */
interface PresenceNode {
  status?: string | null;
  /** Epoch ms end of the availability window; null/absent = open-ended on the
   * client, NOT-available to the server notifier — the pinned divergence in
   * tests/presencePredicateParity.test.js. */
  availableUntil?: number | null;
}

/** groups/{gid}/members/{uid}/statusOverride — per-audience status. */
interface StatusOverride extends PresenceNode {
  /** The bot/server only honor the override when enabled === true. */
  enabled?: boolean | null;
}

/** locations/{uid} and locationCells/{gid}/{uid} nodes. */
interface LocationNode {
  lat?: number;
  lng?: number;
  updatedAt?: number;
}
