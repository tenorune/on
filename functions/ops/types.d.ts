// Structural types for the ops panel. Real TS syntax in a .d.ts (no build
// step) referenced from the .js modules as
// `@type {import('./types.js').Snapshot}` — the types/app.d.ts pattern.

export type Provenance =
  | 'telegram-derived'
  | 'phrase'
  | 'phrase-linked'
  | 'graduated'
  | 'unknown';

export interface ProvenanceResult {
  kind: Provenance;
  /** false when the answer rests on the linkedAt heuristic or a missing secret */
  exact: boolean;
  tgId: string | null;
}

export interface AuthUserRecord {
  uid: string;
  email: string | null;
  createdAt: number;
}

export interface Snapshot {
  users: Record<string, any>;
  userPrefs: Record<string, any>;
  groups: Record<string, any>;
  telegramUsers: Record<string, { uid: string; chatId?: string; createdAt?: number; linkedAt?: number }>;
  telegramByUid: Record<string, { tgId: string; chatId?: string }>;
  pushTokens: Record<string, Record<string, { createdAt: number; lastSeen: number; ua?: string }>>;
  locations: Record<string, { lat: number; lng: number; updatedAt: number }>;
  locationCells: Record<string, Record<string, { lat: number; lng: number; updatedAt: number }>>;
  knocks: Record<string, Record<string, any>>;
  calls: Record<string, any>;
  followRequests: Record<string, Record<string, any>>;
  followGrants: Record<string, Record<string, any>>;
  pendingInvites: Record<string, Record<string, any>>;
  pendingInvitesByGroup: Record<string, Record<string, true>>;
  revocations: Record<string, Record<string, true>>;
  codeIndex: Record<string, string>;
  inviteIndex: Record<string, { ownerPath: string; ownerUid: string }>;
  groupIdIndex: Record<string, unknown>;
  canvasKeys: string[];
  authUsers: AuthUserRecord[];
  takenAt: number;
}

export interface GroupMembership {
  gid: string;
  name: string | null;
  displayName: string | null;
  role: string | null;
  isOwner: boolean;
  hasStatusOverride: boolean;
}

export interface Row {
  uid: string;
  code: string | null;
  provenance: ProvenanceResult;
  createdAt: number | null;
  createdAtLabel: string;
  lastSeen: number | null;
  lastSeenLabel: string;
  status: string | null;
  availableUntil: number | null;
  /** The pinned server predicate's answer as of the snapshot — NOT `status`. */
  available: boolean;
  statusLabel: string;
  statusTitle: string | null;
  contacts: number;
  groupCount: number;
  canvasCount: number;
  pushTokenCount: number;
  notifyChannel: string | null;
  locationOptIn: boolean;
}

export interface Detail extends Row {
  followers: string[];
  following: string[];
  mutuals: string[];
  groups: GroupMembership[];
  canvases: Array<{ peer: string; key: string }>;
  pushTokens: Array<{ token: string; lastSeen: number | null; lastSeenLabel: string; ua: string | null }>;
  telegram: { tgId: string; chatId: string | null; mappingLinkedAt: number | null; prefsLinkedAt: number | null } | null;
  location: {
    hasPoint: boolean;
    fixAge: number | null;
    fixAgeLabel: string | null;
    cells: Array<{ gid: string; fixAge: number | null; fixAgeLabel: string | null }>;
  };
}

export interface Finding {
  severity: 'error' | 'warn' | 'info';
  check: string;
  uid: string | null;
  path: string | null;
  detail: string;
}

export interface Conflict {
  kind: string;
  path: string;
  detail: string;
  resolution: string;
}

export interface WritePlan {
  writes: Record<string, unknown>;
  conflicts: Conflict[];
  losses: string[];
}
