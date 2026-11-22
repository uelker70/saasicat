import type { BundlePricingOverride } from '@saasicat/core';

// What the notes app sells: its plans and add-ons as the seed writes them. Kept
// apart from the seed itself, which connects to the database when it is loaded,
// so that a test can read the catalogue the demo runs on.

/** A plan stem plus its single published v1 (mirrors config/saas.yaml). */
export interface PlanSeed {
    planKey: string;
    label: string;
    description: string;
    sortOrder: number;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: number;
    yearlyNet: number;
    changeNote: string;
}

export const PLANS: PlanSeed[] = [
    {
        planKey: 'STARTER',
        label: 'Starter',
        description: 'For getting started — notes only.',
        sortOrder: 10,
        features: ['NOTES'],
        quotas: { notesMax: 25 },
        monthlyNet: 9,
        yearlyNet: 90,
        changeNote: 'Initial release (seed).',
    },
    {
        planKey: 'PRO',
        label: 'Pro',
        description: 'Notes plus export and a generous quota.',
        sortOrder: 20,
        features: ['NOTES', 'NOTES_EXPORT'],
        quotas: { notesMax: 1000 },
        monthlyNet: 29,
        yearlyNet: 290,
        changeNote: 'Initial release (seed).',
    },
];

/** A reusable add-on bundle plus its single published v1. */
export interface BundleSeed {
    bundleKey: string;
    label: string;
    description: string;
    icon: string;
    sortOrder: number;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: number;
    /**
     * Both plans here are sold monthly *and* yearly, and a bundle offered to a
     * plan has to resolve a price in the rhythm that plan is bought in — the
     * publish gate refuses a version that cannot, and the booking preview
     * blocks one that slipped through. Seeded with only a monthly price, these
     * two were permanently unbookable for every tenant on a yearly plan, which
     * is what an integrator would have copied.
     */
    yearlyNet: number;
    /**
     * A price of the add-on's own for a plan, in place of the one above. The
     * public catalogue, the booking preview and the contract all read it, so a
     * prospect choosing that plan is shown what the contract will take.
     */
    pricingOverrides: BundlePricingOverride[];
    changeNote: string;
}

export const BUNDLES: BundleSeed[] = [
    {
        bundleKey: 'EXPORT_PRO',
        label: 'Export Pro',
        description: 'Adds note export to any plan.',
        icon: 'file_download',
        sortOrder: 10,
        features: ['NOTES_EXPORT'],
        quotas: {},
        monthlyNet: 5,
        yearlyNet: 50,
        pricingOverrides: [{ planId: 'PRO', monthlyNet: '4', yearlyNet: '40' }],
        changeNote: 'Initial release (seed).',
    },
    {
        bundleKey: 'POWER_QUOTA',
        label: 'Power Quota',
        description: 'Raises the notes limit to 5000.',
        icon: 'trending_up',
        sortOrder: 20,
        features: [],
        quotas: { notesMax: 5000 },
        monthlyNet: 8,
        yearlyNet: 80,
        pricingOverrides: [],
        changeNote: 'Initial release (seed).',
    },
];
