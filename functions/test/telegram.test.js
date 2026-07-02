import { buildNotificationKeyboard } from '../telegram.js';

const APP = 'https://app.example.com';

describe('buildNotificationKeyboard', () => {
  test('knock → Knock back callback', () => {
    expect(buildNotificationKeyboard({ type: 'knock', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Knock back', callback_data: 'knock:u9' }]]);
  });
  test('availability → Knock callback', () => {
    expect(buildNotificationKeyboard({ type: 'availability', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Knock', callback_data: 'knock:u9' }]]);
  });
  test('call → web_app deep link', () => {
    expect(buildNotificationKeyboard({ type: 'call', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Answer in KnockKnock', web_app: { url: APP } }]]);
  });
  test('call with no app url → null (plain text message)', () => {
    expect(buildNotificationKeyboard({ type: 'call', targetUid: 'u9' }, '')).toBeNull();
  });
  test('invite → accept/decline', () => {
    expect(buildNotificationKeyboard({ type: 'invite', targetUid: 'u9', groupId: 'G1' }, APP))
      .toEqual([[
        { text: 'Accept', callback_data: 'invite_accept:G1' },
        { text: 'Decline', callback_data: 'invite_decline:G1' },
      ]]);
  });
  test('followRequest → approve/decline', () => {
    expect(buildNotificationKeyboard({ type: 'followRequest', targetUid: 'u9' }, APP))
      .toEqual([[
        { text: 'Approve', callback_data: 'fr_approve:u9' },
        { text: 'Decline', callback_data: 'fr_decline:u9' },
      ]]);
  });
  test('unknown type → null', () => {
    expect(buildNotificationKeyboard({ type: 'mystery' }, APP)).toBeNull();
  });
});
