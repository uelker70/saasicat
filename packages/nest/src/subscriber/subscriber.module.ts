import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { SubscriberRepository } from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { SubscriberService } from './subscriber.service.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from './subscriber.tokens.js';

export interface SubscriberModuleOptions {
    subscriberRepository: ProviderSpec<SubscriberRepository>;
    /** Modules that provide dependencies used by the repository factory. */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    global?: boolean;
}

/**
 * `SubscriberService` on its own. `SubscriptionContractModule` provides it as
 * well, because a contract cannot be written without it; this module is for an
 * application that creates tenants in a module of its own.
 *
 * Reads the customer number prefix from `PLAN_CATALOG_TOKEN`, which
 * `SaaSiCatModule.forRoot` provides globally.
 */
@Module({})
export class SubscriberModule {
    static forRoot(options: SubscriberModuleOptions): DynamicModule {
        return {
            module: SubscriberModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            providers: [
                ...subscriberProviders(options.subscriberRepository),
                ...(options.extraProviders ?? []),
            ],
            exports: [SubscriberService, SUBSCRIBER_REPOSITORY_TOKEN],
        };
    }
}

/**
 * The repository and the service over it, for every module that writes
 * contracts: they cannot be written without the party, so each of them carries
 * both rather than trusting a sibling module to export them.
 */
export function subscriberProviders(repository: ProviderSpec<SubscriberRepository>): Provider[] {
    return [asProvider(SUBSCRIBER_REPOSITORY_TOKEN, repository), SubscriberService];
}
