// Page space: the S7 main page in Figma design-context units (1 unit = 1 css px of the
// real site). Storyboard frames are this page seen through a camera
// (centre cx/cy in page units, scale s): screen = (P − C)·s + (960, 540).

export const PAGE_W = 1730;

export const TOP = {h: 368, radius: 100};
export const HEADER = {x: 16, y: 12, w: PAGE_W - 32, h: 68};
export const TABS_Y = 160;

// search form card (Figma «Search Form»)
export const FORM = {x: 261, y: 229.6, w: 1208, h: 180};
export const FIELDS_Y = FORM.y + 24 + 52 + 8; // 313.6
export const FIELD_H = 72;
export const DEST = {x: 285, w: 532}; // «Москва ⇄ Куда»
export const DATE = {x: 821, w: 264}; // «Когда»
export const PAX = {x: 1089, w: 264};
export const BTN = {x: 1357, w: 88};
export const FILTER_Y = FORM.y + FORM.h + 8;

// banner (Multi banner) and the image behind it
export const BANNER = {y: 267, h: 681};
export const HERO_IMG = {x: 0, y: 120.6, w: PAGE_W, h: 969};
export const BANNER_TEXT_X = (PAGE_W - 1148) / 2;
export const COINS = {x: 1006.9, y: 436.5, w: 358, h: 604.1};

export const WRAPPER_Y = 855;

// date picker: own units (Figma DatePicker 821 × 440), placed in page space
export const CAL = {x: 189, y: 333, k: 0.737, w: 821, h: 440};
export const CAL_PAD = 20;
export const MONTH_W = (CAL.w - 3 * CAL_PAD) / 2;
export const CELL_W = MONTH_W / 7;
export const CELL_H = 49.6;
export const ROWS_Y = 100;

/** centre of a day cell (month 0/1, col, row) in calendar units */
export const cellCenter = (month: number, col: number, row: number) => ({
  x: CAL_PAD + month * (MONTH_W + CAL_PAD) + (col + 0.5) * CELL_W,
  y: ROWS_Y + (row + 0.5) * CELL_H,
});

/** calendar units → page units */
export const calToPage = (p: {x: number; y: number}) => ({x: CAL.x + p.x * CAL.k, y: CAL.y + p.y * CAL.k});

export type Cam = {cx: number; cy: number; s: number; rx: number; ry: number; rz: number};

/** page point → screen (ignores the small 3D tilt; good enough for the cursor) */
export const toScreen = (cam: Cam, p: {x: number; y: number}) => {
  const a = (cam.rz * Math.PI) / 180;
  const dx = (p.x - cam.cx) * cam.s;
  const dy = (p.y - cam.cy) * cam.s;
  return {x: 960 + dx * Math.cos(a) - dy * Math.sin(a), y: 540 + dx * Math.sin(a) + dy * Math.cos(a)};
};
