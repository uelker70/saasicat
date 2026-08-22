// The paginated-list contract, without a framework around it.
//
// This is the decision `useApiList`, `createAdminResourceClient` and every list
// descriptor used to express separately: which values reach the query string,
// where the page number sits in it, what the page bounds are, and how an answer
// is read. Written once, it needs one set of cases — and the cases are the
// values that decide differently, not a sample of ordinary ones.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    LIST_FIRST_PAGE,
    LIST_PAGE_SIZE_DEFAULT,
    LIST_PAGE_SIZE_MAX,
    clampListPage,
    clampListPageSize,
    filterQueryString,
    isSentInQuery,
    listUrl,
    readListPage,
} from '../dist/index.js';

describe('isSentInQuery — which values reach the server', () => {
    test('the three spellings of "not filtered" are left out', () => {
        for (const value of [undefined, null, '']) {
            assert.equal(isSentInQuery(value), false, String(value));
        }
    });

    test('the falsy values that are answers are not', () => {
        // `status=0` and `active=false` are filters. Dropping them because they
        // are falsy is the bug this rule exists to prevent.
        for (const value of [0, false, Number.NaN, [], '0']) {
            assert.equal(isSentInQuery(value), true, JSON.stringify(value));
        }
    });
});

describe('listUrl', () => {
    test('always states its page, first and in order', () => {
        assert.equal(
            listUrl('/api/v1/admin/tenants'),
            `/api/v1/admin/tenants?page=${LIST_FIRST_PAGE}&pageSize=${LIST_PAGE_SIZE_DEFAULT}`,
        );
    });

    test('appends to an endpoint that already carries a query', () => {
        assert.equal(
            listUrl('/api/v1/admin/tenants?fixed=1', { page: 2 }),
            '/api/v1/admin/tenants?fixed=1&page=2&pageSize=50',
        );
    });

    test('serialises the filter after the pagination, in insertion order', () => {
        assert.equal(
            listUrl('/x', { pageSize: 10, filter: { b: 'two', a: 'one' } }),
            '/x?page=1&pageSize=10&b=two&a=one',
        );
    });

    test('omits the empty values and keeps the falsy ones', () => {
        assert.equal(
            listUrl('/x', {
                filter: { str: 'active', empty: '', nul: null, undef: undefined, zero: 0 },
            }),
            '/x?page=1&pageSize=50&str=active&zero=0',
        );
    });

    test('encodes with URLSearchParams — a space is a plus, not %20', () => {
        assert.equal(
            listUrl('/x', { filter: { q: 'a b&c=d' } }),
            '/x?page=1&pageSize=50&q=a+b%26c%3Dd',
        );
    });
});

describe('filterQueryString — the endpoints that do not page', () => {
    test('is empty when nothing survives the rule', () => {
        assert.equal(filterQueryString({ a: '', b: null, c: undefined }), '');
    });

    test('leads with a question mark when something does', () => {
        assert.equal(filterQueryString({ actor: 'cli:*', limit: 20 }), '?actor=cli%3A*&limit=20');
    });
});

describe('readListPage — both shapes real controllers answer with', () => {
    test('a bare array reports the rows it sent', () => {
        assert.deepEqual(readListPage([{ id: '1' }, { id: '2' }]), {
            items: [{ id: '1' }, { id: '2' }],
            total: 2,
        });
    });

    test('an envelope is read field by field', () => {
        assert.deepEqual(readListPage({ items: [{ id: '1' }], page: 2, pageSize: 25, total: 7 }), {
            items: [{ id: '1' }],
            total: 7,
            page: 2,
            pageSize: 25,
        });
    });

    test('what the answer did not state stays absent', () => {
        // Not zero: a caller that treats "no total" as "no rows" hides every
        // page but the first behind a paginator that thinks the list is empty.
        assert.deepEqual(readListPage({ items: [{ id: '1' }] }), { items: [{ id: '1' }] });
    });

    test('a body that is neither is an empty page, not a crash', () => {
        for (const raw of [null, undefined, 'nope', 42]) {
            assert.deepEqual(readListPage(raw), { items: [], total: 0 }, String(raw));
        }
    });

    test('an `items` that is not an array is not passed off as rows', () => {
        assert.deepEqual(readListPage({ items: 'three', total: 3 }), { items: [], total: 3 });
    });
});

describe('the page bounds the admin API serves', () => {
    test('a page below the first is the first', () => {
        assert.equal(clampListPage(0), LIST_FIRST_PAGE);
        assert.equal(clampListPage(-5), LIST_FIRST_PAGE);
    });

    test('a fractional page is the one it is on', () => {
        assert.equal(clampListPage(2.7), 2);
    });

    test('a page size stays inside 1..max', () => {
        assert.equal(clampListPageSize(0), 1);
        assert.equal(clampListPageSize(LIST_PAGE_SIZE_MAX + 300), LIST_PAGE_SIZE_MAX);
        assert.equal(clampListPageSize(10.9), 10);
    });
});
