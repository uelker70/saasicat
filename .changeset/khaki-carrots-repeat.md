---
'@saasicat/nest': minor
---

Let the caller of `buildLabel` choose the number locale and the currency.

The promo label was formatted in German and worded in English — `25 % once`,
`1.234,56 € for the first month` — and the `€` was written into the string by
hand. That is not an internal debug string: `PromoCodesService.preview()` puts
it on the wire as `label`, so an app that renders the promo preview shows it to
the customer in checkout. A German product got English words, an English one
got German digit grouping, and everybody got euros.

`buildLabel` now takes a third, optional argument:

```ts
buildLabel(promo, 'MONTHLY', { locale: 'en-US', currency: 'USD' });
// '$30.00 once' — was '30,00 € once' regardless of what you asked for
```

`locale` is a BCP-47 tag and decides grouping, the decimal separator and where
the symbol sits; `currency` is an ISO-4217 code and decides the symbol and the
number of decimals — two for EUR, none for JPY, because the minor-unit count
belongs to the currency rather than to this function. Percentages follow the
locale too, so `en-US` writes `25%` closed up where `de-DE` writes `25 %`. An
unusable locale tag raises a `RangeError` instead of quietly falling back to
another one.

**Nothing moves unless you pass the argument.** The defaults are the previous
`de-DE` and `EUR`, down to the bytes: `Intl` separates a number from its unit
with a non-breaking space, so every such space in the formatted number is
folded to a plain one — the old string-concatenated output used a plain space,
and an invisible character that shifts with the runtime's ICU version has no
business travelling over the wire.

`PromoCodesService.preview()` still calls `buildLabel` with the defaults, so
the `label` in a promo preview response is unchanged. What is not solved here
is the language of the words: `once`, `for the first month` and `for 6 months`
are English and stay English, because translating them means composing the
sentence from `valueType`, `value`, `durationType` and `durationValue` — the
same fields the response already carries in `discount` — in the consumer's own
i18n layer. That version drops the string from the payload and is a breaking
change; this one is the part that fits under it.
