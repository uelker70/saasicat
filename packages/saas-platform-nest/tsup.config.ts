import { defineConfig } from 'tsup';
import swc from 'unplugin-swc';

// tsup nutzt esbuild als Bundler. esbuild unterstuetzt
// `emitDecoratorMetadata` NICHT — daher fehlen `Reflect.metadata`-
// Aufrufe fuer Body-DTOs, was die globale `ValidationPipe` in
// Konsumenten-Apps stillschweigend deaktiviert (siehe SPEC_V2 §11.1
// M3 Bug-Befund 2026-05-14).
//
// Loesung: alle `.ts`-Files vorab durch SWC laufen lassen. SWC
// unterstuetzt `emitDecoratorMetadata` nativ und emittiert die
// `__metadata("design:paramtypes", [...])`-Calls, die Nest braucht,
// um den `@Body() dto: SomeDto` zu validieren.

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
