#!/usr/bin/env node
// scripts/build.js — reads .env.local and passes Firebase config as esbuild defines
const { readFileSync, existsSync } = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
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

const env = loadEnv();

const FIREBASE_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_DATABASE_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

const define = {};
FIREBASE_KEYS.forEach(key => {
  define[`process.env.${key}`] = JSON.stringify(env[key] || 'REPLACE_ME');
});

module.exports = { define };
