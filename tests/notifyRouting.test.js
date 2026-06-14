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
  routeNotificationClick({ type: 'knock', targetUid: 'bea', contextGroupId: 'ABCD1234' }, d);
  expect(d.navigateToGroup).toHaveBeenCalledWith('ABCD1234');
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

test('a malformed contextGroupId is rejected — never navigated to; falls back to Direct (#164 R3c)', () => {
  for (const bad of ['fam', 'abcd1234', "x';alert(1)//", 'TOOLONG12345', '../../etc']) {
    const d = deps();
    routeNotificationClick({ type: 'knock', targetUid: 'bea', contextGroupId: bad }, d);
    expect(d.navigateToGroup).not.toHaveBeenCalled(); // forged/garbage id never reaches navigation
    expect(d.navigateToDirect).toHaveBeenCalled();    // knock with no *valid* group → Direct
  }
});
