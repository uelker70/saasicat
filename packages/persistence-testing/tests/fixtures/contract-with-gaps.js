// Runs the contract against the in-memory harness in the shape a gap test asks
// for. Spawned in its own process by `gaps-are-declared.test.js`, because a
// suite that is meant to fail cannot run inside the test file that checks it.

import { persistenceAdapterContract } from '../../dist/index.js';

import { createMemoryHarness, MEMORY_HARNESS_GAPS } from '../support/memory-harness.js';

const BASE_GAPS = MEMORY_HARNESS_GAPS;

const SHAPES = {
    // The applied-settings port left out, and nothing declared.
    undeclared: { without: 'appliedSettings', gaps: BASE_GAPS },
    // The same port left out, and declared.
    declared: { without: 'appliedSettings', gaps: [...BASE_GAPS, 'appliedSettings'] },
    // Everything wired, and a gap declared for a part that is there.
    stale: { without: null, gaps: [...BASE_GAPS, 'mfa'] },
};

const shape = SHAPES[process.env.CONTRACT_GAP_SHAPE];
if (!shape) throw new Error(`unknown CONTRACT_GAP_SHAPE: ${process.env.CONTRACT_GAP_SHAPE}`);

persistenceAdapterContract({
    name: `in-memory adapter, ${process.env.CONTRACT_GAP_SHAPE}`,
    create: async () => {
        const harness = createMemoryHarness();
        if (shape.without) delete harness.adapter[shape.without];
        return harness;
    },
    gaps: shape.gaps,
});
