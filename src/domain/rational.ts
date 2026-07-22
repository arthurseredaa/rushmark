/**
 * Exact rational frame rates. A rate is NEVER a float here.
 *
 * Ported from tools/sidecar-gen/src/rational.js, which was verified end-to-end
 * against DaVinci Resolve on real 23.976 footage (Phase 0 spike, 2026-07-17).
 * Constitution Principle I: exactness is not a tolerance band.
 */

export type Rational = {
  readonly num: number;
  readonly den: number;
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Reduce to lowest terms — required for canonical determinism (SC-010). */
export function reduce({ num, den }: Rational): Rational {
  if (!Number.isInteger(num) || !Number.isInteger(den)) {
    throw new Error(`rational must be integers: ${num}/${den}`);
  }
  if (num <= 0 || den <= 0) {
    throw new Error(`rational must be positive: ${num}/${den}`);
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/** Parse an exact rate string such as "24000/1001" — already exact, so keep it exact. */
export function parseRate(str: string): Rational {
  const m = String(str).match(/^(\d+)\/(\d+)$/);
  if (!m) throw new Error(`unparseable frame rate: ${str}`);
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (den === 0 || num === 0) throw new Error(`degenerate frame rate: ${str}`);
  return reduce({ num, den });
}

/** Serialize back to "24000/1001". */
export const formatRate = ({ num, den }: Rational): string => `${num}/${den}`;

/**
 * Exact equality by cross-multiplication. Never compare rates as floats:
 * 24000/1001 and 24/1 are different rates, and a float comparison of two
 * near-identical rates is a coin toss the constitution does not permit.
 */
export const rateEquals = (a: Rational, b: Rational): boolean =>
  a.num * b.den === b.num * a.den;

/**
 * Full double expansion for OTIO's `rate` field, which is a float, not a
 * rational pair. Emit every digit JS has — 23.976023976023978, never 23.976.
 *
 * The spike proved (F12) that Resolve recovers exact frames from this for
 * 24000/1001. This was the plan's biggest risk and it is retired — but the
 * lossiness lives HERE, at the projection boundary, and must never travel back
 * into the canonical model.
 */
export const toOtioRate = ({ num, den }: Rational): number => num / den;

/** The rates the app supports. Anything else is refused rather than approximated. */
export const SUPPORTED_RATES: readonly Rational[] = [
  { num: 24000, den: 1001 }, // 23.976 — what a camera labels "24"
  { num: 24, den: 1 },
  { num: 25, den: 1 },
  { num: 30000, den: 1001 }, // 29.97
  { num: 30, den: 1 },
  { num: 50, den: 1 },
  { num: 60000, den: 1001 }, // 59.94
  { num: 60, den: 1 },
];

export const isSupportedRate = (rate: Rational): boolean =>
  SUPPORTED_RATES.some((r) => rateEquals(r, rate));
