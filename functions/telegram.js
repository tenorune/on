// functions/telegram.js — Telegram bot: notification keyboards + (Tasks 6–8)
// the webhook command/callback router. Deps are injected; no network here.

import { timingSafeEqual } from 'crypto';
import { ensureTelegramUser } from './telegram-auth.js';
import { WELCOME_STRANGER_TEXT, openAppKeyboard, GROUP_ID_RE, UID_RE } from './telegram-shared.js';
import { effectiveAvailable, primaryAvailable, clampName } from './presence-core.js';

// Required format of each callback action's arg, checked before dispatch.
// A malformed arg — or an unknown action — is refused without touching the DB.
const CALLBACK_ARG_RE = {
  knock: UID_RE,
  invite_accept: GROUP_ID_RE,
  invite_decline: GROUP_ID_RE,
  fr_approve: UID_RE,
  fr_decline: UID_RE,
};

// contextGroupId rides the callback so a knock-back lands as a group knock.
// 64-byte callback_data cap: 'knock:' + 32-hex uid + ':' + 8-char gid = 47.
const knockCallback = (data) =>
  data.contextGroupId ? `knock:${data.targetUid}:${data.contextGroupId}` : `knock:${data.targetUid}`;

// Inline keyboard for a notification, keyed by the same data.type the FCM
// payload carries. Simple reactions are callbacks handled by the webhook;
// answering a call needs the canvas, so it deep-links into the Mini App.
export function buildNotificationKeyboard(data, appUrl) {
  switch (data?.type) {
    case 'knock':
      return [[{ text: 'Knock back', callback_data: knockCallback(data) }]];
    case 'availability':
      return [[{ text: 'Knock', callback_data: knockCallback(data) }]];
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

// Format minutes as a human-readable duration: 30m or 2h (with decimals for >= 60m).
const fmtMinutes = (m) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);

const HELP_TEXT = [
  'KnockKnock commands:',
  '/status [group] [30m|2h] — go available (default 1h)',
  '/off [group] — go unavailable',
  '/who [group] — who\'s available now',
  '/knock <name> — send a knock (searches your people, then your groups)',
  '/groups — your groups',
  '/notifications push|telegram — where notifications go',
  '/help — this list',
].join('\n');

// The one way a webhook entry point resolves its Telegram sender to an app
// account: telegramUsers/{tgId} → { mapping, uid }. Both null/undefined-safe —
// callers decide how to bail when the sender isn't mapped.
async function resolveTelegramUid(deps, tgId) {
  const mapping = await deps.getVal(`telegramUsers/${String(tgId)}`);
  return { mapping, uid: mapping?.uid };
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
    // First-contact detection must precede ensureTelegramUser (which creates
    // the mapping). ensure stays: idempotent, and bot commands need the
    // account to exist even before the Mini App is ever opened.
    const { mapping: known } = await resolveTelegramUid(deps, msg.from.id);
    const { uid } = await ensureTelegramUser(deps, msg.from);
    // Keep the chat route current (first /start after a Mini-App-only signup,
    // or Telegram reassigning chat ids) — sendToUser reads telegramByUid.
    await deps.update(`telegramUsers/${String(msg.from.id)}`, { chatId });
    await deps.update(`telegramByUid/${uid}`, { chatId });
    if (!known) {
      // Stranger: funnel, no command list (spec §2). /help keeps the full list.
      await reply(WELCOME_STRANGER_TEXT, openAppKeyboard(deps.appUrl));
      return;
    }
    // Returning: compact live status, duration-based (no server-side timezone).
    const presence = await deps.getVal(`users/${uid}/presence`);
    const on = primaryAvailable(presence, deps.now());
    if (on) {
      const mins = Math.max(1, Math.round((presence.availableUntil - deps.now()) / 60000));
      await reply(`You're available for another ${fmtMinutes(mins)}. /off to stop.`, openAppKeyboard(deps.appUrl));
    } else {
      await reply("You're unavailable right now. /status to go available.", openAppKeyboard(deps.appUrl));
    }
    return;
  }

  const { uid } = await resolveTelegramUid(deps, msg.from.id);
  if (!uid) {
    await reply('First, open the app once so I know who you are:', openAppKeyboard(deps.appUrl));
    return;
  }

  switch (cmd) {
    case '/help':
      await reply(HELP_TEXT);
      return;
    case '/status': {
      const asDuration = args.length ? parseDurationMinutes(args.join(' ')) : 60;
      if (asDuration != null) {
        // Bare or pure-duration form — global presence, mirrors js/db/social.js setStatus.
        await deps.update(`users/${uid}/presence`, {
          status: 'available',
          availableUntil: deps.now() + asDuration * 60000,
          lastSeen: deps.now(),
        });
        await reply(`You're available for ${fmtMinutes(asDuration)}. /off to stop.`);
        return;
      }
      // Group form: a trailing duration token splits off; the rest names the group.
      const trailing = args.length > 1 ? parseDurationMinutes(args[args.length - 1]) : null;
      const minutes = trailing ?? 60;
      const query = (trailing != null ? args.slice(0, -1) : args).join(' ');
      await handleGroupStatus(deps, uid, query, minutes, reply);
      return;
    }
    case '/off': {
      if (args.length) { await handleGroupOff(deps, uid, args.join(' '), reply); return; }
      // Mirrors js/db/social.js writeBackExpired + a lastSeen touch.
      await deps.update(`users/${uid}/presence`, { status: 'unavailable', availableUntil: null, lastSeen: deps.now() });
      await reply("You're unavailable.");
      return;
    }
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

// Same shape + cap as the client's writeKnock transaction (js/db/social.js),
// including contextGroupId: set on create, overwrite on increment, else carry.
async function writeKnock(deps, recipientUid, senderUid, contextGroupId) {
  await deps.transaction(`knocks/${recipientUid}/${senderUid}`, (current) => {
    if (current === null) {
      const next = { count: 1, ts: deps.now() };
      if (contextGroupId) next.contextGroupId = contextGroupId;
      return next;
    }
    if (current.count >= 5) return undefined; // abort — capped
    const next = { count: current.count + 1, ts: deps.now() };
    if (contextGroupId) next.contextGroupId = contextGroupId;
    else if (current.contextGroupId) next.contextGroupId = current.contextGroupId;
    return next;
  });
}

async function readFollowing(deps, uid) {
  const data = (await deps.getVal(`userPrefs/${uid}/following`)) || {};
  return Object.entries(data).map(([fid, v]) => ({ userId: fid, code: v?.code ?? '', label: v?.label ?? '' }));
}

// Case-insensitive substring match over the user's own groups' names
// (spec 2026-07-07 naming decision — the /knock idiom applied to groups).
async function matchGroupsByName(deps, uid, query) {
  const groups = (await deps.getVal(`users/${uid}/groups`)) || {};
  const q = query.toLowerCase();
  const matches = [];
  for (const gid of Object.keys(groups)) {
    const name = (await deps.getVal(`groups/${gid}/name`)) || gid;
    if (name.toLowerCase().includes(q)) matches.push({ gid, name });
  }
  return matches;
}

// Shared arity guard for group-arg commands: replies and returns null unless
// exactly one group matches. No inline keyboard — /status//off carry extra
// args that don't fit a callback, so the retry is plain text for all three.
async function resolveGroupArg(deps, uid, query, reply) {
  const matches = await matchGroupsByName(deps, uid, query);
  if (matches.length === 0) { await reply(`No group matching "${query}".`); return null; }
  if (matches.length > 1) {
    await reply(`Which group? ${matches.map((m) => m.name).join(', ')} — give me more letters.`);
    return null;
  }
  return matches[0];
}

// /status <group> and /off <group> respect the app-side `enabled` choice
// (spec 2026-07-07): the bot never flips it. Override ON → merge status fields
// only (enabled/statusColor/paletteKey untouched — the client's
// mergeStatusOverride contract); override OFF → the group mirrors global
// presence, so the bot only explains. Fan-out for the ON write rides the
// onMemberOverride RTDB trigger — Admin-SDK writes fire it too.
async function handleGroupStatus(deps, uid, query, minutes, reply) {
  const match = await resolveGroupArg(deps, uid, query, reply);
  if (!match) return;
  const override = await deps.getVal(`groups/${match.gid}/members/${uid}/statusOverride`);
  if (override && override.enabled === true) {
    await deps.update(`groups/${match.gid}/members/${uid}/statusOverride`, {
      status: 'available',
      availableUntil: deps.now() + minutes * 60000,
    });
    await reply(`You're available in ${match.name} for ${fmtMinutes(minutes)}.`);
    return;
  }
  const presence = await deps.getVal(`users/${uid}/presence`);
  const globallyOn = primaryAvailable(presence, deps.now());
  await reply(globallyOn
    ? `${match.name} follows your global status — you're already available there.`
    : `${match.name} follows your global status. /status goes available everywhere, or turn on a group status in the app.`);
}

async function handleGroupOff(deps, uid, query, reply) {
  const match = await resolveGroupArg(deps, uid, query, reply);
  if (!match) return;
  const override = await deps.getVal(`groups/${match.gid}/members/${uid}/statusOverride`);
  if (override && override.enabled === true) {
    // null availableUntil deletes the key on RTDB — same shape the client's
    // setOverrideStatusUnavailable merge writes.
    await deps.update(`groups/${match.gid}/members/${uid}/statusOverride`, {
      status: 'unavailable',
      availableUntil: null,
    });
    await reply(`You're unavailable in ${match.name}.`);
    return;
  }
  const presence = await deps.getVal(`users/${uid}/presence`);
  const globallyOn = primaryAvailable(presence, deps.now());
  await reply(globallyOn
    ? `${match.name} follows your global status. /off goes unavailable everywhere, or turn on a group status in the app.`
    : `You're already unavailable in ${match.name}.`);
}

// /who <group>: co-members' effective in-group availability (the /groups idiom).
async function handleWhoGroup(deps, uid, query, reply) {
  const match = await resolveGroupArg(deps, uid, query, reply);
  if (!match) return;
  const members = (await deps.getVal(`groups/${match.gid}/members`)) || {};
  const lines = [];
  for (const [mid, m] of Object.entries(members)) {
    if (mid === uid) continue;
    const presence = await deps.getVal(`users/${mid}/presence`);
    if (effectiveAvailable(m?.statusOverride, presence?.status, presence?.availableUntil, deps.now())) {
      lines.push(`🟢 ${m?.displayName || 'Someone'}`);
    }
  }
  await reply(lines.length
    ? `Available in ${match.name}:\n${lines.join('\n')}`
    : `No one is available in ${match.name} right now.`);
}

// No Direct match — search shared-group rosters (spec 2026-07-07 §2): anyone
// visible in a group you're in is knockable, with that group as context.
async function knockGroupReach(deps, uid, query, rawQuery, reply) {
  const groups = (await deps.getVal(`users/${uid}/groups`)) || {};
  const found = [];
  for (const gid of Object.keys(groups)) {
    const [members, groupName] = await Promise.all([
      deps.getVal(`groups/${gid}/members`),
      deps.getVal(`groups/${gid}/name`),
    ]);
    for (const [mid, m] of Object.entries(members || {})) {
      if (mid === uid) continue;
      const name = m?.displayName || '';
      if (name.toLowerCase().includes(query)) found.push({ uid: mid, gid, name, groupName: groupName || gid });
    }
  }
  if (found.length === 0) {
    await reply(`Couldn't find "${rawQuery}" among the people you follow or your groups.`);
    return;
  }
  if (found.length > 1) {
    await reply('Which one?', { reply_markup: { inline_keyboard: found.slice(0, 8).map((e) => [{ text: `${e.name} (${e.groupName})`, callback_data: `knock:${e.uid}:${e.gid}` }]) } });
    return;
  }
  await writeKnock(deps, found[0].uid, uid, found[0].gid);
  await reply(`Knocked on ${found[0].name} (${found[0].groupName}).`);
}

async function handleSocialCommand(deps, uid, cmd, args, reply) {
  if (cmd === '/who') {
    const groupQuery = args.join(' ').trim();
    if (groupQuery) { await handleWhoGroup(deps, uid, groupQuery, reply); return; }
    const following = await readFollowing(deps, uid);
    const lines = [];
    for (const entry of following) {
      const presence = await deps.getVal(`users/${entry.userId}/presence`);
      if (primaryAvailable(presence, deps.now())) {
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
    if (matches.length === 0) { await knockGroupReach(deps, uid, query, args.join(' '), reply); return; }
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

async function handleCallback(deps, cq) {
  if (!cq?.id || !cq.from) return;
  const answer = (text) => deps.tg.answerCallbackQuery(cq.id, text);
  const { uid: me } = await resolveTelegramUid(deps, cq.from.id);
  if (!me) { await answer('Open KnockKnock first.'); return; }
  const [action, arg, arg2] = String(cq.data || '').split(':');
  const argRe = CALLBACK_ARG_RE[action];
  if (!argRe || !argRe.test(arg || '')) { await answer('Unknown action.'); return; }
  switch (action) {
    case 'knock':
      await writeKnock(deps, arg, me, GROUP_ID_RE.test(arg2 || '') ? arg2 : undefined);
      await answer('Knock sent.');
      return;
    case 'invite_accept':
    case 'invite_decline':
    case 'fr_approve':
    case 'fr_decline':
      await handleInboxCallback(deps, me, action, arg, cq, answer); // Task 8
      return;
    // No default: the CALLBACK_ARG_RE gate above already refused every action
    // not in the table, so each action reaching the switch has a case.
  }
}

async function handleInboxCallback(deps, me, action, arg, cq, answer) {
  if (action === 'invite_accept' || action === 'invite_decline') {
    const groupId = arg;
    const clearPending = () => Promise.all([
      deps.set(`pendingInvites/${me}/${groupId}`, null),
      deps.set(`pendingInvitesByGroup/${groupId}/${me}`, null),
    ]);
    if (action === 'invite_decline') { await clearPending(); await answer('Declined.'); return; }
    const pending = await deps.getVal(`pendingInvites/${me}/${groupId}`);
    if (!pending) { await answer('This invite is gone.'); return; }
    // Race checks mirror js/inbox.js handleJoin: already-member and deleted-group
    // both just clear the pending invite.
    const [existing, name] = await Promise.all([
      deps.getVal(`groups/${groupId}/members/${me}`),
      deps.getVal(`groups/${groupId}/name`),
    ]);
    if (existing) { await clearPending(); await answer("You're already in that group."); return; }
    if (!name) { await clearPending(); await answer('That group no longer exists.'); return; }
    // Join mirrors js/groups.js joinGroup (fresh membership branch): the display
    // name is the Telegram first name (the bot has no prompt UI); editable later
    // in the app.
    const now = deps.now();
    await deps.set(`groups/${groupId}/members/${me}`, {
      role: 'member',
      displayName: clampName(cq.from.first_name) || 'Someone',
      joinedAt: now,
      statusOverride: { enabled: true, status: 'available', availableUntil: now + 2 * 60 * 60 * 1000 },
    });
    await deps.set(`users/${me}/groups/${groupId}`, { lastVisited: now });
    await clearPending();
    await answer(`Joined ${name}.`);
    return;
  }
  if (action === 'fr_approve' || action === 'fr_decline') {
    const requesterUid = arg;
    if (action === 'fr_decline') {
      await deps.set(`followRequests/${me}/${requesterUid}`, null);
      await answer('Declined.');
      return;
    }
    const request = await deps.getVal(`followRequests/${me}/${requesterUid}`);
    if (!request) { await answer('This request is gone.'); return; }
    // Mirrors js/inbox.js handleApprove: grant carries my share code + my display
    // name in the shared group; the requester's grant-watcher completes the follow.
    const [presence, myName] = await Promise.all([
      deps.getVal(`users/${me}/presence`),
      request.groupId ? deps.getVal(`groups/${request.groupId}/members/${me}/displayName`) : Promise.resolve(null),
    ]);
    await deps.set(`followGrants/${requesterUid}/${me}`, {
      from: me, code: presence?.code || '', name: myName ?? null, ts: deps.now(),
    });
    await deps.set(`followRequests/${me}/${requesterUid}`, null);
    await answer('Approved.');
  }
}

// Constant-shape check of Telegram's X-Telegram-Bot-Api-Secret-Token header.
// An unset secret refuses everything — the webhook is dead until configured.
export function webhookAuthorized(headerValue, secret) {
  if (!secret || typeof headerValue !== 'string') return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
