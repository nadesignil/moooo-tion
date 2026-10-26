// Style presets of «Настройки проекта». A preset is a starting point: choosing one
// fills the ban list, which the user then edits freely. The agent gets the note and
// the bans in its contract. Data only — shared by the studio and the server.

export type StylePreset = {id: string; title: string; note: string; bans: string[]};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'standard',
    title: 'Стандартный моушен',
    note: 'чистый продуктовый моушен: плавные выверенные кривые, понятные переходы, умеренный темп, без лишних эффектов.',
    bans: ['частицы и конфетти', 'свечения и glow'],
  },
  {
    id: 'reference',
    title: 'Как в референсе',
    note: 'повтори механику, кривые, ритм и переходы приложенных референсов; приёмов, которых в них нет, не добавляй.',
    bans: [],
  },
  {
    id: 'dribbble-ui',
    title: 'Dribbble UI',
    note: 'одна форма морфится, а не режется; пружины с крошечным перелётом; курсор ведёт изменения; без свечений и градиентов на интерфейсе.',
    bans: ['кроссфейды между сценами', 'свечения и glow', 'градиенты на интерфейсе', 'частицы и конфетти', 'блюр-появления'],
  },
  {
    id: 'apple-keynote',
    title: 'Apple keynote',
    note: 'один непрерывный дубль, каждая сцена вырастает из предыдущей; строгие кривые; никаких фейдов и блюр-появлений.',
    bans: ['фейды и кроссфейды', 'блюр-появления', 'жёсткие склейки', 'пружины с заметным перелётом', 'частицы и конфетти'],
  },
  {
    id: 'editorial',
    title: 'Editorial',
    note: 'сдержанно, один акцентный цвет, крупная типографика, медленные точные движения.',
    bans: ['пружины и «поп»', 'больше одного акцентного цвета', 'тряска камеры', 'свечения и glow', 'частицы и конфетти'],
  },
  {id: 'custom', title: 'Свой', note: '', bans: []},
];

/** suggestions offered as chips besides the preset's own bans */
export const BAN_SUGGESTIONS = [
  'кроссфейды между сценами',
  'фейды и кроссфейды',
  'блюр-появления',
  'свечения и glow',
  'градиенты на интерфейсе',
  'частицы и конфетти',
  'тряска камеры',
  'жёсткие склейки',
  'пружины и «поп»',
  'пружины с заметным перелётом',
  'вращение 3D',
  'текст по буквам',
  'больше одного акцентного цвета',
];

export const stylePreset = (id?: string) => STYLE_PRESETS.find((p) => p.id === id);

/** roles of the asset bin (inputs/assets.json): what a file is for */
export const ASSET_ROLES: Record<string, string> = {
  hero: 'главный объект',
  screen: 'экран / мокап',
  logo: 'логотип',
  icon: 'иконка',
  photo: 'фото',
  background: 'фон',
  video: 'видео',
  music: 'музыка',
  sfx: 'звук',
  font: 'шрифт',
  reference: 'референс',
  other: 'прочее',
};
