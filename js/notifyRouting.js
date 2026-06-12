// js/notifyRouting.js
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
export function routeNotificationClick(data, { navigateToDirect, navigateToGroup, openInboxModal }) {
  const type = data?.type;
  if (type === 'invite' || type === 'followRequest') {
    navigateToDirect();
    openInboxModal();
    return;
  }
  if (data?.contextGroupId) { navigateToGroup(data.contextGroupId); return; }
  if (type === 'knock' || type === 'call' || type === 'availability') navigateToDirect();
}
