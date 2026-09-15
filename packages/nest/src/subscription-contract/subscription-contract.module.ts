import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { SubscriberRepository, SubscriptionContractRepository } from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { subscriberProviders } from '../subscriber/subscriber.module.js';
import { SubscriberService } from '../subscriber/subscriber.service.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from '../subscriber/subscriber.tokens.js';
import { SubscriptionContractService } from './subscription-contract.service.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from './subscription-contract.tokens.js';

export interface SubscriptionContractModuleOptions {
    subscriptionContractRepository: ProviderSpec<SubscriptionContractRepository>;
    /**
     * The parties contracts are concluded with. The module provides
     * `SubscriberService` over it as well, for the application's own tenant
     * creation to call.
     */
    subscriberRepository: ProviderSpec<SubscriberRepository>;
    /** Modules that provide dependencies used by the repository factory. */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    global?: boolean;
}

@Module({})
export class SubscriptionContractModule {
    static forRoot(options: SubscriptionContractModuleOptions): DynamicModule {
        if (!options.subscriberRepository) {
            throw new Error(
                'SubscriptionContractModule: `subscriberRepository` is required — every contract ' +
                    'names the subscriber it is concluded with, and none can be written without it.',
            );
        }
        return {
            module: SubscriptionContractModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            providers: [
                asProvider(
                    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
                    options.subscriptionContractRepository,
                ),
                ...subscriberProviders(options.subscriberRepository),
                SubscriptionContractService,
                ...(options.extraProviders ?? []),
            ],
            exports: [
                SubscriptionContractService,
                SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
                SubscriberService,
                SUBSCRIBER_REPOSITORY_TOKEN,
            ],
        };
    }
}
