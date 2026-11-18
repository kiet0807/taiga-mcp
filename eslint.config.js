import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // .vercel is local build output; private holds local-only scripts that are not committed.
  { ignores: ['dist', 'node_modules', '.vercel', 'private'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // stdout carries the MCP protocol: anything printed there breaks the connection.
      // Diagnostics go to stderr through console.error.
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    // Scripts run by hand or in GitHub Actions, outside the MCP protocol: they may print.
    files: ['scripts/**'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
);
