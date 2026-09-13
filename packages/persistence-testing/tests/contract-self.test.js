// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract

import { persistenceAdapterContract } from '../dist/index.js';

import { createMemoryHarness } from './support/memory-harness.js';

// Self-test of the contract kit: the in-memory reference adapter with correct
// semantics must pass the suite. It keeps no validity windows, so the two
// time-aware lifecycle groups are declared as the gaps they are.

persistenceAdapterContract({
    name: 'in-memory reference adapter (self-test)',
    create: async () => createMemoryHarness(),
    gaps: ['planLifecycle', 'bundleValidity'],
});
