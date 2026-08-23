# Mount behind Express

The platform is **NestJS-native**. A pure Express app has two options:

## Mount NestJS Standalone Behind Express (recommended)

NestJS supports both Fastify and Express as HTTP adapters; an existing
Express app can run the SaaS endpoints as a sub-app.

```ts
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';

const root = express();
root.use('/legacy', myExistingExpressApp);

const saasExpressInstance = express();
const nest = await NestFactory.create(AppModule, new ExpressAdapter(saasExpressInstance));
await nest.init();

root.use('/', saasExpressInstance); // /api/v1/admin/* etc.
root.listen(3000);
```

Advantages: all decorators, guards, interceptors work unchanged; all
standard pages of the SuperAdmin UI run without modification.

## Pure Express App Without NestJS

Only sensible if you don't want NestJS. You then use exclusively:

- `@saasicat/core` (TypeScript interfaces)
- `@saasicat/spec` (JSON schemas + OpenAPI as contract)
- `@saasicat/nest/promo` (pure functions)
- `@saasicat/nest/billing` → `aggregateLimits`, `version-publish`, `version-renewal` (pure functions)
- `@saasicat/nest/entitlement` → `aggregateLimits`, `resolveEntitlementPlan`, `LimitExceededError`

and implement the **endpoints**, **guards**, **audit**, **MFA**, **RLS bypass**,
**discovery scan** yourself against the schemas in `@saasicat/spec/admin-api.openapi.yaml`.
This is essentially a _reimplementation_ of the platform modules — sensible only
for a completely different language (e.g. Django/Python).

> Recommendation: option 7.1. Option 7.2 is explicitly meant for foreign-language backends
> and should be avoided in a pure Node codebase.
