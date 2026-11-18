const BOUNDARY_EPS = 1e-12;

/**
 * Normalizes a probability threshold (e.g. from a range slider) to 4 decimal places
 * so IEEE-754 drift (like 0.58 + 0.02 = 0.6000000000000001) never corrupts comparisons.
 */
export function normalizeThreshold(threshold: number): number {
  const clamped = Math.min(0.95, Math.max(0.5, Number(threshold) || 0.62));
  return Math.round(clamped * 10000) / 10000;
}

/**
 * Authoritative classification rule:
 * - If REAL >= threshold (and REAL >= FAKE): REAL
 * - If FAKE >= threshold (and FAKE > REAL): FAKE
 * - Otherwise: UNCERTAIN
 * Note: Uses 1e-12 strictly to guard exact binary representation drift (e.g. 1 - 0.46),
 * never to push values like 0.5396 above 0.54.
 */
export function classifyProbabilityWithThreshold(
  probReal: number,
  probFake: number,
  threshold: number,
  insufficientFeatures = false
): {
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  raw_label: 'REAL' | 'FAKE';
  compared_probability: number;
  rule_applied: 'REAL >= threshold' | 'FAKE >= threshold' | 'BELOW_THRESHOLD' | 'INSUFFICIENT_FEATURES';
} {
  const normThreshold = normalizeThreshold(threshold);
  const raw_label: 'REAL' | 'FAKE' = probFake >= 0.5 ? 'FAKE' : 'REAL';
  const compared_probability = Math.max(probReal, probFake);

  if (insufficientFeatures) {
    return {
      prediction: 'UNCERTAIN',
      raw_label,
      compared_probability,
      rule_applied: 'INSUFFICIENT_FEATURES',
    };
  }

  if (probReal + BOUNDARY_EPS >= normThreshold && probReal >= probFake) {
    return {
      prediction: 'REAL',
      raw_label,
      compared_probability,
      rule_applied: 'REAL >= threshold',
    };
  }

  if (probFake + BOUNDARY_EPS >= normThreshold && probFake > probReal) {
    return {
      prediction: 'FAKE',
      raw_label,
      compared_probability,
      rule_applied: 'FAKE >= threshold',
    };
  }

  return {
    prediction: 'UNCERTAIN',
    raw_label,
    compared_probability,
    rule_applied: 'BELOW_THRESHOLD',
  };
}

/**
 * Formats a probability (0..1) as a percentage string while preventing misleading rounding
 * at the threshold boundary (e.g., 0.5396 will format as "53.96%" rather than "54.0%"
 * when compared against a 54% threshold).
 */
export function formatProbabilityPct(prob: number, threshold?: number): string {
  const pct = Math.max(0, Math.min(100, prob * 100));
  if (threshold !== undefined) {
    const normThresh = normalizeThreshold(threshold);
    const threshPct = normThresh * 100;
    if (prob + BOUNDARY_EPS < normThresh && Number(pct.toFixed(1)) >= Number(threshPct.toFixed(1))) {
      for (const decimals of [2, 3, 4]) {
        if (Number(pct.toFixed(decimals)) < threshPct) {
          return `${pct.toFixed(decimals)}%`;
        }
      }
      return `${pct.toFixed(4)}%`;
    }
  }
  return `${pct.toFixed(1)}%`;
}

export function formatRawProbabilityPct(prob: number): string {
  const pct = Math.max(0, Math.min(100, prob * 100));
  return `${pct.toFixed(4)}%`;
}

export function formatThresholdPct(threshold: number): string {
  const pct = normalizeThreshold(threshold) * 100;
  return Number.isInteger(pct) ? `${pct.toFixed(0)}%` : `${Number(pct.toFixed(2))}%`;
}
