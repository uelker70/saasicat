// Regression-Guard für yada-services#63: die Publish-Controller müssen
// allowZeroPrice aus dem DTO an den Service durchreichen (sonst ist der
// Zero-Price-Escape-Hatch über HTTP unerreichbar). Direkt-Instanziierung
// statt NestJS-Bootstrap — der Controller ist eine reine Mapping-Schicht,
// kein Request-Lifecycle nötig (analog public-catalog-controller.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPlanVersionsController,
    buildBundleVersionsController,
} from '../dist/catalog/index.js';

const VERSION_ID = '00000000-0000-0000-0000-000000000001';

function makeController(buildFn, publishMethod) {
    let captured = null;
    const fakeService = {
        [publishMethod]: (versionId, meta) => {
            captured = { versionId, meta };
            return Promise.resolve({ ok: true });
        },
    };
    const ControllerClass = buildFn([]);
    return { controller: new ControllerClass(fakeService), getCaptured: () => captured };
}

test('PlanVersions.publish reicht allowZeroPrice an den Service durch (#63)', async () => {
    const { controller, getCaptured } = makeController(
        buildPlanVersionsController,
        'publishPlanVersion',
    );
    await controller.publish(VERSION_ID, {
        allowZeroPrice: true,
        forceRegressive: false,
        validFrom: '2026-01-01',
    });
    const { versionId, meta } = getCaptured();
    assert.equal(versionId, VERSION_ID);
    assert.equal(meta.allowZeroPrice, true);
    assert.equal(meta.forceRegressive, false);
});

test('PlanVersions.publish: allowZeroPrice bleibt undefined ohne DTO-Flag', async () => {
    const { controller, getCaptured } = makeController(
        buildPlanVersionsController,
        'publishPlanVersion',
    );
    await controller.publish(VERSION_ID, { validFrom: '2026-01-01' });
    assert.equal(getCaptured().meta.allowZeroPrice, undefined);
});

test('BundleVersions.publish reicht allowZeroPrice an den Service durch (#63)', async () => {
    const { controller, getCaptured } = makeController(
        buildBundleVersionsController,
        'publishBundleVersion',
    );
    await controller.publish(VERSION_ID, {
        allowZeroPrice: true,
        forceRegressive: false,
        validFrom: '2026-01-01',
    });
    assert.equal(getCaptured().meta.allowZeroPrice, true);
});

test('BundleVersions.publish: allowZeroPrice bleibt undefined ohne DTO-Flag', async () => {
    const { controller, getCaptured } = makeController(
        buildBundleVersionsController,
        'publishBundleVersion',
    );
    await controller.publish(VERSION_ID, { validFrom: '2026-01-01' });
    assert.equal(getCaptured().meta.allowZeroPrice, undefined);
});
