import fs from 'node:fs/promises';
import path from 'node:path';
import type {ProjectSettings, ScreenTemplate} from '../runtime/manifest';
import {PROJECTS, projectDir} from './paths';

const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export const slugify = (title: string) =>
  title
    .toLowerCase()
    .split('')
    .map((c) => MAP[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';

export const uniqueId = async (title: string) => {
  const base = slugify(title);
  let id = base;
  for (let i = 2; ; i++) {
    const exists = await fs.access(path.join(PROJECTS, id)).then(() => true, () => false);
    if (!exists) return id;
    id = `${base}-${i}`;
  }
};

const FILES: Record<string, (title: string) => string> = {
  'tsconfig.json': () => `{
  "extends": "../../tsconfig.json",
  "include": ["src", "../../runtime"]
}
`,
  'src/moootion.ts': () => `// Studio runtime: manifest types, timeline hooks, asset resolver.\nexport * from '../../../runtime';\n`,
  'src/index.ts': () => `// Render entry (Remotion CLI / @remotion/renderer).\nimport {registerRoot} from 'remotion';\nimport {Root} from './Root';\n\nregisterRoot(Root);\n`,
  'src/Root.tsx': () => `import {Composition} from 'remotion';
import manifest from '../project.json';
import {ProjectVideo, projectFrames, type Project} from './moootion';
import {stages} from './project';

const Video: React.FC<{project: Project}> = ({project}) => <ProjectVideo project={project} stages={stages} />;

export const Root: React.FC = () => (
  <Composition
    id="Project"
    component={Video}
    defaultProps={{project: manifest as unknown as Project}}
    durationInFrames={projectFrames(manifest as unknown as Project)}
    fps={manifest.fps}
    width={manifest.width}
    height={manifest.height}
    calculateMetadata={({props}) => ({
      durationInFrames: projectFrames(props.project),
      fps: props.project.fps,
      width: props.project.width,
      height: props.project.height,
    })}
  />
);
`,
  'src/project.tsx': () => `// Project entry for the studio: scene id → stage component.
import type {Stages} from './moootion';
import {Scene1} from './stages/Scene1';

export const stages: Stages = {
  'scene-1': Scene1,
};
`,
  'src/stages/Scene1.tsx': () => `// Заготовка: агент заменит её настоящей сценой.
// Каждый объект сцены живёт в своём <Layer name> — имя совпадает с полем layer его действий.
import {AbsoluteFill} from 'remotion';
import {Layer, num, str, useTimeline} from '../moootion';

export const Scene1: React.FC = () => {
  const {at} = useTimeline();
  const t = at('title-in');
  return (
    <AbsoluteFill>
      <Layer name="Фон">
        <AbsoluteFill style={{background: 'linear-gradient(180deg, #2b2b31, #000)'}} />
      </Layer>
      <Layer name="Титр" style={{alignItems: 'center', justifyContent: 'center'}}>
        <div
          style={{
            color: '#fff',
            fontFamily: str(t.params.font, 'system-ui, sans-serif'),
            fontWeight: 600,
            fontSize: num(t.params.size, 120),
            letterSpacing: -3,
            opacity: t.p,
            transform: \`translateY(\${(1 - t.p) * 60}px)\`,
          }}
        >
          {str(t.params.text, 'Новый проект')}
        </div>
      </Layer>
    </AbsoluteFill>
  );
};
`,
};

export const scaffoldProject = async (
  id: string,
  title: string,
  opts: {targetSeconds?: number; settings?: ProjectSettings; width?: number; height?: number; fps?: number} = {},
) => {
  const dir = projectDir(id);
  await fs.mkdir(path.join(dir, 'src', 'stages'), {recursive: true});
  await fs.mkdir(path.join(dir, 'public', 'img'), {recursive: true});
  await fs.mkdir(path.join(dir, 'inputs'), {recursive: true});
  await fs.mkdir(path.join(dir, 'public', 'audio'), {recursive: true});
  for (const [file, make] of Object.entries(FILES)) {
    await fs.writeFile(path.join(dir, file), make(title), 'utf8');
  }
  const manifest = {
    id,
    title,
    fps: opts.fps ?? 60,
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    ...(opts.targetSeconds ? {targetSeconds: opts.targetSeconds} : {}),
    ...(opts.settings ? {settings: opts.settings} : {}),
    scenes: [
      {
        id: 'scene-1',
        title: 'Сцена 1',
        duration: 4,
        groups: [{id: 'g-1', title: 'Заготовка', from: 0, to: 4}],
        actions: [
          {
            id: 'title-in',
            title: 'Заголовок появляется',
            layer: 'Титр',
            effect: 'appear.rise',
            start: 0.3,
            duration: 0.8,
            curve: {type: 'bezier', v: [0.16, 1, 0.3, 1]},
            params: {text: title, size: 120, font: 'system-ui, sans-serif'},
          },
        ],
        layers: [],
        backlog: [],
      },
    ],
  };
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return dir;
};

// ── «Оживление скриншота»: N variants of one screen ──

const VARIANT_STAGE = `// Заготовка варианта: агент заменит её своей хореографией.
// Фон — <Backdrop /> (его настраивает пользователь), экран — в <DeviceMockup>, если мокап выбран.
import {AbsoluteFill} from 'remotion';
import {Backdrop, DeviceMockup, Layer, useProject, useTimeline} from '../moootion';

const Placeholder: React.FC = () => (
  <div
    style={{
      width: 393,
      height: 852,
      background: '#f2f2f4',
      display: 'grid',
      placeItems: 'center',
      color: '#888',
      font: '500 22px system-ui, sans-serif',
    }}
  >
    Экран появится после сборки
  </div>
);

export const Variant: React.FC = () => {
  const {at} = useTimeline();
  const t = at('screen-in');
  const project = useProject();
  const lift = {opacity: Math.min(1, t.p * 1.4), transform: \`translateY(\${(1 - t.p) * 90}px) scale(\${0.94 + 0.06 * t.p})\`};
  return (
    <AbsoluteFill>
      <Layer name="3 · Фон">
        <Backdrop />
      </Layer>
      <Layer name="1 · Экран" style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={lift}>
          {project?.screen?.mockup ? (
            <DeviceMockup contentWidth={393}>
              <Placeholder />
            </DeviceMockup>
          ) : (
            <div style={{borderRadius: 48, overflow: 'hidden', boxShadow: '0 40px 120px rgba(0,0,0,.35)', transform: 'scale(1.1)'}}>
              <Placeholder />
            </div>
          )}
        </div>
      </Layer>
    </AbsoluteFill>
  );
};
`;

export const scaffoldScreenProject = async (
  id: string,
  title: string,
  opts: {
    screen: ScreenTemplate;
    seconds: number;
    settings?: ProjectSettings;
    width: number;
    height: number;
    fps: number;
  },
) => {
  const dir = await scaffoldProject(id, title, {settings: opts.settings, width: opts.width, height: opts.height, fps: opts.fps});
  await fs.rm(path.join(dir, 'src', 'stages', 'Scene1.tsx'), {force: true});
  await fs.writeFile(path.join(dir, 'src', 'stages', 'Variant.tsx'), VARIANT_STAGE, 'utf8');
  const n = opts.screen.variants;
  const ids = Array.from({length: n}, (_, i) => `v-${i + 1}`);
  await fs.writeFile(
    path.join(dir, 'src', 'project.tsx'),
    `// Варианты экрана: id сцены → компонент. Агент заведёт по компоненту на вариант.
import type {Stages} from './moootion';
import {Variant} from './stages/Variant';

export const stages: Stages = {
${ids.map((v) => `  '${v}': Variant,`).join('\n')}
};
`,
    'utf8',
  );
  const d = opts.seconds;
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'));
  manifest.template = 'screen';
  manifest.screen = opts.screen;
  manifest.targetSeconds = d;
  manifest.scenes = ids.map((v, i) => ({
    id: v,
    title: `Вариант ${i + 1}`,
    duration: d,
    groups: [{id: 'g-1', title: 'Вариант', from: 0, to: d}],
    actions: [
      {
        id: 'screen-in',
        title: 'Экран появляется',
        layer: '1 · Экран',
        effect: 'appear.rise',
        start: 0.2,
        duration: 0.9,
        curve: {type: 'spring', damping: 16, stiffness: 110},
        params: {},
      },
    ],
    layers: [],
    backlog: [],
  }));
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return dir;
};
