// tests/rules/helpers.js
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

async function makeTestEnv() {
  return initializeTestEnvironment({
    projectId: 'demo-on',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: fs.readFileSync(path.resolve(__dirname, '../../database.rules.json'), 'utf8'),
    },
  });
}

// db handle authenticated as `uid` (or unauthenticated when uid is null).
function dbAs(env, uid) {
  return uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();
}

// Seed data bypassing rules (admin context).
async function seed(env, fn) {
  await env.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.database()); });
}

module.exports = { makeTestEnv, dbAs, seed };
