// js/notifyRouting.ts
// Warm-path routing for a tapped notification (the SW postMessages the click to
// a focused client; see sw.template.js). Kept dependency-injected and pure so it
// can be unit-tested without booting app.js.
//
// Invite / follow-request taps land the user in Direct first, THEN open the
// Inbox — so closing the modal returns to Direct rather than the (possibly
// group) context they were in. This mirrors the cold-start path, where boot
// skips the last-context restore and opens the Inbox over Direct.
// Direct-scope activity (a knock/call/availability with no contextGroupId) also
// returns to Direct, where that activity surfaces (#144). Group activity (a
// contextGroupId) navigates into the group; unknown types are a no-op.
// Group ids are exactly 8 chars of [A-Z0-9] (groups.js generateGroupId). The
// notification payload is attacker-controllable (forged RTDB writes), so reject
// anything that doesn't match before using it as a navigation target — a forged
// id falls back to Direct rather than reaching navigateToGroup (#164 R3c).
import { GROUP_ID_RE } from '../shared/idFormats.js';

type NotificationData = {
  type?: string;
  contextGroupId?: string;
};

type RouteDeps = {
  navigateToDirect: () => void;
  navigateToGroup: (gid: string) => void;
  openInboxModal: () => void;
};

export function routeNotificationClick(
  data: NotificationData | null | undefined,
  { navigateToDirect, navigateToGroup, openInboxModal }: RouteDeps,
): void {
  const type = data?.type;
  if (type === 'invite' || type === 'followRequest') {
    navigateToDirect();
    openInboxModal();
    return;
  }
  const gid = data?.contextGroupId;
  if (gid && GROUP_ID_RE.test(gid)) { navigateToGroup(gid); return; }
  if (type === 'knock' || type === 'call' || type === 'availability') navigateToDirect();
}
