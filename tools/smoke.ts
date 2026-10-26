// Release smoke test (CI and `moootion doctor`): scaffold a throwaway «Оживление скриншота» project with a shader
// background and the standard mockup, render one still, check it is a real picture, remove the project.
// It also makes Remotion download its headless browser into node_modules/.remotion, so the release carries it.
//   node node_modules/tsx/dist/cli.mjs tools/smoke.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {ScreenTemplateSchema} from '../runtime/manifest';
import {LIBRARY, projectDir} from '../server/paths';
import {CHROMIUM} from '../server/render';
import {readProject} from '../server/projects';
import {scaffoldScreenProject} from '../server/scaffold';

const id = `zz-smoke-${Date.now().toString(36)}`;
const dir = projectDir(id);
const fail = (msg: string) => {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exitCode = 1;
};

try {
  const meta = JSON.parse(await fs.readFile(path.join(LIBRARY, 'mockups', 'iphone-17-air', 'meta.json'), 'utf8'));
  const screen = ScreenTemplateSchema.parse({
    figmaUrl: 'https://www.figma.com/design/smoke/smoke?node-id=1-1',
    background: {type: 'shader', shader: 'flow', speed: 1},
    variants: 1,
    mockup: {material: 'iphone-17-air', file: 'mockup/iphone-17-air.png', size: meta.size, screen: meta.screen},
  });
  await scaffoldScreenProject(id, 'smoke', {screen, seconds: 2, width: 540, height: 675, fps: 30});
  await fs.mkdir(path.join(dir, 'public', 'mockup'), {recursive: true});
  await fs.copyFile(path.join(LIBRARY, 'mockups', 'iphone-17-air', 'device.png'), path.join(dir, 'public', 'mockup', 'iphone-17-air.png'));

  const t0 = Date.now();
  const serveUrl = await bundle({entryPoint: path.join(dir, 'src', 'index.ts'), publicDir: path.join(dir, 'public')});
  const project = await readProject(id);
  const inputProps = {project};
  const composition = await selectComposition({serveUrl, id: 'Project', inputProps, chromiumOptions: CHROMIUM});
  const out = path.join(dir, 'smoke.png');
  await renderStill({serveUrl, composition, inputProps, output: out, frame: 45, chromiumOptions: CHROMIUM});
  const size = (await fs.stat(out)).size;
  // a flat or empty frame compresses to almost nothing; shader + phone + screen give a real picture
  if (size < 20_000) fail(`кадр подозрительно маленький (${size} байт) — шейдер или мокап не отрисовались`);
  else console.log(`SMOKE OK: кадр ${size} байт за ${Date.now() - t0} мс (${process.platform}-${process.arch})`);
} catch (err) {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
} finally {
  await fs.rm(dir, {recursive: true, force: true});
}
