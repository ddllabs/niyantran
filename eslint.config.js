// Lint gate (open-work F21). Errors fail `npm run lint`; warnings are a backlog
// to burn down. The first run of this config found two ReferenceErrors in
// shipped code (03f039c), which is the kind of defect the errors guard against.
//
// Scope: the browser app, the Node server and Vercel router, and the scripts.
// Edge Functions are Deno and keep their own `deno lint` settings
// (supabase/functions/deno.json).
import js from '@eslint/js';
import globals from 'globals';
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
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // 281 unused bindings on 2026-09-29, most of them imports left by
      // refactors. A warning until they are cleared; then an error.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
    },
  },
];
