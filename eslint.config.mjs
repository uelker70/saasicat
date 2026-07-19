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
        // Tests, Scripts und Server-Side-Code (NestJS-Services) laufen unter
        // Node.js — `process`, `console`, `setTimeout`, `URL`, `Buffer` etc.
        // sind dort globale Bindings, nicht Browser-only.
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Unused-Imports / -Vars mit Unterstrich-Präfix bewusst ignorieren
            // (Convention für absichtlich-ungenutzte Parameter, z. B. in
            // Stubs/Adapter-Signaturen, die das Plattform-Interface erfüllen).
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
        // Module-Interfaces (NestJS-DynamicModule-Options) verwenden bewusst
        // `any` als loosely-typed Slot für Konsumenten-Factories — der
        // Typecheck passiert auf der Konsumenten-Seite.
        files: ['**/*-nest.interfaces.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
    {
        // CJS-Entry-Points dürfen `require()` benutzen — sie sind genau dafür da.
        files: ['**/*.cjs'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        // Vite-Env-Deklarationen sind per Definition leere Interfaces +
        // generische `any`-Slots, die den Standard-Slot erweitern.
        files: ['**/env.d.ts', '**/*.d.ts'],
        rules: {
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
