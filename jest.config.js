// Two projects on purpose.
//
// `logic` covers the domain layer, the golden files, and the integration suites.
// None of them render a component or touch a simulator — plan.md's Structure
// Decision isolates the correctness-critical code from React Native precisely so
// it can be tested as pure functions. Running them under plain node keeps the
// constitution's mandated verification fast and free of the RN bundler.
//
// `component` is reserved for tests that genuinely need to render. There are
// none yet; the project is here so adding one doesn't require rethinking this.

const moduleNameMapper = {
  '^@/domain/(.*)$': '<rootDir>/src/domain/$1',
  '^@/data/(.*)$': '<rootDir>/src/data/$1',
  '^@/features/(.*)$': '<rootDir>/src/features/$1',
  '^@/ui/(.*)$': '<rootDir>/src/ui/$1',
  '^@/modules/(.*)$': '<rootDir>/modules/$1',
};

module.exports = {
  projects: [
    {
      displayName: 'logic',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/tests/unit/**/*.test.ts',
        '<rootDir>/tests/golden/**/*.test.ts',
        '<rootDir>/tests/integration/**/*.test.ts',
      ],
      moduleNameMapper,
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
      },
    },
    {
      displayName: 'component',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/tests/component/**/*.test.tsx'],
      moduleNameMapper,
    },
  ],
};
