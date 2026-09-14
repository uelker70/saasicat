// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract

import { persistenceAdapterContract } from '../dist/index.js';

import { createMemoryHarness, MEMORY_HARNESS_GAPS } from './support/memory-harness.js';

// Self-test of the contract kit: the in-memory reference adapter with correct
// semantics must pass the suite, with the parts it does not keep declared as
// the gaps they are.

persistenceAdapterContract({
    name: 'in-memory reference adapter (self-test)',
    create: async () => createMemoryHarness(),
    gaps: MEMORY_HARNESS_GAPS,
});
