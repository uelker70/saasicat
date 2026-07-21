import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usePlanEditor, PlannedOnlyFeatureError } from '../dist/index.js';

// Q.5 — usePlanEditor: plan-editor discovery + validation at the platform level.
// The SuperAdmin UI calls the composable in its .vue component and gets
// (1) the catalog features incl. plannedOnly marker, (2) tier grouping,
// (3) toggle with safety guards, (4) pre-save validation.

function buildManifest({ features, plans = [] } = {}) {
    return {
        schemaVersion: 1,
        project: { key: 'cf', displayName: 'CF' },
        build: { platformPackageVersion: '0.1.0', appVersion: '1.0.0', manifestHash: 'sha256-x' },
        capabilities: {},
        navigation: { standardPages: {} },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'h',
            currency: 'EUR',
            vatRate: 19,
            features,
            plans,
        },
    };
}

const SAMPLE_FEATURES = [
    { key: 'VEHICLE_INVENTORY', label: 'Fahrzeugbestand', tier: 'CORE' },
    { key: 'CUSTOMER_MANAGEMENT', label: 'Kundenverwaltung', tier: 'CORE' },
    { key: 'CASHBOOK', label: 'Kassenbuch', tier: 'ADVANCED' },
    { key: 'DATEV_EXPORT_BASIC', label: 'DATEV-Basis', tier: 'ADVANCED' },
    { key: 'CALENDAR', label: 'Kalender', tier: 'PRO' },
    { key: 'DMS', label: 'DMS', tier: 'PRO' },
    { key: 'ATLAS_AES', label: 'ATLAS-AES', tier: 'BUSINESS' },
    { key: 'API_ACCESS', label: 'API-Zugriff', tier: 'ENTERPRISE_ONLY', plannedOnly: true },
    { key: 'SSO', label: 'Single-Sign-On', tier: 'ENTERPRISE_ONLY', plannedOnly: true },
];

describe('usePlanEditor — Discovery (availableFeatures)', () => {
    test('lists all catalog features with correct marker flags', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, {
            initialFeatures: ['VEHICLE_INVENTORY', 'CUSTOMER_MANAGEMENT'],
            baseFeatures: ['VEHICLE_INVENTORY'],
            nonRegressive: true,
        });
        const rows = editor.availableFeatures.value;
        assert.equal(rows.length, SAMPLE_FEATURES.length);

        const veh = rows.find((r) => r.def.key === 'VEHICLE_INVENTORY');
        assert.equal(veh.isSelected, true);
        assert.equal(veh.isInherited, true); // in base
        assert.equal(veh.isPlannedOnly, false);
        assert.equal(veh.canToggle, false); // locked by nonRegressive

        const cash = rows.find((r) => r.def.key === 'CASHBOOK');
        assert.equal(cash.isSelected, false);
        assert.equal(cash.isInherited, false);
        assert.equal(cash.canToggle, true);

        const sso = rows.find((r) => r.def.key === 'SSO');
        assert.equal(sso.isPlannedOnly, true);
        assert.equal(sso.canToggle, false);
    });

    test('featuresByTier groups + sorts by tier order', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m);
        const groups = editor.featuresByTier.value;
        const tiers = groups.map((g) => g.tier);
        assert.deepEqual(tiers, ['CORE', 'ADVANCED', 'PRO', 'BUSINESS', 'ENTERPRISE_ONLY']);
        assert.equal(groups[0].rows.length, 2); // VEHICLE_INVENTORY + CUSTOMER_MANAGEMENT
        assert.equal(groups[4].rows.length, 2); // API_ACCESS + SSO (both plannedOnly)
    });

    test('features without tier land in OTHER group at the end', () => {
        const m = buildManifest({
            features: [
                { key: 'A', tier: 'CORE' },
                { key: 'B' }, // without tier
            ],
        });
        const editor = usePlanEditor(m);
        const groups = editor.featuresByTier.value;
        assert.equal(groups[groups.length - 1].tier, 'OTHER');
        assert.equal(groups[groups.length - 1].rows[0].def.key, 'B');
    });

    test('manifest without features block: empty but no crash', () => {
        const m = buildManifest({ features: undefined });
        const editor = usePlanEditor(m);
        assert.equal(editor.availableFeatures.value.length, 0);
        assert.deepEqual(editor.featuresByTier.value, []);
    });
});

describe('usePlanEditor — toggleFeature', () => {
    test('toggle add + remove', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, { initialFeatures: [] });
        editor.toggleFeature('CASHBOOK');
        assert.equal(editor.selectedFeatures.value.has('CASHBOOK'), true);
        editor.toggleFeature('CASHBOOK');
        assert.equal(editor.selectedFeatures.value.has('CASHBOOK'), false);
    });

    test('toggle on plannedOnly feature is ignored (no state change)', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, { initialFeatures: [] });
        editor.toggleFeature('SSO');
        assert.equal(editor.selectedFeatures.value.has('SSO'), false);
        editor.toggleFeature('API_ACCESS');
        assert.equal(editor.selectedFeatures.value.has('API_ACCESS'), false);
    });

    test('nonRegressive: inherited feature cannot be removed', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, {
            initialFeatures: ['VEHICLE_INVENTORY'],
            baseFeatures: ['VEHICLE_INVENTORY'],
            nonRegressive: true,
        });
        editor.toggleFeature('VEHICLE_INVENTORY');
        assert.equal(editor.selectedFeatures.value.has('VEHICLE_INVENTORY'), true);
    });

    test('nonRegressive=false: inherited feature may be removed', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, {
            initialFeatures: ['VEHICLE_INVENTORY'],
            baseFeatures: ['VEHICLE_INVENTORY'],
            nonRegressive: false,
        });
        editor.toggleFeature('VEHICLE_INVENTORY');
        assert.equal(editor.selectedFeatures.value.has('VEHICLE_INVENTORY'), false);
    });
});

describe('usePlanEditor — validateDraft + snapshot', () => {
    test('snapshot returns sorted selection', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, {
            initialFeatures: ['DMS', 'CASHBOOK', 'CALENDAR'],
        });
        assert.deepEqual(editor.snapshot(), ['CALENDAR', 'CASHBOOK', 'DMS']);
    });

    test('validateDraft accepts a clean selection', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, {
            initialFeatures: ['CASHBOOK', 'DMS'],
        });
        editor.validateDraft(); // does not throw
    });

    test('validateDraft throws PlannedOnlyFeatureError when (e.g. via direct set) a plannedOnly key is present', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        // Deliberately bypassed toggle to exercise the validation path — simulates
        // an external state push (e.g. from a server draft that still contained
        // plannedOnly keys before the backend fix).
        const editor = usePlanEditor(m);
        editor.selectedFeatures.value = new Set(['CASHBOOK', 'SSO', 'API_ACCESS']);
        assert.throws(
            () => editor.validateDraft(),
            (err) => {
                assert.ok(err instanceof PlannedOnlyFeatureError);
                // PlannedOnlyFeatureError sorts violations alphabetically — stable.
                assert.deepEqual(err.violations, ['API_ACCESS', 'SSO']);
                assert.match(err.message, /plannedOnly/);
                return true;
            },
        );
    });
});
