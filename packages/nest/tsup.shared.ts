// Shared between `tsup.config.ts` (ESM + types) and `tsup.cjs.config.ts`
// (the single shared CommonJS bundle). Both passes must treat the same
// packages as external — a dependency bundled into one pass but not the other
// would give the two outputs different copies of it.
export const CJS_EXTERNAL = [
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
];

// The entry list itself is NOT duplicated here — it is derived from
// `package.json` `exports` in `scripts/entries.mjs`, which the tsup configs,
// the stub generator and the identity test all read.
