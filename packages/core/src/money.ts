// Money, computed in decimal and rounded once, to the cent.
//
// A binary double cannot hold most amounts: 20.10 is stored as
// 20.0999999999999996447…, so 5 % of it — 1.005 in decimal — is computed as
// 1.00499999999999989…, and `Math.round(n * 100) / 100` makes it 1.00 where an
// accountant, a DATEV import and a customer with a calculator arrive at 1.01.
// The error is not noise: it lands on the half cent, the same way for the same
// inputs, every time.
//
// So an amount, a rate and a percentage are each read as the decimal they print
// as — the shortest decimal that reads back as the same double, which is what
// was written — and multiplied and divided as exact integers. The result is
// rounded once, at the end, to the cent, half away from zero: commercial
// rounding, and what a `numeric` column does. A negative amount, a credit,
// rounds the same way mirrored.
//
// Sums and differences are exact too, through `sumToCents`: in binary
// 29.9 − 7.475 is 22.424999…, and rounding that gives 22.42 where the decimal
// 22.425 gives 22.43. A difference is a sum with a negative term.

/** An exact decimal: `units / 10^scale`. */
interface ExactDecimal {
    readonly units: bigint;
    readonly scale: number;
}

const HUNDRED: ExactDecimal = { units: 100n, scale: 0 };

/**
 * The decimal a finite number prints as. A hand-written scanner rather than a
 * pattern: the text is `String(value)`, so it is one of two shapes, digits
 * with an optional point, or those followed by an exponent.
 */
function exactDecimal(value: number): ExactDecimal {
    if (!Number.isFinite(value)) {
        throw new RangeError(`${String(value)} is not an amount money can be computed from.`);
    }
    const text = String(value);
    const exponentAt = text.indexOf('e');
    const mantissa = exponentAt === -1 ? text : text.slice(0, exponentAt);
    const exponent = exponentAt === -1 ? 0 : Number(text.slice(exponentAt + 1));
    const pointAt = mantissa.indexOf('.');
    const whole = pointAt === -1 ? mantissa : mantissa.slice(0, pointAt);
    const fraction = pointAt === -1 ? '' : mantissa.slice(pointAt + 1);
    let units = BigInt(whole + fraction);
    let scale = fraction.length - exponent;
    if (scale < 0) {
        units *= 10n ** BigInt(-scale);
        scale = 0;
    }
    return { units, scale };
}

function sum(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
    const scale = Math.max(a.scale, b.scale);
    return {
        units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale),
        scale,
    };
}

/** `numerator / denominator` to the nearest integer, a half away from zero. */
function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
    if (denominator === 0n) throw new RangeError('An amount cannot be divided by zero.');
    const negative = numerator < 0n !== denominator < 0n;
    const n = numerator < 0n ? -numerator : numerator;
    const d = denominator < 0n ? -denominator : denominator;
    const quotient = n / d;
    const rounded = (n % d) * 2n >= d ? quotient + 1n : quotient;
    return negative ? -rounded : rounded;
}

/** `amount × factor / divisor`, in cents, rounded once. */
function cents(amount: ExactDecimal, factor: ExactDecimal, divisor: ExactDecimal): bigint {
    // amount × factor / divisor × 100, with every scale moved into integers.
    const numerator = amount.units * factor.units * 10n ** BigInt(divisor.scale) * 100n;
    const denominator = divisor.units * 10n ** BigInt(amount.scale + factor.scale);
    return roundHalfAwayFromZero(numerator, denominator);
}

function amountOf(inCents: bigint): number {
    return Number(inCents) / 100;
}

const ONE: ExactDecimal = { units: 1n, scale: 0 };

/** An amount as written, to the cent. */
export function roundToCents(amount: number): number {
    return amountOf(cents(exactDecimal(amount), ONE, ONE));
}

/** The terms added as written, exactly, and rounded once to the cent. */
export function sumToCents(...terms: number[]): number {
    const total = terms.map(exactDecimal).reduce(sum, { units: 0n, scale: 0 });
    return amountOf(cents(total, ONE, ONE));
}

/** The amount in whole cents, rounded once. */
export function toCents(amount: number): number {
    return Number(cents(exactDecimal(amount), ONE, ONE));
}

/** `percent` % of `amount`, to the cent — the discount a percentage takes off. */
export function percentOf(amount: number, percent: number): number {
    return amountOf(cents(exactDecimal(amount), exactDecimal(percent), HUNDRED));
}

/** `amount × part / whole`, to the cent — a share of a period, say. */
export function prorate(amount: number, part: number, whole: number): number {
    return amountOf(cents(exactDecimal(amount), exactDecimal(part), exactDecimal(whole)));
}

/** Gross from net at a tax rate in per cent: net × (100 + rate) / 100. */
export function grossFromNet(net: number, vatRate: number): number {
    return amountOf(cents(exactDecimal(net), sum(HUNDRED, exactDecimal(vatRate)), HUNDRED));
}

/** Net from gross at a tax rate in per cent: gross × 100 / (100 + rate). */
export function netFromGross(gross: number, vatRate: number): number {
    return amountOf(cents(exactDecimal(gross), HUNDRED, sum(HUNDRED, exactDecimal(vatRate))));
}

/** The tax a gross amount includes at a rate in per cent: gross × rate / (100 + rate). */
export function computeIncludedVat(gross: number, vatRate: number): number {
    const rate = exactDecimal(vatRate);
    return amountOf(cents(exactDecimal(gross), rate, sum(HUNDRED, rate)));
}
