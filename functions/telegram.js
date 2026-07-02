// functions/telegram.js — Telegram bot: notification keyboards + (Tasks 6–8)
// the webhook command/callback router. Deps are injected; no network here.

import { ensureTelegramUser } from './telegram-auth.js';
import { isFutureMs, effectiveAvailable } from './presence-core.js';

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

// Same shape + cap as the client's writeKnock transaction (js/db/social.js).
async function writeKnock(deps, recipientUid, senderUid) {
  await deps.transaction(`knocks/${recipientUid}/${senderUid}`, (current) => {
    if (current === null) return { count: 1, ts: deps.now() };
    if (current.count >= 5) return undefined; // abort — capped
    const next = { count: current.count + 1, ts: deps.now() };
    if (current.contextGroupId) next.contextGroupId = current.contextGroupId;
    return next;
  });
}

async function readFollowing(deps, uid) {
  const data = (await deps.getVal(`userPrefs/${uid}/following`)) || {};
  return Object.entries(data).map(([fid, v]) => ({ userId: fid, code: v?.code ?? '', label: v?.label ?? '' }));
}

async function handleSocialCommand(deps, uid, cmd, args, reply) {
  if (cmd === '/who') {
    const following = await readFollowing(deps, uid);
    const lines = [];
    for (const entry of following) {
      const presence = await deps.getVal(`users/${entry.userId}/presence`);
      if (presence?.status === 'available' && isFutureMs(presence.availableUntil, deps.now())) {
        lines.push(`🟢 ${entry.label || entry.code}`);
      }
    }
    await reply(lines.length ? `Available now:\n${lines.join('\n')}` : 'No one is available right now.');
    return;
  }
  if (cmd === '/knock') {
    const query = args.join(' ').trim().toLowerCase();
    if (!query) { await reply('Usage: /knock <name>'); return; }
    const following = await readFollowing(deps, uid);
    const matches = following.filter((e) => (e.label || e.code).toLowerCase().includes(query));
    if (matches.length === 0) { await reply(`Couldn't find "${args.join(' ')}" among the people you follow.`); return; }
    if (matches.length > 1) {
      await reply('Which one?', { reply_markup: { inline_keyboard: matches.slice(0, 8).map((e) => [{ text: e.label || e.code, callback_data: `knock:${e.userId}` }]) } });
      return;
    }
    await writeKnock(deps, matches[0].userId, uid);
    await reply(`Knocked on ${matches[0].label || matches[0].code}.`);
    return;
  }
  if (cmd === '/groups') {
    const groups = (await deps.getVal(`users/${uid}/groups`)) || {};
    const groupIds = Object.keys(groups);
    if (!groupIds.length) { await reply('No groups yet — create one in the app.'); return; }
    const presence = await deps.getVal(`users/${uid}/presence`);
    const lines = [];
    for (const gid of groupIds) {
      const name = (await deps.getVal(`groups/${gid}/name`)) || gid;
      const override = await deps.getVal(`groups/${gid}/members/${uid}/statusOverride`);
      const on = effectiveAvailable(override, presence?.status, presence?.availableUntil, deps.now());
      lines.push(`${name} — ${on ? 'available' : 'unavailable'} (you)`);
    }
    await reply(lines.join('\n'));
  }
}

const LABEL_MAX = 40;
const clampName = (s) => String(s ?? '').slice(0, LABEL_MAX).trim();

async function handleCallback(deps, cq) {
  if (!cq?.id || !cq.from) return;
  const answer = (text) => deps.tg.answerCallbackQuery(cq.id, text);
  const mapping = await deps.getVal(`telegramUsers/${String(cq.from.id)}`);
  if (!mapping) { await answer('Open KnockKnock first.'); return; }
  const me = mapping.uid;
  const [action, arg] = String(cq.data || '').split(':');
  switch (action) {
    case 'knock':
      await writeKnock(deps, arg, me);
      await answer('Knock sent.');
      return;
    case 'invite_accept':
    case 'invite_decline':
    case 'fr_approve':
    case 'fr_decline':
      await handleInboxCallback(deps, me, action, arg, cq, answer); // Task 8
      return;
    default:
      await answer('Unknown action.');
  }
}

async function handleInboxCallback(deps, me, action, arg, cq, answer) {
  // Implemented in Task 8.
  await answer('Not available yet.');
}
