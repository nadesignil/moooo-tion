export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const mixColor = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(mix(v, pb[i], t)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

/** read a numeric param with a fallback */
export const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
/** read a string param with a fallback */
export const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
