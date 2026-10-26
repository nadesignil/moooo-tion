// Шрифт демо — TikTok Sans (SIL OFL 1.1, public/fonts/OFL.txt): вариативный по весу, латиница и кириллица.
// В оригинальном проекте был коммерческий шрифт; в раздаваемый эталон кладём только открытые.
import {asset} from './moootion';

export const FONT = 'DemoSans';

const faces = [
  {file: 'fonts/tiktok-sans-latin-wght-normal.woff2', range: 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2212'},
  {file: 'fonts/tiktok-sans-cyrillic-wght-normal.woff2', range: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116, U+20BD'},
];

let loading: Promise<void> | null = null;

export const loadFonts = () => {
  if (!loading) {
    loading = Promise.all(
      faces.map(async (f) => {
        const face = new FontFace(FONT, `url('${asset(f.file)}')`, {weight: '300 900', unicodeRange: f.range});
        await face.load();
        document.fonts.add(face);
      }),
    ).then(() => undefined);
  }
  return loading;
};
