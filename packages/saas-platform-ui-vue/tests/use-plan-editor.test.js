import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usePlanEditor, PlannedOnlyFeatureError } from '../dist/index.js';

// Q.5 — usePlanEditor: Plan-Editor-Discovery + Validation auf Plattform-Ebene.
// SuperAdmin-UI ruft den Composable in ihrer .vue-Komponente und bekommt
// (1) die Catalog-Features inkl. plannedOnly-Marker, (2) Tier-Gruppierung,
// (3) Toggle mit Sicherheits-Guards, (4) Pre-Save-Validation.

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
            quotaKeys: [],
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
    test('listet alle Catalog-Features mit korrekten Marker-Flags', () => {
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
        assert.equal(veh.isInherited, true); // im Base
        assert.equal(veh.isPlannedOnly, false);
        assert.equal(veh.canToggle, false); // gelocked durch nonRegressive

        const cash = rows.find((r) => r.def.key === 'CASHBOOK');
        assert.equal(cash.isSelected, false);
        assert.equal(cash.isInherited, false);
        assert.equal(cash.canToggle, true);

        const sso = rows.find((r) => r.def.key === 'SSO');
        assert.equal(sso.isPlannedOnly, true);
        assert.equal(sso.canToggle, false);
    });

    test('featuresByTier gruppiert + sortiert nach Tier-Reihenfolge', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m);
        const groups = editor.featuresByTier.value;
        const tiers = groups.map((g) => g.tier);
        assert.deepEqual(tiers, ['CORE', 'ADVANCED', 'PRO', 'BUSINESS', 'ENTERPRISE_ONLY']);
        assert.equal(groups[0].rows.length, 2); // VEHICLE_INVENTORY + CUSTOMER_MANAGEMENT
        assert.equal(groups[4].rows.length, 2); // API_ACCESS + SSO (beide plannedOnly)
    });

    test('Features ohne tier landen in OTHER-Gruppe ans Ende', () => {
        const m = buildManifest({
            features: [
                { key: 'A', tier: 'CORE' },
                { key: 'B' }, // ohne tier
            ],
        });
        const editor = usePlanEditor(m);
        const groups = editor.featuresByTier.value;
        assert.equal(groups[groups.length - 1].tier, 'OTHER');
        assert.equal(groups[groups.length - 1].rows[0].def.key, 'B');
    });

    test('manifest ohne features-Block: leer aber kein Crash', () => {
        const m = buildManifest({ features: undefined });
        const editor = usePlanEditor(m);
        assert.equal(editor.availableFeatures.value.length, 0);
        assert.deepEqual(editor.featuresByTier.value, []);
    });
});

describe('usePlanEditor — toggleFeature', () => {
    test('toggle hinzufügen + entfernen', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, { initialFeatures: [] });
        editor.toggleFeature('CASHBOOK');
        assert.equal(editor.selectedFeatures.value.has('CASHBOOK'), true);
        editor.toggleFeature('CASHBOOK');
        assert.equal(editor.selectedFeatures.value.has('CASHBOOK'), false);
    });

    test('toggle auf plannedOnly-Feature wird ignoriert (kein State-Change)', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, { initialFeatures: [] });
        editor.toggleFeature('SSO');
        assert.equal(editor.selectedFeatures.value.has('SSO'), false);
        editor.toggleFeature('API_ACCESS');
        assert.equal(editor.selectedFeatures.value.has('API_ACCESS'), false);
    });

    test('nonRegressive: Inherited-Feature kann nicht entfernt werden', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, {
            initialFeatures: ['VEHICLE_INVENTORY'],
            baseFeatures: ['VEHICLE_INVENTORY'],
            nonRegressive: true,
        });
        editor.toggleFeature('VEHICLE_INVENTORY');
        assert.equal(editor.selectedFeatures.value.has('VEHICLE_INVENTORY'), true);
    });

    test('nonRegressive=false: Inherited-Feature darf entfernt werden', () => {
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
    test('snapshot liefert sortierte Selection', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, {
            initialFeatures: ['DMS', 'CASHBOOK', 'CALENDAR'],
        });
        assert.deepEqual(editor.snapshot(), ['CALENDAR', 'CASHBOOK', 'DMS']);
    });

    test('validateDraft akzeptiert eine cleane Selection', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        const editor = usePlanEditor(m, {
            initialFeatures: ['CASHBOOK', 'DMS'],
        });
        editor.validateDraft(); // wirft nicht
    });

    test('validateDraft wirft PlannedOnlyFeatureError, wenn (z.B. via direktes Set) ein plannedOnly-Key drin ist', () => {
        const m = buildManifest({ features: SAMPLE_FEATURES });
        // Bewusst toggle umgangen, um den Validation-Pfad zu prüfen — simuliert
        // einen externen State-Push (z. B. aus einem Server-Draft, der noch
        // plannedOnly-Keys enthielt vor dem Backend-Fix).
        const editor = usePlanEditor(m);
        editor.selectedFeatures.value = new Set(['CASHBOOK', 'SSO', 'API_ACCESS']);
        assert.throws(
            () => editor.validateDraft(),
            (err) => {
                assert.ok(err instanceof PlannedOnlyFeatureError);
                // PlannedOnlyFeatureError sortiert violations alphabetisch — stabil.
                assert.deepEqual(err.violations, ['API_ACCESS', 'SSO']);
                assert.match(err.message, /plannedOnly/);
                return true;
            },
        );
    });
});
