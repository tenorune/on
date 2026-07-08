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

const KNOCK_CAP_TEXT = "You've already knocked a few times — give them a moment.";

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
    // account to exist even before the Mini App is ever opened. The mapping
    // is passed through (and presence comes back) so nothing is read twice.
    const { mapping: known } = await resolveTelegramUid(deps, msg.from.id);
    const { uid, presence } = await ensureTelegramUser(deps, msg.from, known);
    // Keep the chat route current (first /start after a Mini-App-only signup,
    // or Telegram reassigning chat ids) — sendToUser reads telegramByUid.
    // Both sides of the route in one multi-path write.
    await deps.update('/', {
      [`telegramUsers/${String(msg.from.id)}/chatId`]: chatId,
      [`telegramByUid/${uid}/chatId`]: chatId,
    });
    if (!known) {
      // Stranger: funnel, no command list (spec §2). /help keeps the full list.
      await reply(WELCOME_STRANGER_TEXT, openAppKeyboard(deps.appUrl));
      return;
    }
    // Returning: compact live status, duration-based (no server-side timezone).
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
      if (choice === 'push') {
        // W1 J#3 (mirrors the app's channel pill): don't write a push channel
        // this account can't receive on — the notifier's token-less fallback
        // would mask it, but the shown state would lie.
        const tokensMap = await deps.getVal(`userPrefs/${uid}/pushTokens`);
        if (!tokensMap || Object.keys(tokensMap).length === 0) {
          await reply("Push isn't set up on any device yet — open KnockKnock in a browser first. You'll keep getting messages here.");
          return;
        }
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
// Returns whether the transaction committed — an aborted (capped) knock must
// not be confirmed as sent (W1 B#2).
async function writeKnock(deps, recipientUid, senderUid, contextGroupId) {
  const res = await deps.transaction(`knocks/${recipientUid}/${senderUid}`, (current) => {
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
  return res.committed;
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
  const named = await Promise.all(Object.keys(groups).map(async (gid) => ({
    gid,
    name: (await deps.getVal(`groups/${gid}/name`)) || gid,
  })));
  return named.filter((m) => m.name.toLowerCase().includes(q));
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
// (spec 2026-07-07): the bot never flips it. Override ON → merge the given
// status fields only (enabled/statusColor/paletteKey untouched — the client's
// mergeStatusOverride contract); override OFF → the group mirrors global
// presence, so the bot only explains (globalOn/globalOff). Fan-out for the ON
// write rides the onMemberOverride RTDB trigger — Admin-SDK writes fire it too.
// Presence is prefetched beside the override even though only the OFF branch
// needs it — one wasted read on the ON path buys a round-trip of latency.
// `fields` is a thunk evaluated at write time so availableUntil is stamped
// from now() AFTER the reads, exactly as the pre-merge handlers did.
async function setGroupPresence(deps, uid, query, reply, fields, messages) {
  const match = await resolveGroupArg(deps, uid, query, reply);
  if (!match) return;
  const [override, presence] = await Promise.all([
    deps.getVal(`groups/${match.gid}/members/${uid}/statusOverride`),
    deps.getVal(`users/${uid}/presence`),
  ]);
  if (override && override.enabled === true) {
    await deps.update(`groups/${match.gid}/members/${uid}/statusOverride`, fields());
    await reply(messages.confirm(match.name));
    return;
  }
  const globallyOn = primaryAvailable(presence, deps.now());
  await reply((globallyOn ? messages.globalOn : messages.globalOff)(match.name));
}

async function handleGroupStatus(deps, uid, query, minutes, reply) {
  await setGroupPresence(deps, uid, query, reply,
    () => ({ status: 'available', availableUntil: deps.now() + minutes * 60000 }),
    {
      confirm: (name) => `You're available in ${name} for ${fmtMinutes(minutes)}.`,
      globalOn: (name) => `${name} follows your global status — you're already available there.`,
      globalOff: (name) => `${name} follows your global status. /status goes available everywhere, or turn on a group status in the app.`,
    });
}

async function handleGroupOff(deps, uid, query, reply) {
  await setGroupPresence(deps, uid, query, reply,
    // null availableUntil deletes the key on RTDB — same shape the client's
    // setOverrideStatusUnavailable merge writes.
    () => ({ status: 'unavailable', availableUntil: null }),
    {
      confirm: (name) => `You're unavailable in ${name}.`,
      globalOn: (name) => `${name} follows your global status. /off goes unavailable everywhere, or turn on a group status in the app.`,
      globalOff: (name) => `You're already unavailable in ${name}.`,
    });
}

// /who <group>: co-members' effective in-group availability (the /groups idiom).
async function handleWhoGroup(deps, uid, query, reply) {
  const match = await resolveGroupArg(deps, uid, query, reply);
  if (!match) return;
  const members = (await deps.getVal(`groups/${match.gid}/members`)) || {};
  const coMembers = Object.entries(members).filter(([mid]) => mid !== uid);
  const lines = (await Promise.all(coMembers.map(async ([mid, m]) => {
    const presence = await deps.getVal(`users/${mid}/presence`);
    return effectiveAvailable(m?.statusOverride, presence?.status, presence?.availableUntil, deps.now())
      ? `🟢 ${m?.displayName || 'Someone'}`
      : null;
  }))).filter(Boolean);
  await reply(lines.length
    ? `Available in ${match.name}:\n${lines.join('\n')}`
    : `No one is available in ${match.name} right now.`);
}

// No Direct match — search shared-group rosters (spec 2026-07-07 §2): anyone
// visible in a group you're in is knockable, with that group as context.
async function knockGroupReach(deps, uid, query, rawQuery, reply) {
  const groups = (await deps.getVal(`users/${uid}/groups`)) || {};
  const perGroup = await Promise.all(Object.keys(groups).map(async (gid) => {
    const [members, groupName] = await Promise.all([
      deps.getVal(`groups/${gid}/members`),
      deps.getVal(`groups/${gid}/name`),
    ]);
    const matches = [];
    for (const [mid, m] of Object.entries(members || {})) {
      if (mid === uid) continue;
      const name = m?.displayName || '';
      if (name.toLowerCase().includes(query)) matches.push({ uid: mid, gid, name, groupName: groupName || gid });
    }
    return matches;
  }));
  const found = perGroup.flat();
  if (found.length === 0) {
    await reply(`Couldn't find "${rawQuery}" among the people you follow or your groups.`);
    return;
  }
  if (found.length > 1) {
    await reply('Which one?', { reply_markup: { inline_keyboard: found.slice(0, 8).map((e) => [{ text: `${e.name} (${e.groupName})`, callback_data: `knock:${e.uid}:${e.gid}` }]) } });
    return;
  }
  const committed = await writeKnock(deps, found[0].uid, uid, found[0].gid);
  await reply(committed ? `Knocked on ${found[0].name} (${found[0].groupName}).` : KNOCK_CAP_TEXT);
}

async function handleSocialCommand(deps, uid, cmd, args, reply) {
  if (cmd === '/who') {
    const groupQuery = args.join(' ').trim();
    if (groupQuery) { await handleWhoGroup(deps, uid, groupQuery, reply); return; }
    const following = await readFollowing(deps, uid);
    const lines = (await Promise.all(following.map(async (entry) => {
      const presence = await deps.getVal(`users/${entry.userId}/presence`);
      return primaryAvailable(presence, deps.now()) ? `🟢 ${entry.label || entry.code}` : null;
    }))).filter(Boolean);
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
    const committed = await writeKnock(deps, matches[0].userId, uid);
    await reply(committed ? `Knocked on ${matches[0].label || matches[0].code}.` : KNOCK_CAP_TEXT);
    return;
  }
  if (cmd === '/groups') {
    const groups = (await deps.getVal(`users/${uid}/groups`)) || {};
    const groupIds = Object.keys(groups);
    if (!groupIds.length) { await reply('No groups yet — create one in the app.'); return; }
    const presence = await deps.getVal(`users/${uid}/presence`);
    const lines = await Promise.all(groupIds.map(async (gid) => {
      const [name, override] = await Promise.all([
        deps.getVal(`groups/${gid}/name`),
        deps.getVal(`groups/${gid}/members/${uid}/statusOverride`),
      ]);
      const on = effectiveAvailable(override, presence?.status, presence?.availableUntil, deps.now());
      return `${name || gid} — ${on ? 'available' : 'unavailable'} (you)`;
    }));
    await reply(lines.join('\n'));
  }
}

// Rewrite a callback's source notification message to record its resolved
// outcome, and drop the inline keyboard (editMessageText with no reply_markup
// removes it) so stale buttons can't be tapped (W1 B#1/B#9). The original text
// is kept for context; the outcome is appended. Every failure is swallowed:
// the action itself already succeeded and the answerCallbackQuery toast fired —
// a >48h edit window, a user-deleted message, or a double-tap race must never
// fail the action.
export async function resolveSourceMessage(deps, cq, outcome) {
  const msg = cq?.message;
  if (!msg?.message_id || !msg.chat?.id || !deps.tg.editMessageText) return;
  const text = msg.text ? `${msg.text}\n\n${outcome}` : outcome;
  try { await deps.tg.editMessageText(String(msg.chat.id), msg.message_id, text); }
  catch { /* cosmetic — see above */ }
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
    case 'knock': {
      const committed = await writeKnock(deps, arg, me, GROUP_ID_RE.test(arg2 || '') ? arg2 : undefined);
      await answer(committed ? 'Knock sent.' : KNOCK_CAP_TEXT);
      return;
    }
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
    // Both sides of the pending-invite record clear in one atomic update (W2).
    const pendingNulls = {
      [`pendingInvites/${me}/${groupId}`]: null,
      [`pendingInvitesByGroup/${groupId}/${me}`]: null,
    };
    const clearPending = () => deps.update('/', pendingNulls);
    // State FIRST (W1 B#1): a button on an old message answers from the current
    // state — decline-after-accept must not say "Declined." while membership stands.
    const [pending, existing, name] = await Promise.all([
      deps.getVal(`pendingInvites/${me}/${groupId}`),
      deps.getVal(`groups/${groupId}/members/${me}`),
      deps.getVal(`groups/${groupId}/name`),
    ]);
    if (existing) {
      await clearPending();
      await resolveSourceMessage(deps, cq, `✅ Joined ${name || 'the group'}.`);
      await answer(action === 'invite_accept'
        ? "You're already in that group."
        : 'Already handled — you joined this group.');
      return;
    }
    if (!pending) {
      await resolveSourceMessage(deps, cq, 'Already handled.');
      await answer('Already handled.');
      return;
    }
    if (action === 'invite_decline') {
      await clearPending();
      await resolveSourceMessage(deps, cq, 'Invite declined.');
      await answer('Declined.');
      return;
    }
    if (!name) {
      await clearPending();
      await resolveSourceMessage(deps, cq, 'That group no longer exists.');
      await answer('That group no longer exists.');
      return;
    }
    // Join mirrors js/groups.js joinGroup (fresh membership branch): the display
    // name is the Telegram first name (the bot has no prompt UI); editable later
    // in the app. Membership, nav entry, and the pending cleanup land as ONE
    // atomic update — a crash can't leave a member with the invite still pending.
    const now = deps.now();
    await deps.update('/', {
      [`groups/${groupId}/members/${me}`]: {
        role: 'member',
        displayName: clampName(cq.from.first_name) || 'Someone',
        joinedAt: now,
        statusOverride: { enabled: true, status: 'available', availableUntil: now + 2 * 60 * 60 * 1000 },
      },
      [`users/${me}/groups/${groupId}`]: { lastVisited: now },
      ...pendingNulls,
    });
    await resolveSourceMessage(deps, cq, `✅ Joined ${name}.`);
    await answer(`Joined ${name}.`);
    return;
  }
  if (action === 'fr_approve' || action === 'fr_decline') {
    const requesterUid = arg;
    // State FIRST (W1 B#1): an existing grant means this was already approved
    // (here or in the app) — a late Decline must not claim otherwise.
    const [request, grant] = await Promise.all([
      deps.getVal(`followRequests/${me}/${requesterUid}`),
      deps.getVal(`followGrants/${requesterUid}/${me}`),
    ]);
    if (grant) {
      await deps.set(`followRequests/${me}/${requesterUid}`, null);
      await resolveSourceMessage(deps, cq, '✅ Approved.');
      await answer('Already approved.');
      return;
    }
    if (!request) {
      await resolveSourceMessage(deps, cq, 'This request is gone.');
      await answer('This request is gone.');
      return;
    }
    if (action === 'fr_decline') {
      await deps.set(`followRequests/${me}/${requesterUid}`, null);
      await resolveSourceMessage(deps, cq, 'Declined.');
      await answer('Declined.');
      return;
    }
    // Mirrors js/inbox.js handleApprove: grant carries my share code + my display
    // name in the shared group; the requester's grant-watcher completes the follow.
    const [presence, myName] = await Promise.all([
      deps.getVal(`users/${me}/presence`),
      request.groupId ? deps.getVal(`groups/${request.groupId}/members/${me}/displayName`) : Promise.resolve(null),
    ]);
    // Grant write + request delete in one atomic update — a crash between
    // them would otherwise leave the grant written with the request still
    // pending, so the target could approve the same request twice (sibling
    // of the invite-accept atomicity above).
    await deps.update('/', {
      [`followGrants/${requesterUid}/${me}`]: {
        from: me, code: presence?.code || '', name: myName ?? null, ts: deps.now(),
      },
      [`followRequests/${me}/${requesterUid}`]: null,
    });
    await resolveSourceMessage(deps, cq, '✅ Approved.');
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
