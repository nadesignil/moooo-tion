// Seed of the effect catalog: id → human name and role. Roles drive the
// "replace with…" suggestions; the agent can add new effects any time.
export type Role = 'appear' | 'disappear' | 'transform' | 'camera' | 'swap' | 'click' | 'react';

export const ROLE_NAMES: Record<Role, string> = {
  appear: 'Появление',
  disappear: 'Исчезновение',
  transform: 'Перемещение',
  camera: 'Камера',
  swap: 'Смена вида',
  click: 'Нажатие',
  react: 'Жизнь',
};

export const EFFECTS: Record<string, {name: string; hint: string}> = {
  'appear.fade': {name: 'Проявление', hint: 'из прозрачности'},
  'appear.pop': {name: 'Поп', hint: 'из точки с перелётом'},
  'appear.popSpin': {name: 'Поп с поворотом', hint: 'иконка вкручивается'},
  'appear.rise': {name: 'Подъём', hint: 'снизу на несколько px'},
  'appear.rise3d': {name: 'Выезд с наклоном', hint: 'снизу, наклон по X'},
  'appear.fromDepth': {name: 'Из глубины', hint: 'масштаб 1.3→1 и блюр'},
  'appear.slideFrom': {name: 'Въезд', hint: 'из-за края кадра'},
  'appear.maskReveal': {name: 'Раскрытие маской', hint: 'слева направо'},
  'appear.wave': {name: 'Волна по буквам', hint: 'буквы поднимаются по очереди'},
  'appear.growFrom': {name: 'Рост из элемента', hint: 'из точки другого объекта'},
  'appear.fanFrom': {name: 'Веер', hint: 'раскрывается из карточки'},
  'disappear.fade': {name: 'Затухание', hint: 'в прозрачность'},
  'disappear.slideTo': {name: 'Уход за край', hint: 'вверх, вниз или в сторону'},
  'disappear.sink': {name: 'Опускание', hint: 'вниз с затуханием'},
  'disappear.toDepth': {name: 'В глубину', hint: 'уменьшение и блюр'},
  'disappear.collapseInto': {name: 'Втягивание', hint: 'в другой объект'},
  'transform.move': {name: 'Перемещение', hint: 'в новую позу'},
  'transform.spring': {name: 'Пружина', hint: 'в позу с доводкой'},
  'transform.landInto': {name: 'Посадка в слот', hint: 'догоняет движущуюся цель'},
  'camera.push': {name: 'Наезд / отъезд', hint: 'мягкое «дыхание»'},
  'swap.color': {name: 'Смена цвета', hint: 'текст и иконка'},
  'swap.crossfade': {name: 'Подмена слоя', hint: 'без мигания'},
  'click.press': {name: 'Нажатие сжатием', hint: 'сжатие и возврат'},
  'click.highlight': {name: 'Нажатие высветлением', hint: 'подсветка поверхности'},
  'click.darken': {name: 'Нажатие затемнением', hint: 'затемнение поверхности'},
  'click.release': {name: 'Отпускание', hint: 'пружинит обратно'},
  'react.drift': {name: 'Дрейф', hint: 'медленная «жизнь»'},
  'react.float': {name: 'Покачивание', hint: 'парит на месте'},
};

export const effectName = (id?: string) => (id ? (EFFECTS[id]?.name ?? id) : 'Своё движение');

export const roleOf = (id?: string): Role | null => (id ? (id.split('.')[0] as Role) : null);

/** alternatives of the same role, the action's own variants first */
export const alternatives = (id: string | undefined, own: string[] = []) => {
  const role = roleOf(id);
  const same = Object.keys(EFFECTS).filter((e) => e !== id && roleOf(e) === role && !own.includes(e));
  return [...own, ...same];
};
