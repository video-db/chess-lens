const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tools/**/*.{ts,tsx}', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['*.config.js', 'electron-builder.config.js', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
];
