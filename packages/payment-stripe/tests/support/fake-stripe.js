// A stand-in for Stripe's API over HTTP on localhost.
//
// The adapter's subject is what it sends and what it makes of what comes back,
// and both are only visible over the wire: the library's own request layer sits
// in between, and a stubbed method would prove nothing about the parameters it
// would have encoded. So the tests point a real Stripe client at this server
// and read the requests it recorded.

import { createServer } from 'node:http';
import Stripe from 'stripe';

/**
 * Starts a server answering the routes given as `{ 'POST /v1/customers': body }`,
 * where a body is either an object or a function of the recorded request.
 *
 * Returns the recorded requests, a Stripe client pointed at it, and `close`.
 */
export async function fakeStripe(routes) {
    // A Map rather than the object itself: a path is whatever the client sent,
    // and a plain object would answer a key like `constructor` out of its
    // prototype — with a function, which this then calls.
    const table = new Map(Object.entries(routes));
    const requests = [];
    const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const [path, query = ''] = req.url.split('?');
            const recorded = {
                method: req.method,
                path,
                query: Object.fromEntries(new URLSearchParams(query)),
                body: Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString())),
                headers: req.headers,
            };
            requests.push(recorded);
            const route = table.get(`${req.method} ${path}`);
            if (route === undefined) {
                res.writeHead(404, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `no route for ${path}` } }));
                return;
            }
            const answer = typeof route === 'function' ? route(recorded) : route;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(answer));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const client = new Stripe('sk_test_local', {
        host: '127.0.0.1',
        port: server.address().port,
        protocol: 'http',
        apiVersion: Stripe.API_VERSION,
        telemetry: false,
        maxNetworkRetries: 0,
    });
    return {
        requests,
        client,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

/** The callback Stripe sends for `event`, signed with `secret` as it signs a real one. */
export function signedCallback(event, secret) {
    const body = JSON.stringify(event);
    return {
        body,
        headers: {
            'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload: body, secret }),
        },
    };
}
