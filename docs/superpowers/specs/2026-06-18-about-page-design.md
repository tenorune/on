# /about page — design

**Date:** 2026-06-18
**Status:** approved-pending-review
**Topic:** A friendly, non-technical public intro page at `/about`, with a high-level privacy model in the body and a detailed privacy section at the bottom.

## Goal

A warm, approachable introduction to KnockKnock — much friendlier than `README.md`, with the engineering/technical detail excluded from the main flow. It reaches non-users (no auth, no app bundle), explains what the app is and what you can do, gives the privacy model at a glance, and offers a fuller privacy section at the bottom. The page **re-themes exactly like the app** for returning users.

Tone: **warm and clear, with a light nod** to the "small, experimental space that rewards curiosity" spirit of the README's Author's Note. Explain features plainly but leave a little room for discovery.

## Form & routing

- **Standalone static page**, independent of the app's JS bundle and Firebase init. No ES modules, no auth, no `getDatabase()` — so it loads even when the app couldn't (e.g. missing Firebase env) and is visible to people who aren't users yet.
- Served at a clean **`/about`** via a Firebase Hosting rewrite: add `{ "source": "/about", "destination": "/about.html" }` to `firebase.json` `rewrites`, ordered **before** the existing `{ "source": "**", "destination": "/index.html" }` catch-all. Firebase serves real static files before rewrites, so `about.html` is reachable directly too.
- **Standalone-only** for now: nothing in the app links *to* `/about`. The page itself links *out* — "Open KnockKnock →" (to `/`) and the GitHub repo — both `target="_blank" rel="noopener"`.

## Files

| File | Disposition | Purpose |
|---|---|---|
| `about.template.html` | committed | Source of the page; build substitutes placeholders. |
| `about.html` | **gitignored** (build output, like `index.html`) | Served by hosting. |
| `css/about.css` | committed | Page styling; echoes the app's design tokens. |
| `firebase.json` | edited | `/about` rewrite before the `**` catch-all. |
| `scripts/build.js` | edited | Build `about.html` from `about.template.html` with placeholder substitution. |
| `tests/about-page.test.js` | new | Locks the routing/content contract. |
| `.gitignore` | edited | Add `about.html`. |
| `.env.local` / `.env.production` | local only (gitignored) | New build-time vars (below). |

The hosting `ignore` list in `firebase.json` does not exclude root `*.html` or `css/**`, so `about.html` and `css/about.css` are deployed as-is.

## Build-time substitution (env vars)

`build.js` is a module: it exports `writeIndexHtml()` (substitutes `__APP_TITLE__` into `index.template.html`, with an `escapeHtml` helper) and is driven by the entry scripts `scripts/dev.js`, `scripts/dev-build.js`, and `scripts/prod.js`. The implementation adds a sibling `writeAboutHtml()` (reusing `escapeHtml` and the same `env`/`process.env` lookup pattern) and wires a call into each of those three entry scripts so every build path emits `about.html`. It produces `about.html` from `about.template.html`, substituting:

| Placeholder | Env var | Fallback when unset |
|---|---|---|
| `__APP_TITLE__` | `APP_TITLE` (existing) | existing behavior |
| `__ABOUT_AUTHOR__` | `ABOUT_AUTHOR` | author attribution line/footer note is **omitted entirely** (no `REPLACE_ME`) |
| `__DATA_REGION__` | `DATA_REGION` | a generic phrase ("a Google Cloud region") |

```
# .env.local and .env.production (both gitignored)
ABOUT_AUTHOR="Author display name"   # appears on /about only; never committed
DATA_REGION="europe-west1"           # human-readable RTDB region named in privacy detail
```

The author's name is therefore present only in the built `about.html`, never in the repository. Substitution degrades gracefully: an unset `ABOUT_AUTHOR` removes the attribution rather than emitting placeholder text, so the page is never broken by a missing optional value.

## Theming (re-themes like the app)

