import fs from 'node:fs/promises';
import path from 'node:path';
import type {Project} from '../runtime/manifest';
import {projectDir} from './paths';

// Editorial summaries of source techniques, not executable third-party instructions.
export const MOTION_RECIPES = [
 {id:'continuous-ui',tags:['dribbble','morph','морф','интерфейс','ui','курсор'],source:'https://github.com/yihui-dev/awesome-opus5-5-videos/blob/main/prompts/twoclipping-402193.md',note:'Сохраняй идентичность объекта между состояниями. Действие пользователя вызывает изменение формы; камера сопровождает главное событие. Малый перелёт пружины и непрерывная скорость важнее количества эффектов.'},
 {id:'container-content',tags:['карточ','контейнер','письм','mail','текст','перекры'],source:'https://github.com/yihui-dev/awesome-opus5-5-videos/blob/main/prompts/verbove-268381.md',note:'При преобразовании контейнера можно согласовать вступление и выход содержимого с изменением его геометрии. Это один из приёмов, а не обязательные два шага: синхронное и перекрывающееся движение также допустимо. Следи за столкновениями текста.'},
 {id:'beat-causality',tags:['музык','ритм','beat','bpm','трек','плотн'],source:'https://github.com/yihui-dev/awesome-opus5-5-videos/blob/main/prompts/twoclipping-402193.md',note:'Сначала разложи причинную последовательность событий по ритму, затем уточни кривые. Музыкальные акценты поддерживают главное действие. При отсутствии измеренной сетки не выдумывай BPM; оставь время на чтение.'},
 {id:'hero-camera',tags:['мокап','mockup','телефон','camera','keynote','камер'],source:'templates/demo/src/stages/GlavnayaPoisk.tsx',note:'Главный объект и камера могут двигаться синхронно с UI, с перекрытием или раздельно по смыслу. Следующая траектория связана с предыдущей. Вход и успокоение героя — возможный приём, а не обязательная структура каждого варианта.'},
] as const;
export const selectMotionRecipes=(project:Project,prompt:string)=>{
 const text=[project.title,project.template,project.screen?.preset,project.screen?.mockup?'мокап':'',project.settings?.style,project.settings?.styleNote,project.settings?.music?'музыка':'',prompt].join(' ').toLowerCase();
 return MOTION_RECIPES.map((recipe,index)=>({recipe,index,score:recipe.tags.filter(t=>text.includes(t)).length})).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,3).map(x=>x.recipe);
};
export const choreographyReview=(project:Project,hasPlan:boolean)=>{
 const warnings:string[]=[];
 if(!hasPlan)warnings.push('Нет .moootion/motion-plan.md: решения о хореографии не зафиксированы.');
 for(const scene of project.scenes){
  const moving=scene.actions.filter(a=>!/^screen\.(content|static)$/.test(a.effect ?? ''));
  if(!moving.length){warnings.push(`${scene.id}: движений нет; допустимо только для намеренно статичного результата.`);continue;}
  if(moving.length>=4 && new Set(moving.map(a=>a.effect)).size===1)warnings.push(`${scene.id}: одна механика на всех объектах; проверь причинность и различия траекторий, это не автоматический запрет.`);
  if(moving.filter(a=>/mask/i.test(a.effect ?? '')).length>moving.length/2)warnings.push(`${scene.id}: маски доминируют; обоснуй их геометрией/референсом, иначе замени механическое раскрытие постановкой.`);
  if(project.screen?.mockup&&!moving.some(a=>/телефон|мокап|камер|phone|mockup|camera/i.test(a.layer+' '+a.effect)))warnings.push(`${scene.id}: нет движения мокапа/камеры. Для анимации продумай вход героя или явно объясни намеренную неподвижность.`);
 }
 return {warnings,note:'Это эвристики по манифесту, а не оценка красоты или доказательство движения в коде. Проверь кадры и исходники.'};
};
export const codexChoreographyContext=async(project:Project,prompt:string)=>{
 const dir=path.join(projectDir(project.id),'.moootion');await fs.mkdir(dir,{recursive:true});
 const briefPath=path.join(dir,'brief.md');
 let brief=await fs.readFile(briefPath,'utf8').catch(()=>null);
 if(brief===null){
  brief=`# Восстановленные вводные (оригинальный бриф отсутствовал)\nЭто снимок текущего манифеста, не исходные слова пользователя.\n${JSON.stringify({title:project.title,template:project.template,screen:project.screen,settings:project.settings,targetSeconds:project.targetSeconds},null,2)}\nПоследний запрос:\n${prompt}`;
  await fs.writeFile(briefPath,brief,{encoding:'utf8',flag:'wx'}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});
 }
 const recipes=selectMotionRecipes(project,brief+' '+prompt);
 const context=`
## Режиссура движения — дополнение только для Codex
Последний запрос пользователя, запреты и приложенные референсы имеют приоритет над примерами ниже. Эффекты и примеры из общего контракта — словарь возможностей, а не готовый сценарий. Не повторяй автоматически набор «каскад / центр / маски».
- Сначала прочитай .moootion/brief.md. Сразу собирай и анимируй в одном запуске: обязательного этапа статичных поз, контактного листа и ожидания утверждения нет. Старые служебные указания о таком этапе в сохранённых брифах не применяй; требования пользователя к внешнему виду сохраняй.
- Перед кодом анимации запиши .moootion/motion-plan.md и кратко озвучь план в чате: задача варианта, главный объект, роль мокапа/камеры, причинность UI, тайминг и кривые, финальное состояние, используемые примеры и почему они подходят. Это рабочая запись внутри одного запуска, без ожидания подтверждения и без отдельного прогона.
- Различай варианты постановкой, иерархией акцентов и траекториями. Одна и та же механика, размноженная на все слои, не заменяет хореографию. Внутри осмысленного каскада единый приём допустим.
- Если есть мокап, осмысленно выбери его движение и связь с внутренним UI. Не оставляй телефон неподвижным просто потому, что он каркас: интенсивность регулирует уровни UI. Намеренная неподвижность, прямое указание пользователя и референс допустимы; объясни выбор. Явно утверждённые пользователем визуальные состояния сохраняются.
- По умолчанию предпочитай непрерывные перемещения, согласованные задержки и сдержанные кривые. Маски используй для раскрытия из реальной границы/окклюзии или по референсу; не режь все карточки одинаковой шторкой ради третьего варианта. Не запрещай маски как класс и не обходи запреты пользователя.
- Число фаз свободное. Не навязывай два шага «сначала мокап, потом UI» или «сначала контейнер, потом содержимое». Допустимы одно непрерывное движение, одновременная сборка, перекрывающиеся действия и более сложный ритм. Последовательность используй только когда она объясняет происходящее; не создавай паузу/второй запуск ради рецепта.
- На этапе анимации проверь начало, 25/50/75% каждого значимого движения, стыки и финал каждого варианта: читабельность, столкновения текста, обрезание, скорость и остановки. Проверка только последней позы недостаточна. Пиксельная метрика не оценивает выразительность. Используй studio_motion_review и исправь/объясни предупреждения.
- Время и кривые остаются в манифесте; всё детерминировано по кадру. Не переноси HTML/GSAP/таймеры из внешних примеров в рантайм Remotion. Новый эффект разрешён, если оправдан задачей.

### Подобранные приёмы (редакторские конспекты, не полный каталог 703 промптов)
${recipes.map(r=>`- ${r.id}: ${r.note} Источник: ${r.source}`).join('\n')}
`;
 await fs.writeFile(path.join(dir,'codex-motion-context.md'),context,'utf8');
 return context;
};
