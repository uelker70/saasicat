import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { DemoAuthGuard } from './demo-auth.guard';
import { DemoPasswordHasher } from './demo-password.hasher';

/**
 * Auth must be a GLOBAL guard registered BEFORE the platform module: the
 * platform's StaticFeatureGuard/EnforceQuotaInterceptor are global too and
 * read `request.user` — global guards run in registration order, and
 * controller-level @UseGuards would come too late.
 *
 * Exported as its own module so both the SaasPlatformModule and the
 * CatalogModule wiring can list it under `imports` to resolve the
 * DemoAuthGuard they mount as a controller guard.
 */
@Global()
@Module({
    providers: [
        DemoAuthGuard,
        DemoPasswordHasher,
        { provide: APP_GUARD, useExisting: DemoAuthGuard },
    ],
    exports: [DemoAuthGuard, DemoPasswordHasher],
})
export class DemoAuthModule {}
