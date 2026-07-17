// Exact rational frame rates. A rate is NEVER a float here.
// This module is the seed of src/domain/rational.ts.

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

/** Reduce to lowest terms — required for canonical determinism (SC-010). */
export function reduce({ num, den }) {
  if (!Number.isInteger(num) || !Number.isInteger(den)) {
    throw new Error(`rational must be integers: ${num}/${den}`);
  }
  if (num <= 0 || den <= 0) {
    throw new Error(`rational must be positive: ${num}/${den}`);
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/** Parse ffprobe's "24000/1001" — already exact, so keep it exact. */
export function parseRate(str) {
  const m = String(str).match(/^(\d+)\/(\d+)$/);
  if (!m) throw new Error(`unparseable frame rate: ${str}`);
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (den === 0 || num === 0) throw new Error(`degenerate frame rate: ${str}`);
  return reduce({ num, den });
}

/** Exact equality. Never compare rates as floats. */
export const rateEquals = (a, b) => a.num * b.den === b.num * a.den;

/**
 * Full double expansion for OTIO's `rate` field, which is a float, not a
 * rational pair. Emit every digit JS has — never a truncated 23.976.
 * Whether Resolve recovers exact frames from this is what the spike tests.
 */
export const toOtioRate = ({ num, den }) => num / den;
