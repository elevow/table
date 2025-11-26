/** @type {import('ts-jest').JestConfigWithTsJest} */
const isStrictCoverage = !!process.env.CI || process.env.STRICT_COVERAGE === 'true';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: [
    '/node_modules/',
    // Ignore legacy user-story-numbered test filenames (migrated to clean names)
    '.*us-\\d+.*\\.test\\.ts$'
  ],
  transform: {
  '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
    jsx: 'react-jsx'
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    'nanoid': '<rootDir>/node_modules/nanoid/index.cjs',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(nanoid|nanoid/.*)/)',
  ],
  setupFilesAfterEnv: [],
  testTimeout: 30000, // 30 seconds timeout to prevent hanging tests
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
    '!src/test/setup.ts',
    '!src/components/**/*.tsx', // Exclude React components from coverage for now
    '!src/examples/**', // Exclude example files from coverage
  ],
  coverageThreshold: isStrictCoverage
    ? {
        global: {
          // Relax branch coverage threshold while keeping others strict
          branches: 60,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      }
    : {
        // When running locally or focused tests, don’t fail the run due to global thresholds
        global: {
          branches: 0,
          functions: 0,
          lines: 0,
          statements: 0,
        },
      },
  coverageReporters: ['text', 'lcov', 'html', 'json-summary']
};
