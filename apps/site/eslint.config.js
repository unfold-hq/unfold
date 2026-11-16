import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/**', '.astro/**', 'node_modules/**', '.wrangler/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['*.js', '*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
  },
  globalIgnores(['.releaserc.cjs', 'public/demo/', 'replay/']),
  {
    files: ['ops/dns/**/*.js'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'AAAA',
          'CF_PROXY_ON',
          'CF_SINGLE_REDIRECT',
          'D',
          'DefaultTTL',
          'DnsProvider',
          'IGNORE',
          'MX',
          'NewDnsProvider',
          'NewRegistrar',
          'TXT',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
]);
