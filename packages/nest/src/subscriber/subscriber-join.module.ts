import { type DynamicModule, type ForwardReference, Module, type Type } from '@nestjs/common';
import type {
    SubscriberJoinRepository,
    SubscriberRepository,
    TransactionRunner,
} from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { SubscriberJoinService } from './subscriber-join.service.js';
import {
    SUBSCRIBER_JOIN_REPOSITORY_TOKEN,
    SUBSCRIBER_JOIN_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIBER_REPOSITORY_TOKEN,
} from './subscriber.tokens.js';

export interface SubscriberJoinModuleOptions {
    subscriberJoinRepository: ProviderSpec<SubscriberJoinRepository>;
    /** Where the subscribers are read: the command line names them by customer number. */
    subscriberRepository: ProviderSpec<SubscriberRepository>;
    /** The transaction both subscribers are held and written on. */
    transactionRunner: ProviderSpec<TransactionRunner>;
    /** Modules that provide dependencies used by the repository factory. */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * `SubscriberJoinService`: a returning customer's subscriber joined into the
 * one it had (`SC-ADM-027`). The administration's routes import it, and so
 * does the command line, which an installation without the administration's
 * resources joins with. Refuses to start where the database lacks the guard of
 * `1.0-a-subscriber-is-joined.postgres.sql`.
 */
@Module({})
export class SubscriberJoinModule {
    static forRoot(options: SubscriberJoinModuleOptions): DynamicModule {
        return {
            module: SubscriberJoinModule,
            imports: options.imports ?? [],
            providers: [
                asProvider(SUBSCRIBER_JOIN_REPOSITORY_TOKEN, options.subscriberJoinRepository),
                asProvider(SUBSCRIBER_JOIN_TRANSACTION_RUNNER_TOKEN, options.transactionRunner),
                asProvider(SUBSCRIBER_REPOSITORY_TOKEN, options.subscriberRepository),
                SubscriberJoinService,
            ],
            exports: [SubscriberJoinService, SUBSCRIBER_JOIN_REPOSITORY_TOKEN],
        };
    }
}
