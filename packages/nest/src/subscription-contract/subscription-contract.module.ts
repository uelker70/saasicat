import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { SubscriptionContractRepository } from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { SubscriptionContractService } from './subscription-contract.service.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from './subscription-contract.tokens.js';

export interface SubscriptionContractModuleOptions {
    subscriptionContractRepository: ProviderSpec<SubscriptionContractRepository>;
    /** Modules that provide dependencies used by the repository factory. */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    global?: boolean;
}

@Module({})
export class SubscriptionContractModule {
    static forRoot(options: SubscriptionContractModuleOptions): DynamicModule {
        return {
            module: SubscriptionContractModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            providers: [
                asProvider(
                    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
                    options.subscriptionContractRepository,
                ),
                SubscriptionContractService,
                ...(options.extraProviders ?? []),
            ],
            exports: [SubscriptionContractService, SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN],
        };
    }
}
