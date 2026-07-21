// DiscoveryModule — binds the DiscoveryScanner and provides the
// DiscoverySnapshot via a DI token.
//
// Consumer setup:
//
// ```ts
// @Module({
//   imports: [
//     DiscoveryModule.forRoot({
//       app: { key: 'clubapp', version: '0.42.1' },
//       controller: { guards: [JwtAuthGuard, SuperAdminGuard] },
//     }),
//   ],
// })
// export class AppModule {}
// ```
//
// Consumers inject the snapshot via:
//
// ```ts
// constructor(@Inject(DISCOVERY_SNAPSHOT_TOKEN) snapshot: DiscoverySnapshot) {…}
// ```
//
// or the scanner directly for a re-build (`DiscoveryScanner.rebuildSnapshot()`).

import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import { DiscoveryModule as NestDiscoveryModule } from '@nestjs/core';

import { buildDiscoveryController } from './discovery.controller.js';
import {
    DISCOVERY_APP_INFO_TOKEN,
    DISCOVERY_SNAPSHOT_PATH_TOKEN,
    DiscoveryScanner,
    type DiscoveryAppInfo,
} from './discovery.scanner.js';
import { DISCOVERY_SNAPSHOT_TOKEN } from './tokens.js';
import type { DiscoverySnapshot } from './types.js';

export interface DiscoveryControllerConfig {
    /**
     * Class-level guards for `GET /admin/discovery`. MANDATORY — `forRoot()`
     * throws at boot otherwise. Pass `[]` explicitly if the endpoint should
     * deliberately be auth-free (e.g. CI/smoke test).
     */
    guards: Array<Type<CanActivate>>;
}

export interface DiscoveryModuleOptions {
    /** App identity that is adopted into the snapshot (`app.key`/`app.version`). */
    app: DiscoveryAppInfo;
    /**
     * Controller mount for `GET /admin/discovery`. If omitted, the endpoint
     * is not registered — consumers can then build it themselves (e.g. with
     * a different path or additional guards) and inject the scanner via
     * `DISCOVERY_SNAPSHOT_TOKEN`.
     */
    controller?: DiscoveryControllerConfig;
    /**
     * Modules whose providers must be visible in the DI scope of this
     * DynamicModule — typically: `AuthModule`, which exports the `JwtAuthGuard`
     * from `controller.guards`. Without this entry, NestJS fails with an
     * `UnknownDependenciesException` for the guard if the AuthModule is not
     * global.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /**
     * Optional: register the module globally — `DISCOVERY_SNAPSHOT_TOKEN` and
     * `DiscoveryScanner` are then available without another `imports` entry.
     * Default: `true`.
     */
    isGlobal?: boolean;
    /**
     * Optional: path into which the DiscoveryScanner writes the snapshot as
     * JSON on `OnApplicationBootstrap`. Consumers (CI gates, preflight CLIs)
     * can read the file with `loadDiscoverySnapshotFromFile(path)` without
     * booting all app modules themselves. If omitted, nothing is written.
     */
    snapshotPath?: string | null;
}

@Module({})
export class DiscoveryModule {
    static forRoot(options: DiscoveryModuleOptions): DynamicModule {
        const isGlobal = options.isGlobal ?? true;
        const controllers: Type[] = [];

        if (options.controller) {
            controllers.push(buildDiscoveryController(options.controller.guards));
        }

        const providers: Provider[] = [
            { provide: DISCOVERY_APP_INFO_TOKEN, useValue: options.app },
            {
                provide: DISCOVERY_SNAPSHOT_PATH_TOKEN,
                useValue: options.snapshotPath ?? null,
            },
            DiscoveryScanner,
            {
                provide: DISCOVERY_SNAPSHOT_TOKEN,
                useFactory: (scanner: DiscoveryScanner): DiscoverySnapshot => scanner.getSnapshot(),
                inject: [DiscoveryScanner],
            },
        ];

        return {
            module: DiscoveryModule,
            imports: [NestDiscoveryModule, ...(options.imports ?? [])],
            controllers,
            providers,
            exports: [DiscoveryScanner, DISCOVERY_SNAPSHOT_TOKEN],
            global: isGlobal,
        };
    }
}