- `css/about.css` defines the **default slate tokens** on `:root` (`--bg #0f172a`, `--surface #1e293b`, `--surface2 #334155`, `--text #f1f5f9`, `--text-muted #94a3b8`, `--accent #6366f1`, plus a green availability accent `#22c55e`). The whole page is styled with `var(--…)` references.
- `about.template.html`'s `<head>` includes the **byte-identical** inline theme-bootstrap script already used by `index.template.html`:
  ```html
  <script>try{var t=JSON.parse(localStorage.getItem('statusapp_theme')||'null');if(t){var r=document.documentElement;r.style.setProperty('--bg',t.bg);r.style.setProperty('--surface',t.surface);r.style.setProperty('--surface2',t.surface2);r.style.setProperty('--text',t.text);r.style.setProperty('--text-muted',t.textMuted);r.style.setProperty('--accent',t.accent);r.style.setProperty('--error-bg',t.errorBg);r.style.setProperty('--error-text',t.errorText);}}catch(e){}</script>
  ```
  Its SHA-256 is `8plvDJLmM7886+ra4DrxBzGM2hgpxIJwDEK2Iu4PWMU=`, which **matches the existing `script-src` hash** in the `firebase.json` CSP — so reusing it verbatim needs **no CSP change**. (The build must not alter this script's bytes; the contract test guards the hash.)
- Effect: a returning user with a saved palette (`statusapp_theme` in localStorage) sees `/about` in their theme; a first-time visitor sees the default slate. Identical mechanism to the app.

## Page structure & content

Single centered column, `max-width` ~600px (mirrors the app), responsive down to 360px.

1. **Hero** — the stylized struck-through `knock knock` brand mark (same glyph sequence as the splash), a one-line tagline ("Let the people who matter know when you're free."), and an "Open KnockKnock →" link to `/`.
2. **What it is** — a short friendly paragraph on ambient presence + one sentence acknowledging it's a small, experimental space that rewards curiosity.
3. **What you can do** — friendly, non-technical blurbs for the core six. **Colors, Calls, Groups, and Notifications each carry a small inline `<details>` "how it works" disclosure** (native `<details>`/`<summary>`, no JS); Availability and Knock stay as plain blurbs.
   - **Availability** — go available for a while; the people you've connected with see it in real time, in your color. *(plain blurb)*
   - **Knock** — a gentle nudge to a contact. *(plain blurb)*
   - **Colors** — pick a palette that themes the whole app. *`<details>`:* there are 16 palettes across two sets, each a full theme; you can **save favorite color combos** and **borrow a contact's color** by long-pressing their card. Your saved favorites also feed your pen colors on the call canvas (see Calls).
   - **Calls + shared canvas** — reach a contact and draw together. *`<details>`:* swipe right to call a mutual; they swipe right to answer, which opens a **shared drawing canvas** that's saved per pair. **Your saved favorite colors are the canvas pen colors** — so the palette you build in Colors is the palette you draw with.
   - **Groups** — small circles with their own status and name. *`<details>`:* each group can have its **own display name** and a **per-group status/color** that's separate from your primary one; you can **turn a group's status override off** anytime when you'd rather not keep a separate status for that group. Invite people by **link** or with the **in-app picker**.
   - **Notifications** — optional and **opt-in per contact**. *`<details>`:* choose who and what you're notified about (knocks, calls, availability, invites); some platforms (iOS Home Screen, macOS Dock) need the app installed first, and the app guides you when so.
4. **Your privacy, in short** — high-level model in the body:
   - No email, phone, or social sign-up — your account is a **4-word secret phrase**.
   - Only people you've connected with can see your status (and fellow members within a group).
   - No ads, no tracking, no analytics, nothing sold.
   - A small, invite-based space — not a public network.
5. **Privacy, in detail** — dedicated bottom section, `id="privacy"` anchor, still jargon-free but fuller:
   - **Your identity is a secret phrase.** Explain it's the only key to the account — treat it like a password; anyone who has it can sign in; it can't be reset or recovered for you. Keep it safe.
   - **What others can see vs. what stays private** — status/availability/color is visible to your connections; your contact list, settings, and saved colors are private to you.
   - **Where your data lives** — hosted on **Firebase (Google Cloud)**; the Realtime Database runs in the **`__DATA_REGION__`** region. Access is scoped so each account can only read/write its own data (broadcast status is readable by signed-in connections); a small Cloud Function mints a sign-in token from your phrase.
   - **Notifications** — opt-in per contact; you choose who and what.
   - **No analytics, ads, or data sales.**
6. **Footer** — "Open KnockKnock →" (to `/`), a link to the GitHub repo (`https://github.com/tenorune/on`), an "experimental personal project" line, and an attribution: **"Made by `__ABOUT_AUTHOR__` with a little help from Claude"** when `ABOUT_AUTHOR` is set, degrading to **"Made with a little help from Claude"** when it's unset (no `REPLACE_ME`, no dangling "by"). All outbound links `target="_blank" rel="noopener"`.

## Styling notes

- Dark slate surfaces, indigo accent on links/headings, a small green availability-dot motif as a visual echo of the app.
- Section cards on `--surface`; comfortable line-height and spacing for reading.
- `<details>` styled to match (subtle border, accent summary marker).
- No animation beyond subtle link/hover transitions.
- `<head>` mirrors the app's mobile essentials: `viewport`, `theme-color #0f172a`, `apple-mobile-web-app-*`, `manifest.json`, apple-touch-icon links. (`theme-color` stays the static default; it is not re-themed.)

## Accessibility

- Semantic landmarks (`<header> <main> <section> <footer>`), one `<h1>`, logical heading order.
- Native `<details>`/`<summary>` (keyboard-operable, no JS).
- Sufficient contrast in the default theme; outbound links carry discernible text (no "click here").

## Testing & verification

`tests/about-page.test.js` (jest, reads files from disk — no app boot):
- `about.template.html` exists and contains the key section markers (hero/tagline, the six feature names, the `id="privacy"` section).
- The inline theme-bootstrap `<script>` in `about.template.html` is byte-identical to the one in `index.template.html` (hashes match → CSP stays valid).
- Outbound links use `target="_blank"` and `rel="noopener"`; the GitHub repo link is present.
- `firebase.json`: the `/about` rewrite exists and is ordered **before** the `**` catch-all.
- Build substitution: feeding `about.template.html` through the substitution with/without `ABOUT_AUTHOR` set yields the author line / omits it (no `__ABOUT_AUTHOR__` or `REPLACE_ME` left in output); `__DATA_REGION__` is replaced.

Plus: `node scripts/dev-build.js`, then eyeball `/about` locally (default theme and a saved-theme localStorage value), and run the full web suite (`npx jest`).

## Out of scope (YAGNI)

- No in-app navigation/link *to* `/about` (standalone-only for now).
- No per-user live theme push (it reads the persisted `statusapp_theme` once at load, like the app's boot).
- No i18n, no separate light/dark toggle (theming comes from the saved palette).
- No analytics or share/OG image work (could add `og:`/`twitter:` meta later if desired).
