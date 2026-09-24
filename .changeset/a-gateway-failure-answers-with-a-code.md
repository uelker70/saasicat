---
'@saasicat/core': patch
'@saasicat/nest': patch
---

Answer a payment gateway that fails with SaaSiCat's own code

When the gateway fails while opening the form for a payment method — at
sign-up or when a tenant changes its payment method — or while reading a
callback back, the request is refused with `PAYMENT_GATEWAY_FAILED` and the
status 502, in the catalogue's wording. A form that failed to open records
nothing, and a callback that could not be read claims nothing, so the gateway
retries it. The failure's kind, code, status and request id go to the server
log, so the request can be found at the provider; an error the adapter wrote
itself, carrying no status, is logged with its message and stack.

- `PAYMENT_ERROR_CODES.PAYMENT_GATEWAY_FAILED` is new, with its English and
  German message. A filter of your own that caught the gateway's errors on
  these routes is no longer needed.
- A `PaymentGateway` of your own throws a failure as the provider reported it;
  a signature that does not verify is still `PaymentCallbackRejectedError`.
