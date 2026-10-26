const nf1 = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const nf2 = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});

/** 4,8 с */
export const sec = (s: number) => `${nf1.format(s)} с`;
/** 4,83 */
export const sec2 = (s: number) => nf2.format(s);
/** 0:04.8 style for the ruler */
export const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${nf1.format(r)}`;
};

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const nfTok = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});
/** 468 · 228 тыс. · 56,2 млн */
export const tokens = (n: number) =>
  n >= 1e6 ? `${nfTok.format(n / 1e6)} млн` : n >= 1e3 ? `${Math.round(n / 1e3)} тыс.` : String(n);
/** 42 с · 4 мин 12 с · 1 ч 3 мин */
export const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  if (s < 3600) return `${Math.floor(s / 60)} мин ${s % 60} с`;
  return `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин`;
};
/** $0,86 */
export const usd = (n: number) => `$${nf2.format(n)}`;

type TokenCounts = {input: number; output: number; cacheRead: number; cacheWrite: number};
export const tokenSum = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite;
/** «чтение кэша 54,8 млн · запись кэша 922 тыс. · вход 468 · ответ 228 тыс.» */
export const tokenBreakdown = (t: TokenCounts) =>
  `чтение кэша ${tokens(t.cacheRead)} · запись кэша ${tokens(t.cacheWrite)} · вход ${tokens(t.input)} · ответ ${tokens(t.output)}`;
