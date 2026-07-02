// functions/telegram.js — Telegram bot: notification keyboards + (Tasks 6–8)
// the webhook command/callback router. Deps are injected; no network here.

import { ensureTelegramUser } from './telegram-auth.js';

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

// "30m", "2h", "1h30m", "90", "45 min" → minutes, clamped to 5..1440. null when unparseable.
export function parseDurationMinutes(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const clamp = (m) => Math.max(5, Math.min(1440, m));
  if (/^\d+$/.test(s)) return clamp(parseInt(s, 10));
  const m = s.match(/^(?:(\d+)\s*h(?:rs?)?)?\s*(?:(\d+)\s*m(?:in)?s?)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return clamp(parseInt(m[1] || '0', 10) * 60 + parseInt(m[2] || '0', 10));
}

const HELP_TEXT = [
  'KnockKnock commands:',
  '/status [30m|2h] — go available (default 1h)',
  '/off — go unavailable',
  '/who — which of your people are available now',
  '/knock <name> — send a knock',
  '/groups — your groups',
  '/notifications push|telegram — where notifications go',
  '/help — this list',
].join('\n');

function openAppKeyboard(appUrl) {
  return appUrl ? { reply_markup: { inline_keyboard: [[{ text: 'Open KnockKnock', web_app: { url: appUrl } }]] } } : {};
}

// Entry point for every webhook update. Never throws (the webhook must always 200).
export async function handleUpdate(deps, update) {
  try {
    if (update?.message) await handleMessage(deps, update.message);
    else if (update?.callback_query) await handleCallback(deps, update.callback_query);
  } catch (e) {
    console.error('[telegram] handleUpdate error:', e);
  }
}

async function handleMessage(deps, msg) {
  if (msg.chat?.type !== 'private' || typeof msg.text !== 'string' || !msg.from) return;
  const chatId = String(msg.chat.id);
  const [cmdRaw, ...args] = msg.text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, ''); // strip @botname suffix
  const reply = (text, extra = {}) => deps.tg.sendMessage(chatId, text, extra);

  if (cmd === '/start') {
    const { uid } = await ensureTelegramUser(deps, msg.from);
    // Keep the chat route current (first /start after a Mini-App-only signup,
    // or Telegram reassigning chat ids) — sendToUser reads telegramByUid.
    await deps.update(`telegramUsers/${String(msg.from.id)}`, { chatId });
    await deps.update(`telegramByUid/${uid}`, { chatId });
    await reply(
      'Welcome to KnockKnock — let the people who matter know when you\'re free.\n\n'
      + `${HELP_TEXT}\n\nThe full app (calls, drawing, palettes, groups) lives in the Mini App:`,
      openAppKeyboard(deps.appUrl),
    );
    return;
  }

  const mapping = await deps.getVal(`telegramUsers/${String(msg.from.id)}`);
  if (!mapping) {
    await reply('First, open the app once so I know who you are:', openAppKeyboard(deps.appUrl));
    return;
  }
  const uid = mapping.uid;

  switch (cmd) {
    case '/help':
      await reply(HELP_TEXT);
      return;
    case '/status': {
      const minutes = args.length ? parseDurationMinutes(args.join(' ')) : 60;
      if (minutes == null) {
        await reply('Give me a duration like "/status 30m" or "/status 2h".');
        return;
      }
      // Mirrors js/db/social.js setStatus exactly.
      await deps.update(`users/${uid}/presence`, {
        status: 'available',
        availableUntil: deps.now() + minutes * 60000,
        lastSeen: deps.now(),
      });
      await reply(`You're available for ${minutes >= 60 ? `${Math.round(minutes / 60 * 10) / 10}h` : `${minutes}m`}. /off to stop.`);
      return;
    }
    case '/off':
      // Mirrors js/db/social.js writeBackExpired + a lastSeen touch.
      await deps.update(`users/${uid}/presence`, { status: 'unavailable', availableUntil: null, lastSeen: deps.now() });
      await reply("You're unavailable.");
      return;
    case '/notifications': {
      const choice = (args[0] || '').toLowerCase();
      if (choice !== 'push' && choice !== 'telegram') {
        await reply('Use "/notifications telegram" or "/notifications push".');
        return;
      }
      await deps.update(`userPrefs/${uid}`, { notifyChannel: choice });
      await reply(choice === 'telegram' ? 'Notifications will arrive here.' : 'Notifications will use the app\'s push channel.');
      return;
    }
    case '/who':
    case '/knock':
    case '/groups':
      await handleSocialCommand(deps, uid, cmd, args, reply); // Task 7
      return;
    default:
      await reply(`I don't know that one.\n\n${HELP_TEXT}`);
  }
}

async function handleCallback(deps, cq) {
  // Implemented in Tasks 7–8.
  if (cq?.id) await deps.tg.answerCallbackQuery(cq.id, 'Not available yet.');
}

async function handleSocialCommand(deps, uid, cmd, args, reply) {
  // Implemented in Task 7.
  await reply('Not available yet.');
}
