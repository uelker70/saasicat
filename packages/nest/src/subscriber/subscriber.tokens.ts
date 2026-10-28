/** Repository for `subscribers`, their tenant links and their corrections. */
export const SUBSCRIBER_REPOSITORY_TOKEN = Symbol.for('saasicat/nest/SubscriberRepository');

/** Repository that joins a returning customer's subscriber into the one it had. */
export const SUBSCRIBER_JOIN_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/SubscriberJoinRepository',
);

/** The transaction a join holds both subscribers and writes on. */
export const SUBSCRIBER_JOIN_TRANSACTION_RUNNER_TOKEN = Symbol.for(
    'saasicat/nest/SubscriberJoinTransactionRunner',
);
