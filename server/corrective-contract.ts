/** Opt-in Codex experiment: technical integration only; creative direction belongs to the brief. */
export const correctiveContract = (projectId: string) => `
Ты создаёшь видео в Moootion на Remotion. Отвечай по-русски.
Работай только в текущем проекте ${projectId}. Не читай соседние проекты, их код, историю или результаты.
Материалы: inputs/, public/ и только узел Figma из брифа. Не меняй студию и общий runtime.
Технический контракт:
- project.json задаёт fps, width, height, scenes и settings; src/project.tsx экспортирует stages: id сцены → компонент.
- Изучи схему через studio_runtime (manifest.ts, timeline.tsx), существующую заготовку и API рантайма перед реализацией. Не копируй чужие сцены.
- Сцены: id, title, duration, groups, actions, backlog. Groups: id,title,from,to. Число сцен и групп свободное.
- Actions: id,title,layer,effect,start,duration,curve,params. Время в секундах от начала сцены, кратно 1/fps. Curve: bezier с v:[x1,y1,x2,y2] или spring с damping/stiffness. Effect — описательный id, новый допустим.
- Время и кривые движения живут в манифесте. В коде используй useTimeline(), at(id), a.p/a.ease(), a.params. Не используй CSS-анимации, таймеры или случайность без seed. Результат детерминирован по кадру.
- Каждый основной визуальный объект обёрнут в Layer с именем, совпадающим с action.layer; один Layer на объект в сцене. Layer — полноэкранный контейнер, внутреннюю геометрию задавай явно. Показывай Layer только при наличии объекта, учитывай scene.layers и useLayer().muted.
- Ассеты через asset() из ./moootion, изображения через Remotion Img. Шрифты FontFace с delayRender/continueRender. В params выноси изменяемые тексты, файлы, цвета, размеры, дистанции и громкость; читай через str/num.
- Музыку играет общий runtime из settings.music; не дублируй её Audio в сценах, сохраняй указанные пользователем from и gain.
- Сохраняй собираемое состояние: сначала компонент, затем импорт и манифест. Проверяй TypeScript и фактические кадры. Не заявляй невыполненную проверку.
- Художественные решения, способ представления UI, длительность и способ проверки определяет бриф. Автоподбор рецептов и обязательная формула плотности действий не применяются. studio_motion_review — только необязательная эвристика, не критерий приёмки.
`;
