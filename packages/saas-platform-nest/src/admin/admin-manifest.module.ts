// AdminManifestModule — DI wrapper around AdminManifestService + public boot controller.
//
// Consumers pass their app-specific `AdminManifestConfig` (project, build,
// planCatalogSnapshot) through as a value or a factory.
//
// Auth pattern: when `includeManifestController: true` (default), the consumer
// MUST set `guards` — either a concrete guard list (e.g.
// `[JwtAuthGuard, SuperAdminGuard]`) or explicitly `[]` to run the endpoint
// intentionally auth-free (CI/smoke test). Without an explicit choice,
// `forRoot()` throws at boot so that no consumer accidentally deploys an
// unprotected manifest endpoint. `reloadGuards` attaches additional guards
// exclusively to `POST /admin/manifest/reload` (typically `MfaGuard`).

import {
    type CanActivate,
    Controller,
    type DynamicModule,
    type FactoryProvider,
    type ForwardReference,
    Get,
    Header,
    Headers,
    HttpCode,
    HttpStatus,
    Inject,
    Module,
    Post,
    type Provider,
    Res,
    type Type,
    UseGuards,
} from '@nestjs/common';
import { ADMIN_MANIFEST_CONFIG, type AdminManifestConfig } from './admin-manifest.config.js';
import {
    AdminManifestService,
    PLATFORM_CORE_CONTRIBUTION_TOKEN,
} from './admin-manifest.service.js';
import { AdminPublicBootController } from './admin-public-boot.controller.js';
import { PLATFORM_CORE_MANIFEST_CONTRIBUTION } from './manifest-core.js';

type ConfigSpec =
    | AdminManifestConfig
    | Pick<FactoryProvider<AdminManifestConfig>, 'useFactory' | 'inject'>;

interface HttpResponseLike {
    header(name: string, value: string): unknown;
    status(code: number): unknown;
}

export interface AdminManifestModuleOptions {
    /** AdminManifestConfig as a value or via a factory (e.g. with a PLAN_CATALOG_TOKEN inject). */
    config: ConfigSpec;
    /**
     * Default `true`. Set to `false` when the consumer registers its own
     * manifest controller with app-specific guards entirely on its own.
     */
    includeManifestController?: boolean;
    /**
     * Class-level guards for GET /admin/manifest and POST /admin/manifest/reload,
     * when `includeManifestController === true`. REQUIRED — otherwise
     * `forRoot()` throws at boot.
     *
     * Pass `[]` explicitly when the endpoint should intentionally be auth-free
     * (e.g. CI smoke tests, public demo). This makes the choice visible in the
     * code rather than a silent default.
     */
    guards?: Array<Type<CanActivate>>;
    /**
     * Additional guards that apply ONLY to POST /admin/manifest/reload
     * (typically `MfaGuard`). Placed after `guards` in the chain. Must be made
     * available by the consumer as a provider.
     */
    reloadGuards?: Array<Type<CanActivate>>;
    /**
     * Default `true`. When active, the module automatically hooks
     * `PLATFORM_CORE_MANIFEST_CONTRIBUTION` (StandardPage spine, generic tenant
     * actions, platform audit action labels) into the `AdminManifestService` —
     * before all app `register()` calls from `onModuleInit`. Consumers without
     * a SuperAdmin need set this to `false`.
     */
    registerPlatformCore?: boolean;
    /**
     * Modules whose providers must be visible in the DI scope of this
     * DynamicModule — typically: the app module that registers the
     * factory-inject provider (e.g. `AdminManifestConfigFactory`). Without this
     * entry, NestJS 11.1.19 cannot resolve the `inject:[...]` of the config
     * factory (UnknownDependenciesException for ADMIN_MANIFEST_CONFIG).
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /** Additional providers that are registered in the DynamicModule itself. */
    extraProviders?: Provider[];
    /** Register the module globally — default `false`. */
    global?: boolean;
}

function asConfigProvider(impl: ConfigSpec): Provider {
    if (
        typeof impl === 'object' &&
        impl !== null &&
        'useFactory' in impl &&
        typeof impl.useFactory === 'function'
    ) {
        return {
            provide: ADMIN_MANIFEST_CONFIG,
            useFactory: impl.useFactory,
            inject: impl.inject,
        };
    }
    return { provide: ADMIN_MANIFEST_CONFIG, useValue: impl };
}

/**
 * Builds a controller class at boot time with the guards configured by the
 * consumer. Method-level `@UseGuards(...)` applies in NestJS in addition to
 * the class-level variant; `reload` therefore gets `guards` + `reloadGuards`
 * in the chain.
 */
function buildManifestController(
    guards: Array<Type<CanActivate>>,
    reloadGuards: Array<Type<CanActivate>>,
): Type {
    const reloadChain = [...guards, ...reloadGuards];

    @Controller('admin')
    @UseGuards(...guards)
    class GeneratedAdminManifestController {
        // Explicit @Inject instead of type reflection: tsup/esbuild do not emit
        // `design:paramtypes` metadata, so Nest cannot otherwise resolve the
        // service type at the constructor.
        constructor(
            @Inject(AdminManifestService) private readonly manifest: AdminManifestService,
        ) {}

        @Get('manifest')
        @Header('Cache-Control', 'private, max-age=60, must-revalidate')
        getManifest(
            @Headers('if-none-match') ifNoneMatch: string | undefined,
            @Res({ passthrough: true }) res: HttpResponseLike,
        ) {
            const m = this.manifest.getManifest();
            const etag = `"${m.build.manifestHash}"`;
            res.header('ETag', etag);

            if (ifNoneMatch && ifNoneMatch === etag) {
                res.status(HttpStatus.NOT_MODIFIED);
                return null;
            }

            return m;
        }

        @Post('manifest/reload')
        @UseGuards(...reloadChain)
        @HttpCode(HttpStatus.OK)
        reload() {
            const m = this.manifest.rebuild();
            return {
                manifestHash: m.build.manifestHash,
                reloadedAt: new Date().toISOString(),
            };
        }
    }

    return GeneratedAdminManifestController;
}

@Module({})
export class AdminManifestModule {
    static forRoot(options: AdminManifestModuleOptions): DynamicModule {
        const includeManifestController = options.includeManifestController ?? true;
        const registerPlatformCore = options.registerPlatformCore ?? true;

        const controllers: Type[] = [AdminPublicBootController];
        if (includeManifestController) {
            if (options.guards === undefined) {
                throw new Error(
                    'AdminManifestModule.forRoot: `guards` ist Pflicht, wenn ' +
                        '`includeManifestController` aktiv ist (Default `true`). ' +
                        'Setze `guards: [JwtAuthGuard, SuperAdminGuard]` (oder ' +
                        'analog) — oder `guards: []`, um den Endpoint absichtlich ' +
                        'auth-frei zu betreiben. Alternative: ' +
                        '`includeManifestController: false` und einen eigenen ' +
                        'Wrapping-Controller registrieren.',
                );
            }
            controllers.push(buildManifestController(options.guards, options.reloadGuards ?? []));
        }

        const providers: Provider[] = [
            asConfigProvider(options.config),
            AdminManifestService,
            ...(options.extraProviders ?? []),
        ];
        if (registerPlatformCore) {
            providers.push({
                provide: PLATFORM_CORE_CONTRIBUTION_TOKEN,
                useValue: PLATFORM_CORE_MANIFEST_CONTRIBUTION,
            });
        }

        return {
            module: AdminManifestModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers,
            providers,
            exports: [ADMIN_MANIFEST_CONFIG, AdminManifestService],
        };
    }
}
