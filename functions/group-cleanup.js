// functions/group-cleanup.js
// When a group membership is removed, delete the departed member's coarse
// location cell so it can't outlive membership (readable by remaining members).
// Pure handler: deps.set(path, value) injected for testability.
/**
 * @param {{ set: (path: string, value: unknown) => Promise<void> }} deps
 * @param {string} groupId
 * @param {string} memberUid
 * @param {unknown} beforeVal  member node before the write (null if absent)
 * @param {unknown} afterVal   member node after the write (null on delete)
 */
export async function handleMemberRemoved(deps, groupId, memberUid, beforeVal, afterVal) {
  // Only act on a genuine deletion: the member existed and is now gone.
  if (beforeVal == null || afterVal != null) return;
  await deps.set(`locationCells/${groupId}/${memberUid}`, null);
}
