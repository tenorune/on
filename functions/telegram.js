// functions/telegram.js — Telegram bot: notification keyboards + (Tasks 6–8)
// the webhook command/callback router. Deps are injected; no network here.

// Inline keyboard for a notification, keyed by the same data.type the FCM
// payload carries. Simple reactions are callbacks handled by the webhook;
// answering a call needs the canvas, so it deep-links into the Mini App.
export function buildNotificationKeyboard(data, appUrl) {
  switch (data?.type) {
    case 'knock':
      return [[{ text: 'Knock back', callback_data: `knock:${data.targetUid}` }]];
    case 'availability':
      return [[{ text: 'Knock', callback_data: `knock:${data.targetUid}` }]];
    case 'call':
      return appUrl ? [[{ text: 'Answer in KnockKnock', web_app: { url: appUrl } }]] : null;
    case 'invite':
      return [[
        { text: 'Accept', callback_data: `invite_accept:${data.groupId}` },
        { text: 'Decline', callback_data: `invite_decline:${data.groupId}` },
      ]];
    case 'followRequest':
      return [[
        { text: 'Approve', callback_data: `fr_approve:${data.targetUid}` },
        { text: 'Decline', callback_data: `fr_decline:${data.targetUid}` },
      ]];
    default:
      return null;
  }
}
