// PlanCatalogSource — the plan catalogue as it stands at the moment of asking.
//
// The settings of `config/saas.yaml` are read once, at start, and do not move
// while the process runs. The plans and features do: an operator publishes a
// version in the administration, and the application selling it keeps running.
// So they are read when an operation needs them rather than when the process
// started — and not re-read on publish either, because a publish can come from
// a process this one never hears about: a second instance, the CLI, or an
// application that publishes through its own code.

import type { PlanCatalog, PlanCatalogReadSink, PlanCatalogSettings } from '@saasicat/core';

import { buildPlanCatalogFromSnapshot } from './plan-catalog-from-snapshot.js';

/** Where the plans and features of a `PlanCatalogSource` come from. */
export type PlanCatalogOrigin = 'database' | 'given';

/**
 * The plan catalogue as it stands now.
 *
 * Read it once per operation and hand that value on. Every check the operation
 * makes then sees the same plans, so a version published halfway through
 * cannot price one step at the old figure and the next at the new one.
 */
export interface PlanCatalogSource {
    /** `database` for the plans an operator publishes, `given` for a fixed catalogue. */
    readonly origin: PlanCatalogOrigin;
    /** The settings of the file, with the plans and features as they stand at this moment. */
    current(): Promise<PlanCatalog>;
}

/** The plans and features as the database holds them, each time it is asked. */
export function databasePlanCatalogSource(
    settings: PlanCatalogSettings,
    sink: PlanCatalogReadSink,
): PlanCatalogSource {
    return {
        origin: 'database',
        current: async () => buildPlanCatalogFromSnapshot(settings, await sink.loadSnapshot()),
    };
}

/** A catalogue that does not move: the one given at start, for tests and in-memory setups. */
export function givenPlanCatalogSource(catalog: PlanCatalog): PlanCatalogSource {
    return { origin: 'given', current: () => Promise.resolve(catalog) };
}
