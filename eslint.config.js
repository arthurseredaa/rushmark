const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'ios/**',
      'android/**',
      '.expo/**',
      'tools/**',
      'spike/**',
      'coverage/**',
    ],
  },
  {
    // Principle I: no frame position may pass through a float representation at
    // any layer. The domain layer is where that is enforceable statically — these
    // rules make the accidental version of that mistake fail lint rather than
    // fail silently months later in an editor.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message:
            'Principle I: frame rates are exact rationals. Use parseRate() from @/domain/rational.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'round',
          message:
            'Principle I: rounding a frame position is a defect, not a tolerance. If you need a labelled fps for display only, use labelledFps() from @/domain/timecode.',
        },
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'Principle I: use parseRate() from @/domain/rational.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/data/*', '@/features/*', '@/ui/*', 'react', 'react-native', 'expo*'],
              message:
                'The domain layer is pure and dependency-free (plan.md Structure Decision). It must stay testable without a simulator or network.',
            },
          ],
        },
      ],
    },
  },
  {
    // Principle II: "Clearing cached video MUST NOT be able to reach unpublished
    // work. The separation MUST hold by construction, not by careful coding."
    // This is that construction. T063 asserts it at runtime too.
    files: ['src/data/cache/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/data/db/*', '@/data/sync/*'],
              message:
                'FR-036 / Principle II: the cache layer must not be able to reach the database or the pending-save queue. Clearing disk must be incapable of touching authored work.',
            },
          ],
        },
      ],
    },
  },
];
