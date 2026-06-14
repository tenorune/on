module.exports = {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.js$': 'babel-jest' },
  passWithNoTests: true,
  // functions/ has its own node-env Jest config; keep the two toolchains separate.
  // tests/rules/ uses the database emulator (jest.rules.config.js); keep it out of the default suite.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/functions/', '/tests/rules/'],
  setupFilesAfterEnv: ['./tests/setup-globals.js'],
};
