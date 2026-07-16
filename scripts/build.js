#!/usr/bin/env node
// scripts/build.js — reads .env.local or .env.production and passes Firebase config as esbuild defines
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { createHash } = require('crypto');
const path = require('path');

function loadEnv(filename) {
  const envPath = path.resolve(__dirname, '..', filename);
  if (!existsSync(envPath)) return {};
  const vars = {};
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq < 0) return;
    vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
  return vars;
}

// Use .env.production if ENV=production, otherwise .env.local
const envFile = process.env.ENV === 'production' ? '.env.production' : '.env.local';
const env = loadEnv(envFile);

const FIREBASE_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_DATABASE_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_VAPID_KEY',
];

const define = {};
FIREBASE_KEYS.forEach(key => {
  define[`process.env.${key}`] = JSON.stringify(env[key] || 'REPLACE_ME');
});

// Optional vars: a real environment variable overrides the env file (same
// precedence as writeIndexHtml/writeAboutHtml). CI builds rely on this — the
// FIREBASE_CONFIG_* secrets are write-only blobs, so the deploy workflows
// pass these through the Build step's `env:` instead of the secret.
const envVal = (key) => process.env[key] || env[key] || '';

// Optional Mini App deep-link base, e.g. "https://t.me/knockknock_test_bot/app".
// Empty (not REPLACE_ME) when unset so client code can feature-detect it.
define['process.env.TELEGRAM_APP_LINK'] = JSON.stringify(envVal('TELEGRAM_APP_LINK'));

// Dev-only identity-reset link (js/devReset.js): gates a secret + hostname
// allowlist behind these two vars. Fail closed — empty ⇒ feature inert.
define['process.env.DEV_RESET_SECRET'] = JSON.stringify(envVal('DEV_RESET_SECRET'));
define['process.env.DEV_RESET_HOSTS']  = JSON.stringify(envVal('DEV_RESET_HOSTS'));

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writeIndexHtml(defaultTitle) {
  const templatePath = path.resolve(__dirname, '..', 'index.template.html');
  const outPath = path.resolve(__dirname, '..', 'index.html');
  const title = process.env.APP_TITLE || env.APP_TITLE || defaultTitle;
  const template = readFileSync(templatePath, 'utf8');
  writeFileSync(outPath, template.replaceAll('__APP_TITLE__', escapeHtml(title)));
  return title;
}

// Generate sw.js from sw.template.js, stamping the cache name with a hash of the
// shell assets. Any shell change yields a new hash → a byte-different sw.js →
// the browser detects the update on its next check. Call AFTER writeIndexHtml
// and the esbuild bundle so the hashed inputs exist.
function writeServiceWorker() {
  const root = path.resolve(__dirname, '..');
  const template = readFileSync(path.join(root, 'sw.template.js'), 'utf8');
  const hash = createHash('sha256');
  for (const f of ['dist/bundle.js', 'css/app.css', 'css/canvas.css', 'index.html', 'manifest.json']) {
    const p = path.join(root, f);
    if (existsSync(p)) hash.update(readFileSync(p));
  }
  const version = `knockknock-${hash.digest('hex').slice(0, 12)}`;
  writeFileSync(path.join(root, 'sw.js'), template.replace(/__CACHE_VERSION__/g, version));
  return version;
}

function renderAbout(template, vars) {
  const title = vars.APP_TITLE || 'KnockKnock';
  const region = vars.DATA_REGION
    ? `the ${escapeHtml(vars.DATA_REGION)} region`
    : 'a Google Cloud region';
  const author = vars.ABOUT_AUTHOR || '';
  const madeBy = author
    ? `Made by ${escapeHtml(author)} with a little help from Claude`
    : 'Made with a little help from Claude';
  return template
    .replaceAll('__APP_TITLE__', escapeHtml(title))
    .replaceAll('__DATA_REGION__', region)
    .replaceAll('__ABOUT_MADE_BY__', madeBy)
    .replaceAll('__INVITE_PREVIEW_URL__', vars.INVITE_PREVIEW_URL || '')
    .replaceAll('__TELEGRAM_APP_LINK__', vars.TELEGRAM_APP_LINK || '');
}

// Absolute URL of the unauthenticated resolveInvitePreview callable, for the
// /about page's invite framing (it has no Firebase config to derive it from).
// Region is fixed at europe-west1 to match js/firebase-config.js getFunctions().
function invitePreviewUrl(projectId) {
  return projectId
    ? `https://europe-west1-${projectId}.cloudfunctions.net/resolveInvitePreview`
    : '';
}

// TELEGRAM_ENABLED is a hardcoded const in js/features.js (ESM — not
// requirable from this CJS script), yet the about page must never advertise a
// dead bot link when the flag is off (spec N5). Read it from the source text:
// features.js stays the single source of truth, so the page can never disagree
// with telegramSharingEnabled() (which requires flag AND link).
function readTelegramEnabled() {
  try {
    const src = readFileSync(path.resolve(__dirname, '..', 'js', 'features.js'), 'utf8');
    const m = src.match(/export const TELEGRAM_ENABLED = (true|false)/);
    return m ? m[1] === 'true' : false;
  } catch {
    return false; // fail closed: no flag, no Telegram CTA
  }
}

function writeAboutHtml(defaultTitle) {
  const templatePath = path.resolve(__dirname, '..', 'about.template.html');
  const outPath = path.resolve(__dirname, '..', 'about.html');
  const template = readFileSync(templatePath, 'utf8');
  const out = renderAbout(template, {
    APP_TITLE: process.env.APP_TITLE || env.APP_TITLE || defaultTitle,
    DATA_REGION: process.env.DATA_REGION || env.DATA_REGION || '',
    ABOUT_AUTHOR: process.env.ABOUT_AUTHOR || env.ABOUT_AUTHOR || '',
    INVITE_PREVIEW_URL: invitePreviewUrl(process.env.FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || ''),
    TELEGRAM_APP_LINK: readTelegramEnabled()
      ? (process.env.TELEGRAM_APP_LINK || env.TELEGRAM_APP_LINK || '')
      : '',
  });
  writeFileSync(outPath, out);
}

module.exports = { define, envFile, writeIndexHtml, writeServiceWorker, renderAbout, writeAboutHtml, invitePreviewUrl, readTelegramEnabled };
