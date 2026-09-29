// Lint gate (open-work F21). `npm run lint` fails on any error or warning
// (F25). The first run of this config found two ReferenceErrors in shipped
// code (03f039c), which is the kind of defect the errors guard against.
//
// Scope: the browser app, the Node server and Vercel router, and the scripts.
// Edge Functions are Deno and keep their own `deno lint` settings
// (supabase/functions/deno.json).
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'backup/**', 'tmp/**', 'ingest/**', 'supabase/functions/**', 'backend/**'],
  },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Core ESLint 9 scope analysis ignores JSX: without these two rules a
      // component used only as <Foo /> reads as unused, and an undefined
      // <Bar /> is not reported at all (F25).
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error',
      // An error since F25 cleared the backlog (2026-09-29). Prefix a binding
      // with _ to keep it deliberately.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
    },
  },
];
