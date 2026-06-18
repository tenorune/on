import { jest } from '@jest/globals';
import { resolveInvitePreviewHandler } from '../invites.js';

describe('resolveInvitePreviewHandler', () => {
  const mkReq = (data) => ({ data });
  const mkDeps = (map) => ({ getVal: jest.fn((path) => Promise.resolve(map[path] ?? null)) });

  test('personal invite → scope + label', async () => {
    const deps = mkDeps({
      'inviteIndex/T': { scope: 'personal', ownerPath: 'users/U/invites/T' },
      'users/U/invites/T': { creatorLabel: 'Alex K.', revoked: false },
    });
    expect(await resolveInvitePreviewHandler(mkReq({ token: 'T' }), deps))
      .toEqual({ preview: { scope: 'personal', label: 'Alex K.' } });
  });

  test('personal invite without a label → label null', async () => {
    const deps = mkDeps({
      'inviteIndex/T': { scope: 'personal', ownerPath: 'users/U/invites/T' },
      'users/U/invites/T': { revoked: false },
    });
    expect(await resolveInvitePreviewHandler(mkReq({ token: 'T' }), deps))
      .toEqual({ preview: { scope: 'personal', label: null } });
  });

  test('group invite → scope + groupName + groupId', async () => {
    const deps = mkDeps({
      'inviteIndex/T': { scope: 'group', ownerPath: 'groups/G1/invites/T' },
      'groups/G1/name': 'Family',
      'groups/G1/invites/T': { revoked: false },
    });
    expect(await resolveInvitePreviewHandler(mkReq({ token: 'T' }), deps))
      .toEqual({ preview: { scope: 'group', groupName: 'Family', groupId: 'G1' } });
  });

  test('revoked personal invite → null preview', async () => {
    const deps = mkDeps({
      'inviteIndex/T': { scope: 'personal', ownerPath: 'users/U/invites/T' },
      'users/U/invites/T': { creatorLabel: 'Alex K.', revoked: true },
    });
    expect(await resolveInvitePreviewHandler(mkReq({ token: 'T' }), deps))
      .toEqual({ preview: null });
  });

  test('revoked group invite → null preview', async () => {
    const deps = mkDeps({
      'inviteIndex/T': { scope: 'group', ownerPath: 'groups/G1/invites/T' },
      'groups/G1/name': 'Family',
      'groups/G1/invites/T': { revoked: true },
    });
    expect(await resolveInvitePreviewHandler(mkReq({ token: 'T' }), deps))
      .toEqual({ preview: null });
  });

  test('unknown token → null preview', async () => {
    const deps = mkDeps({});
    expect(await resolveInvitePreviewHandler(mkReq({ token: 'NOPE' }), deps))
      .toEqual({ preview: null });
  });

  test('group exists in index but its name node is gone → null preview', async () => {
    const deps = mkDeps({
      'inviteIndex/T': { scope: 'group', ownerPath: 'groups/G1/invites/T' },
      'groups/G1/invites/T': { revoked: false },
      // no groups/G1/name
    });
    expect(await resolveInvitePreviewHandler(mkReq({ token: 'T' }), deps))
      .toEqual({ preview: null });
  });

  test('malformed token → invalid-argument, no reads', async () => {
    const deps = mkDeps({});
    await expect(resolveInvitePreviewHandler(mkReq({ token: 'bad token!' }), deps))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.getVal).not.toHaveBeenCalled();
  });

  test('DB read failure → null preview (framing is non-critical)', async () => {
    const deps = { getVal: jest.fn().mockRejectedValue(new Error('boom')) };
    expect(await resolveInvitePreviewHandler(mkReq({ token: 'T' }), deps))
      .toEqual({ preview: null });
  });
});
