module.exports = {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.(js|ts)$': 'babel-jest' },
  // ESM source uses extensionful relative specifiers (./x.js). esbuild resolves
  // ./x.js to x.ts once a module converts; this mapper makes Jest do the same:
  // strip the .js and let the resolver try .js then .ts (moduleFileExtensions
  // covers both by default). JSON/fixture imports are untouched (.json).
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  passWithNoTests: true,
  // functions/ has its own node-env Jest config; keep the two toolchains separate.
  // tests/rules/ uses the database emulator (jest.rules.config.js); keep it out of the default suite.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/functions/', '/tests/rules/'],
  setupFilesAfterEnv: ['./tests/setup-globals.js'],
};
