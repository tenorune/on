#!/usr/bin/env node
// scripts/dev-deploy.js — build with .env.local and deploy to dev project
// Reads DEV_PROJECT from .env.local or falls back to FIREBASE_PROJECT_ID
const { execSync } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const path = require('path');

// Load .env.local to get the dev project ID
const envPath = path.resolve(__dirname, '..', '.env.local');
let projectId = '';
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^FIREBASE_PROJECT_ID=(.+)/);
    if (m) projectId = m[1].trim();
  });
}

if (!projectId) {
  console.error('Error: FIREBASE_PROJECT_ID not found in .env.local');
  process.exit(1);
}

// Build with dev config
execSync('node scripts/dev-build.js', { stdio: 'inherit' });

// Deploy to dev project (hosting + database rules)
execSync(`npx firebase deploy --only hosting,database --project ${projectId}`, { stdio: 'inherit' });
