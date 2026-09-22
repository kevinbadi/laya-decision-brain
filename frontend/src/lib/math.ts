export function softmax(logits: number[], temperature = 1): number[] {
  const z = logits.map((l) => l / temperature);
  const max = Math.max(...z);
  const e = z.map((v) => Math.exp(v - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

/** Laya's confidence: 1 - H(p) / log(k). */
export function confidence(p: number[]): number {
  const k = p.length;
  if (k < 2) return 1;
  const h = -p.reduce((acc, v) => acc + v * Math.log(Math.min(1, Math.max(v, 1e-12))), 0);
  return Math.min(1, Math.max(0, 1 - h / Math.log(k)));
}

export const argmax = (p: number[]) => p.reduce((best, v, i) => (v > p[best] ? i : best), 0);

export interface CalibrationBin {
  lo: number;
  hi: number;
  count: number;
  meanConf: number;
  accuracy: number;
}

/** Reliability bins on top-1 probability, plus Expected Calibration Error. */
export function calibration(topProbs: number[], correct: boolean[], bins = 10) {
  const out: CalibrationBin[] = Array.from({ length: bins }, (_, i) => ({
    lo: i / bins,
    hi: (i + 1) / bins,
    count: 0,
    meanConf: 0,
    accuracy: 0,
  }));
  topProbs.forEach((c, i) => {
    const b = out[Math.min(bins - 1, Math.floor(c * bins))];
    b.count += 1;
    b.meanConf += c;
    b.accuracy += correct[i] ? 1 : 0;
  });
  let ece = 0;
  for (const b of out) {
    if (b.count) {
      b.meanConf /= b.count;
      b.accuracy /= b.count;
      ece += (b.count / topProbs.length) * Math.abs(b.meanConf - b.accuracy);
    }
  }
  return { bins: out, ece };
}

export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export const fmt = (v: number, digits = 3) => v.toFixed(digits);
