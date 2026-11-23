import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { readFileSync } from 'node:fs';

// Files copied from the website (scripts/sync-website-record.mjs) are linted by the website's rule.
const websiteFiles = Object.keys(JSON.parse(readFileSync(new URL('./src/shell/website-sync.json', import.meta.url), 'utf8')).files)
  .filter((f) => /\.(js|jsx)$/.test(f) && f.startsWith('src/'));

export default [
  { ignores: ['dist', 'dist-sample', 'android', 'ios', 'src/globe/nterGlobe.app.js', 'node_modules'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    files: websiteFiles,
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^[A-Z_]' }] },
  },
  {
    files: ['**/*.test.{js,jsx}', 'vitest.setup.js'],
    languageOptions: { globals: { ...globals.vitest } },
  },
];
