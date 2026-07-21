// Regression guard: the publish controllers must
// pass allowZeroPrice through from the DTO to the service (otherwise the
// zero-price escape hatch is unreachable over HTTP). Direct instantiation
// instead of NestJS bootstrap — the controller is a pure mapping layer,
// no request lifecycle needed (analogous to public-catalog-controller.test.js).

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

test('PlanVersions.publish passes allowZeroPrice through to the service (#63)', async () => {
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

test('PlanVersions.publish: allowZeroPrice stays undefined without the DTO flag', async () => {
    const { controller, getCaptured } = makeController(
        buildPlanVersionsController,
        'publishPlanVersion',
    );
    await controller.publish(VERSION_ID, { validFrom: '2026-01-01' });
    assert.equal(getCaptured().meta.allowZeroPrice, undefined);
});

test('BundleVersions.publish passes allowZeroPrice through to the service (#63)', async () => {
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

test('BundleVersions.publish: allowZeroPrice stays undefined without the DTO flag', async () => {
    const { controller, getCaptured } = makeController(
        buildBundleVersionsController,
        'publishBundleVersion',
    );
    await controller.publish(VERSION_ID, { validFrom: '2026-01-01' });
    assert.equal(getCaptured().meta.allowZeroPrice, undefined);
});
