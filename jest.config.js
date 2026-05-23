module.exports = {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.js$': 'babel-jest' },
  passWithNoTests: true,
  setupFilesAfterEnv: ['./tests/setup-globals.js'],
};
