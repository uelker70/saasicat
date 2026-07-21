import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        ignores: ['**/dist/**', '**/node_modules/**', '**/.prisma/**', '**/generated/**'],
    },
    {
        // Tests, scripts, and server-side code (NestJS services) run under
        // Node.js — `process`, `console`, `setTimeout`, `URL`, `Buffer` etc.
        // are global bindings there, not browser-only.
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Deliberately ignore unused imports / vars with an underscore prefix
            // (convention for intentionally-unused parameters, e.g. in
            // stub/adapter signatures that fulfill the platform interface).
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        // Module interfaces (NestJS DynamicModule options) deliberately use
        // `any` as a loosely-typed slot for consumer factories — the
        // typecheck happens on the consumer side.
        files: ['**/*-nest.interfaces.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
    {
        // CJS entry points may use `require()` — that's exactly what they're for.
        files: ['**/*.cjs'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        // Vite env declarations are by definition empty interfaces +
        // generic `any` slots that extend the standard slot.
        files: ['**/env.d.ts', '**/*.d.ts'],
        rules: {
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
