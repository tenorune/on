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

// jsdom does not expose setImmediate; provide a Node-based polyfill so tests can
// flush the microtask queue with `await new Promise(setImmediate)`.
if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
}

// jsdom does not implement window.scrollTo (it throws "Not implemented"); knock.js
// calls it on knock receipt. Stub it to a no-op so tests don't emit console noise.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}

// structuredClone polyfill for jsdom compatibility (jsdom doesn't provide it).
// NOT a general-purpose shim: the JSON round-trip drops undefined/functions and
// mangles Date/Map/Set. Fine here — the only consumer (palette state in
// js/store.ts) is plain JSON-safe data.
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

