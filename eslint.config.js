import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { projectService: true, extraFileExtensions: ['.svelte'], parser: ts.parser, svelteConfig } }
  },
  {
    rules: {
      // `_`-prefixed bindings are deliberately unused (destructuring to drop a key).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // Server descriptions go through safeHtml() before {@html}.
      'svelte/no-at-html-tags': 'off',
      // Internal links are plain hrefs; this is a static SPA with no base path.
      'svelte/no-navigation-without-resolve': 'off',
      // Flags every local Date/Map temporary; ours are deliberately non-reactive.
      'svelte/prefer-svelte-reactivity': 'off'
    }
  },
  { ignores: ['build/', '.svelte-kit/', 'src-tauri/', 'node_modules/'] }
);
