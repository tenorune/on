// Polyfill Web APIs that jsdom does not expose but are available in browsers and Node 20+.
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const { webcrypto } = require('crypto');
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  writable: false,
  configurable: true,
});
