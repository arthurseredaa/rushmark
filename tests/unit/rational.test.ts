/**
 * [CONST] Constitution Principle I — mandated verification (task T017).
 *
 * "Frame rates MUST be stored and carried as exact rationals (24000/1001), never
 *  as floats (23.976). Rate equality MUST be compared as a.num*b.den ==
 *  b.num*a.den, never as float comparison."
 *
 * These tests are not optional and may not be deleted to make a refactor pass.
 */

import {
  SUPPORTED_RATES,
  formatRate,
  isSupportedRate,
  parseRate,
  rateEquals,
  reduce,
  toOtioRate,
} from '@/domain/rational';

describe('reduce', () => {
  it('reduces to lowest terms so identical rates serialize identically (SC-010)', () => {
    expect(reduce({ num: 48000, den: 2002 })).toEqual({ num: 24000, den: 1001 });
    expect(reduce({ num: 48, den: 2 })).toEqual({ num: 24, den: 1 });
  });

  it('leaves an already-reduced rate untouched', () => {
    expect(reduce({ num: 24000, den: 1001 })).toEqual({ num: 24000, den: 1001 });
  });

  it('refuses non-integer components rather than rounding them', () => {
    expect(() => reduce({ num: 23.976, den: 1 })).toThrow(/must be integers/);
  });

  it('refuses zero and negative components', () => {
    expect(() => reduce({ num: 0, den: 1 })).toThrow(/must be positive/);
    expect(() => reduce({ num: 24, den: 0 })).toThrow(/must be positive/);
    expect(() => reduce({ num: -24, den: 1 })).toThrow(/must be positive/);
  });
});

describe('parseRate', () => {
  it('parses an exact rate string', () => {
    expect(parseRate('24000/1001')).toEqual({ num: 24000, den: 1001 });
  });

  it('round-trips through formatRate for every supported rate', () => {
    for (const rate of SUPPORTED_RATES) {
      expect(parseRate(formatRate(rate))).toEqual(rate);
    }
  });

  it('refuses a decimal rate — the whole point of Principle I', () => {
    expect(() => parseRate('23.976')).toThrow(/unparseable/);
    expect(() => parseRate('24')).toThrow(/unparseable/);
  });

  it('refuses a degenerate rate', () => {
    expect(() => parseRate('24000/0')).toThrow(/degenerate/);
    expect(() => parseRate('0/1001')).toThrow(/degenerate/);
  });
});

describe('rateEquals', () => {
  it('distinguishes 24000/1001 from 24/1 — a float compare would not', () => {
    expect(rateEquals({ num: 24000, den: 1001 }, { num: 24, den: 1 })).toBe(false);
  });

  it('distinguishes 30000/1001 from 30/1 and 60000/1001 from 60/1', () => {
    expect(rateEquals({ num: 30000, den: 1001 }, { num: 30, den: 1 })).toBe(false);
    expect(rateEquals({ num: 60000, den: 1001 }, { num: 60, den: 1 })).toBe(false);
  });

  it('equates unreduced forms of the same rate', () => {
    expect(rateEquals({ num: 48000, den: 2002 }, { num: 24000, den: 1001 })).toBe(true);
  });

  it('is reflexive across every supported rate and distinguishes all pairs', () => {
    for (const a of SUPPORTED_RATES) {
      expect(rateEquals(a, a)).toBe(true);
      for (const b of SUPPORTED_RATES) {
        if (a === b) continue;
        expect(rateEquals(a, b)).toBe(false);
      }
    }
  });
});

describe('toOtioRate', () => {
  it('emits the full double expansion, never a truncated 23.976 (spike F12)', () => {
    const value = toOtioRate({ num: 24000, den: 1001 });
    expect(value).toBe(24000 / 1001);
    expect(String(value)).toBe('23.976023976023978');
    expect(String(value)).not.toBe('23.976');
  });

  it('is exact for integer rates', () => {
    expect(toOtioRate({ num: 24, den: 1 })).toBe(24);
    expect(toOtioRate({ num: 60, den: 1 })).toBe(60);
  });

  it('survives a float round-trip for every supported rate', () => {
    // The projection boundary is the ONLY place a rate becomes a float. This
    // asserts the value we hand OTIO is recoverable, which is what makes F12
    // hold: parsing our emitted digits back yields the identical double.
    for (const rate of SUPPORTED_RATES) {
      const asFloat = toOtioRate(rate);
      expect(Number(JSON.parse(JSON.stringify(asFloat)))).toBe(asFloat);
      expect(Number(String(asFloat))).toBe(asFloat);
    }
  });
});

describe('isSupportedRate', () => {
  it('accepts the rates the app supports', () => {
    expect(isSupportedRate({ num: 24000, den: 1001 })).toBe(true);
    expect(isSupportedRate({ num: 60, den: 1 })).toBe(true);
  });

  it('rejects an unsupported rate rather than snapping it to a near neighbour', () => {
    expect(isSupportedRate({ num: 23, den: 1 })).toBe(false);
    expect(isSupportedRate({ num: 48, den: 1 })).toBe(false);
  });
});
