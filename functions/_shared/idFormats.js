// shared/idFormats.js — the app's id-format trust boundary, ONE copy for web +
// functions. Group ids: 8 chars of A-Z0-9 (js/groups.js generateGroupId;
// database.rules.json pins the same literal — tests/idFormats.test.js keeps
// them in step). App uids: SHA-256 hex truncated to 32 chars (js/identity.js
// deriveUserIdFromRecoveryCode; functions/telegram-auth.js deriveTelegramUid).
// Server side these gate attacker-controllable callback_query.data before
// Admin-SDK writes that BYPASS the rules; client side they gate forged
// notification payloads before navigation. Do not widen.
export const GROUP_ID_RE = /^[A-Z0-9]{8}$/;
export const UID_RE = /^[0-9a-f]{32}$/;
