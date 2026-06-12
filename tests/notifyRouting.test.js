// tests/notifyRouting.test.js
const { routeNotificationClick } = require('../js/notifyRouting.js');

function deps() {
  return {
    navigateToDirect: jest.fn(),
    navigateToGroup: jest.fn(),
    openInboxModal: jest.fn(),
  };
}

test('invite: lands in Direct, then opens the Inbox (so closing returns to Direct)', () => {
  const d = deps();
  routeNotificationClick({ type: 'invite', targetUid: 'bea' }, d);
  expect(d.navigateToDirect).toHaveBeenCalled();
  expect(d.openInboxModal).toHaveBeenCalled();
  expect(d.navigateToGroup).not.toHaveBeenCalled();
});

test('followRequest: lands in Direct, then opens the Inbox', () => {
  const d = deps();
  routeNotificationClick({ type: 'followRequest', targetUid: 'bea' }, d);
  expect(d.navigateToDirect).toHaveBeenCalled();
  expect(d.openInboxModal).toHaveBeenCalled();
  expect(d.navigateToGroup).not.toHaveBeenCalled();
});

test('navigates to Direct BEFORE opening the Inbox', () => {
  const order = [];
  routeNotificationClick({ type: 'invite' }, {
    navigateToDirect: () => order.push('direct'),
    navigateToGroup: jest.fn(),
    openInboxModal: () => order.push('inbox'),
  });
  expect(order).toEqual(['direct', 'inbox']);
});

test('group activity: navigates into the group, no Inbox, no Direct', () => {
  const d = deps();
  routeNotificationClick({ type: 'knock', targetUid: 'bea', contextGroupId: 'fam' }, d);
  expect(d.navigateToGroup).toHaveBeenCalledWith('fam');
  expect(d.openInboxModal).not.toHaveBeenCalled();
  expect(d.navigateToDirect).not.toHaveBeenCalled();
});

test('Direct activity (knock/call/availability, no contextGroupId): returns to Direct', () => {
  for (const type of ['knock', 'call', 'availability']) {
    const d = deps();
    routeNotificationClick({ type, targetUid: 'bea' }, d);
    expect(d.navigateToDirect).toHaveBeenCalled();
    expect(d.navigateToGroup).not.toHaveBeenCalled();
    expect(d.openInboxModal).not.toHaveBeenCalled();
  }
});

test('tolerates empty/missing data (unknown type → no navigation)', () => {
  const d = deps();
  expect(() => routeNotificationClick({}, d)).not.toThrow();
  expect(d.navigateToGroup).not.toHaveBeenCalled();
  expect(d.openInboxModal).not.toHaveBeenCalled();
  expect(d.navigateToDirect).not.toHaveBeenCalled();
});
