import { defineConfig } from 'tsup';
import swc from 'unplugin-swc';

// tsup uses esbuild as its bundler. esbuild does NOT support
// `emitDecoratorMetadata` — so the `Reflect.metadata` calls for
// body DTOs are missing, which silently disables the global
// `ValidationPipe` in consumer apps (see SPEC_V2 §11.1 M3 bug
// finding 2026-05-14).
//
// Solution: run all `.ts` files through SWC first. SWC supports
// `emitDecoratorMetadata` natively and emits the
// `__metadata("design:paramtypes", [...])` calls that Nest needs
// to validate `@Body() dto: SomeDto`.

export default defineConfig({
    entry: [
        'src/index.ts',
        'src/promo/index.ts',
        'src/billing/index.ts',
        'src/entitlement/index.ts',
        'src/testing/index.ts',
        'src/admin/index.ts',
        'src/registration/index.ts',
        'src/discovery/index.ts',
        'src/catalog/index.ts',
        'src/checkout-offer/index.ts',
        'src/subscription-contract/index.ts',
        'src/platform/index.ts',
    ],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    external: [
        '@saasicat/types',
        '@saasicat/spec',
        '@nestjs/common',
        '@nestjs/core',
        '@nestjs/schedule',
        'js-yaml',
        'ajv',
        'ajv-formats',
        'otplib',
        'rxjs',
        'class-validator',
        'class-transformer',
    ],
    plugins: [
        swc.vite({
            jsc: {
                parser: { syntax: 'typescript', decorators: true },
                transform: {
                    legacyDecorator: true,
                    decoratorMetadata: true,
                },
                target: 'es2022',
                keepClassNames: true,
            },
        }),
    ],
});
