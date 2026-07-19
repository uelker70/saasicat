import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { SubscriptionContractRepository } from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { SubscriptionContractService } from './subscription-contract.service.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from './tokens.js';

export interface SubscriptionContractModuleOptions {
    subscriptionContractRepository: ProviderSpec<SubscriptionContractRepository>;
    extraProviders?: Provider[];
    global?: boolean;
}

@Module({})
export class SubscriptionContractModule {
    static forRoot(options: SubscriptionContractModuleOptions): DynamicModule {
        return {
            module: SubscriptionContractModule,
            global: options.global ?? false,
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
