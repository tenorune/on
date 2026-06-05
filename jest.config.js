module.exports = {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.js$': 'babel-jest' },
  passWithNoTests: true,
  // functions/ has its own node-env Jest config; keep the two toolchains separate.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/functions/'],
  setupFilesAfterEnv: ['./tests/setup-globals.js'],
};
