import {runSandbox,sandboxStatus} from './sandbox-executor';
import {contactSheet,composeImages,transformImage,maskImage,differenceMask,transcodeMedia} from './codex-media-workbench';
import {resolveCodexGuidance, codexGuidanceContract} from './astra-guidance';
import {codexChoreographyContext, choreographyReview} from './codex-choreography';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexClient, findCodex} from './codex';
import {ROOT, projectDir} from './paths';
import {readProject, writeProject} from './projects';
import {addAssets, type AssetEntry} from './assets';
import {downloadConnectorMedia, mediaUrlAllowed} from './codex-media';
import type {Job, LogLine} from './jobs';
import {codexConnectorTools, callCodexConnector, connectorId, magnificRead, guardedConnectorCall, exactCostEstimate} from './codex-connectors';

import {scopedPath} from './project-scope';
export {scopedPath} from './project-scope';
import {resolveProjectFont} from './project-fonts';
import {searchProject,patchProject,readShared,checkProject,mediaFrames,cropImage,compareImages,audioEnvelope} from './project-tools';
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function', name, description, inputSchema: {type: 'object', properties, required, additionalProperties: false},
});
const str = {type: 'string'};
const TOOLS = [
  tool('studio_executor_status','Check whether isolated Python/shell execution is available. Missing Docker is an error, never a host execution fallback.',{},[]),
  tool('studio_exec','Run arbitrary Python or POSIX shell in an isolated offline Linux container with Python, Pillow, NumPy, SciPy, OpenCV and FFmpeg. Select up to 64 project input files: copied read-only to /input/<relative path>. Write results only under /output. No host/sibling projects, secrets, network or package downloads; the studio runtime stays on the host. Results are published as NEW files in .moootion/executions; use studio_copy to adopt selected assets. stdout/stderr and exitCode are returned. Script must finish within timeoutSeconds (1–300, default 120). Check studio_executor_status first.',{language:{type:'string',enum:['python','shell']},code:str,inputs:{type:'array',items:str,maxItems:64},timeoutSeconds:{type:'integer',minimum:1,maximum:300}},['language','code','inputs']),
  tool('studio_contact_sheet','Create an aspect-preserving contact sheet of local project images. Interleave reference/result pairs. Returns image path and cell coordinates.',{paths:{type:'array',items:str,minItems:1,maxItems:32},columns:{type:'integer',minimum:1,maximum:8},cellWidth:{type:'integer',minimum:64,maximum:1920},cellHeight:{type:'integer',minimum:64,maximum:1080}},['paths','columns','cellWidth','cellHeight']),
  tool('studio_image_compose','Composite local images on a transparent canvas; explicit coordinates, sizes and optional opacity. Useful for overlays, screen assembly and side-by-side inspection. Nearest-neighbour scaling; transform first for smooth scaling.',{width:{type:'integer'},height:{type:'integer'},layers:{type:'array',minItems:1,maxItems:32,items:{type:'object',properties:{path:str,x:{type:'integer'},y:{type:'integer'},width:{type:'integer'},height:{type:'integer'},opacity:{type:'number'}},required:['path','x','y','width','height'],additionalProperties:false}}},['width','height','layers']),
  tool('studio_image_transform','Resize with Lanczos, rotate in 90 degree steps or flip a project image. One dimension preserves aspect ratio; both dimensions resize exactly. Returns a new PNG.',{path:str,width:{type:'integer'},height:{type:'integer'},rotation:{type:'integer',enum:[0,90,180,270]},flipX:{type:'boolean'},flipY:{type:'boolean'}},['path']),
  tool('studio_image_mask','Apply an equal-size local PNG/image as alpha or luminance mask to another image; optional invert. Saves transparent PNG, keeps originals.',{path:str,mask:str,mode:{type:'string',enum:['alpha','luminance']},invert:{type:'boolean'}},['path','mask','mode']),
  tool('studio_difference_mask','Create an equal-size black/white mask of RGB differences between local images. White means changed pixels. Inspect before masking; not semantic background removal.',{a:str,b:str,threshold:{type:'integer',minimum:0,maximum:255}},['a','b','threshold']),
  tool('studio_transcode','Transcode local video to browser-compatible H.264 MP4 in public/video. Trim input segment (defaults: from 0, seconds 60, max 600); resize width, set fps and speed 0.25–4. Muted by default, mute=false preserves audio with matching speed.',{path:str,from:{type:'number'},seconds:{type:'number'},width:{type:'integer'},fps:{type:'integer'},speed:{type:'number'},mute:{type:'boolean'}},['path']),
  tool('studio_motion_review','Review current manifest choreography: missing hero movement, repeated mechanics, mask dominance and motion plan. Heuristic warnings, not artistic scoring.',{},[]),
  tool('studio_refresh_figma','Reimport a Figma node when the user requests updated design data; replaces this project snapshot, never edits Figma.',{url:str},['url']),
  tool('studio_font','Resolve a required font from installed system fonts or Google Fonts into this project. Returns local files and FontFace descriptors; missing proprietary fonts must be supplied by the user, never silently substituted.',{family:str,weight:{type:'integer',minimum:100,maximum:900},style:{type:'string',enum:['normal','italic']}},['family']),

  tool('studio_plan','Publish the current task checklist in the studio chat.',{todos:{type:'array',items:{type:'object',properties:{content:str,status:{type:'string',enum:['pending','in_progress','completed']},activeForm:str},required:['content','status'],additionalProperties:false}}},['todos']),

  tool('studio_search','Find literal text in project source and metadata; returns paths and line numbers.',{text:str},['text']),
  tool('studio_patch','Replace an exact unique text fragment in a project file.',{path:str,before:str,after:str},['path','before','after']),
  tool('studio_shared','Read/list shared runtime/, templates/demo/ or library/. Read-only; neighboring projects are unavailable.',{path:str},['path']),
  tool('studio_check','Check project TypeScript and return diagnostics. Run before reporting completion.',{},[]),
  tool('studio_media_frames','Extract 1–12 stills from local video. Optional width 16–3840 (default 640); use larger width to inspect text and layout.',{path:str,times:{type:'array',items:{type:'number'},minItems:1,maxItems:12},width:{type:'integer',minimum:16,maximum:3840}},['path','times']),
  tool('studio_crop','Crop a project image for inspection.',{path:str,x:{type:'integer'},y:{type:'integer'},width:{type:'integer'},height:{type:'integer'}},['path','x','y','width','height']),
  tool('studio_compare','Create a pixel-difference image and compute MAE/RMSE for equal-sized project images.',{a:str,b:str},['a','b']),
  tool('studio_audio','Measure audio energy and candidate onsets over a project media segment up to 180 seconds.',{path:str,from:{type:'number'},seconds:{type:'number'}},['path','from','seconds']),

  tool('studio_list', 'List a directory of the current project. Paths are relative to the project.', {path: str}, ['path']),
  tool('studio_read', 'Read project text or an image. Use startLine/endLine to read large metadata in chunks.', {path:str,startLine:{type:'integer',minimum:1},endLine:{type:'integer',minimum:1}}, ['path']),
  tool('studio_write', 'Write UTF-8 text inside the project, creating parents. Full file content required.', {path: str, content: str}, ['path', 'content']),
  tool('studio_copy', 'Copy an asset inside the project (for example inputs/assets to public).', {from: str, to: str}, ['from', 'to']),
  tool('studio_runtime', 'Read a shared runtime source file (manifest.ts, timeline.tsx, styles.ts, backdrop.tsx).', {file: str}, ['file']),
  tool('studio_import_asset', 'Download a media URL returned by Figma/Magnific in this run into inputs/assets and register provenance. Only previously returned service media URLs can be imported; max 50MB.', {url:str,file:str}, ['url','file']),
  tool('studio_connector_tools', 'List Figma/Magnific tools; pass query with an exact tool name to retrieve its full input schema. If not connected, ask the user to connect in settings.', {connector:{type:'string',enum:['figma','magnific']},query:str}, ['connector']),
  tool('studio_connector_call', 'Call a discovered Figma or Magnific tool with exact arguments. Figma is read-only. Every non-read Magnific call waits for user approval. Call simulate_cost first.', {connector:{type:'string',enum:['figma','magnific']}, tool:str, arguments:{type:'object',additionalProperties:true}}, ['connector','tool','arguments']),
  tool('studio_still', 'Render one frame of the current project into .moootion/poses/<file>.png, then read with studio_read.', {frame: {type: 'integer', minimum: 0}, file: str}, ['frame', 'file']),
];
export const runCodex = async (o: {projectId: string; prompt: string; contract: string; signal: AbortSignal; job: Job; push: (kind: LogLine['kind'], text: string) => unknown; maxTurns?: number; approve?: (name:string,input:Record<string,unknown>,estimate?:string)=>Promise<boolean>}) => {
  const bin = await findCodex();
  if (!bin) throw new Error('Установите Codex CLI и войдите через настройки студии');
  const dir = projectDir(o.projectId);
  const profile = JSON.parse(await fs.readFile(path.join(dir, '.moootion', 'codex-run.json'), 'utf8').catch((e) => {if(e.code==='ENOENT')return '{}';throw e;}));

  const c = await new CodexClient(bin).init();
  let settled = false;
  let done!: (v: {summary?: string; error?: string}) => void;
  let fail!: (e: Error) => void;
  const completed = new Promise<{summary?: string; error?: string}>((resolve, reject) => {done = resolve; fail = reject;});
  // Prevent a rejected completion becoming unhandled while thread/start is pending.
  completed.catch(() => {});
  let summary = '';
  let connectorTail: Promise<unknown> = Promise.resolve();
  const estimates: {input:string;text:string}[] = [];
  const media = new Map<string,Pick<AssetEntry,'source'|'prompt'|'model'|'cost'>>();
  const connectorCall = async (a: Record<string, any>) => {
    const id = connectorId(a.connector);
    if (!a.arguments || typeof a.arguments !== 'object' || Array.isArray(a.arguments)) throw new Error('Нужен объект параметров');
    if (o.signal.aborted) throw new Error('stopped');
    const {pickEstimate} = await import('./jobs');
    const exact=exactCostEstimate(estimates,a.tool,a.arguments);
    if(id==='magnific'&&!magnificRead(a.tool)&&!exact)throw new Error('Сначала вызови simulate_cost для этого инструмента с теми же параметрами.');
    const response = await guardedConnectorCall(id,a.tool,a.arguments,async () => {
      if (o.signal.aborted) throw new Error('stopped');
      o.push('tool', `${id === 'figma' ? 'Figma' : 'Magnific'} · ${a.tool}`);
      return callCodexConnector(id,a.tool,a.arguments);
    },()=>o.approve?.(a.tool,a.arguments,pickEstimate(exact?[exact]:[],a.arguments)) ?? Promise.resolve(false));
    if (id === 'magnific' && a.tool === 'simulate_cost' && !response.isError) {
      const texts = response.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
      estimates.push({input:JSON.stringify(a.arguments),text:texts});
    }
    if (!response.isError) {
      const {findModel,pickEstimate} = await import('./jobs');
      const estimate = pickEstimate(estimates,a.arguments);
      const provenance = {source:id,prompt:typeof a.arguments.prompt === 'string' ? a.arguments.prompt : undefined,model:findModel(a.arguments),cost:id === 'magnific' && !magnificRead(a.tool) && estimate && /^\d/.test(estimate) ? parseFloat(estimate) : undefined};
      const collect = (v:unknown,depth=0) => {
        if(depth>12) return;
        if(typeof v==='string') for(const match of v.matchAll(/https:\/\/[^\s<>"'\\)]+/g)) {if(mediaUrlAllowed(match[0])) media.set(match[0],provenance);}
        else if(v && typeof v==='object') for(const x of Object.values(v)) collect(x,depth+1);
      };
      collect(response);
    }
    return {success:!response.isError,contentItems:[...(response.content??[]),...(response.structuredContent===undefined?[]:[{type:'text',text:JSON.stringify(response.structuredContent)}])].flatMap<{type:string;text?:string;imageUrl?:string}>((c:any)=>c.type==='text' ? [{type:'inputText',text:c.text}] : c.type==='image' ? [{type:'inputImage',imageUrl:`data:${c.mimeType};base64,${c.data}`}] : [{type:'inputText',text:JSON.stringify(c)}])};
  };
  const finish = (v: {summary?: string; error?: string}) => {if (!settled) {settled = true; done(v);}};
  const stop = () => {if (!settled) {settled = true; fail(new Error('stopped'));} c.close();};
  o.signal.addEventListener('abort', stop, {once: true});
  c.onClose = (e) => {if (!settled) {settled = true; fail(e);}};
  c.onEvent = (method, p) => {
    if (method === 'item/completed' && p.item?.type === 'agentMessage') {
      o.push('text', p.item.text);
      if (p.item.phase === 'final_answer') summary = p.item.text;
      else summary = p.item.text || summary;
    }
    if (method === 'thread/tokenUsage/updated') {
      const u = p.tokenUsage.total;
      o.job.tokens = {input: Math.max(0, u.inputTokens - u.cachedInputTokens), output: u.outputTokens, cacheRead: u.cachedInputTokens, cacheWrite: u.cacheWriteInputTokens ?? 0};
    }
    if (method === 'turn/completed') {
      o.job.turns = 1;
      finish(p.turn.status === 'completed' ? {summary} : {error: p.turn.error?.message ?? 'Codex прервал задачу'});
    }
    if (method === 'error' && !p.willRetry) finish({error: p.error?.message ?? 'Ошибка Codex'});
  };
  c.onRequest = async (method, p) => {
    // Built-in tools cannot escalate permissions or access configured MCP connectors.
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') return {decision: 'decline'};
    if (method === 'item/permissions/requestApproval') return {permissions: {}, scope: 'turn'};
    if (method !== 'item/tool/call') throw new Error('Недоступно');
    const a = p.arguments as Record<string, any>;
    if (o.signal.aborted) throw new Error('stopped');
    // No studio tool-call cap for Codex; user cancellation is enforced above.
    const result = (text: string) => ({success: true, contentItems: [{type: 'inputText', text}]});
    try {
      switch (p.tool) {
        case 'studio_executor_status': return result(JSON.stringify(await sandboxStatus()));
        case 'studio_exec': {
          o.push('tool',`Выполняет ${a.language} в изолированном контейнере`);
          const report=await runSandbox(o.projectId,a as any,o.signal);
          return {success:report.exitCode===0,contentItems:[{type:'inputText',text:JSON.stringify(report)}]};
        }
        case 'studio_contact_sheet': o.push('tool','Создаёт контакт-лист'); return result(JSON.stringify(await contactSheet(o.projectId,a as any,o.signal)));
        case 'studio_image_compose': o.push('tool','Совмещает изображения'); return result(JSON.stringify(await composeImages(o.projectId,a as any,o.signal)));
        case 'studio_image_transform': return result(JSON.stringify(await transformImage(o.projectId,a as any,o.signal)));
        case 'studio_image_mask': return result(JSON.stringify(await maskImage(o.projectId,a as any,o.signal)));
        case 'studio_difference_mask': return result(JSON.stringify(await differenceMask(o.projectId,a as any,o.signal)));
        case 'studio_transcode': o.push('tool','Перекодирует видео'); return result(JSON.stringify(await transcodeMedia(o.projectId,a as any,o.signal)));
        case 'studio_motion_review': return result(JSON.stringify(choreographyReview(await readProject(o.projectId),await fs.access(path.join(dir,'.moootion','motion-plan.md')).then(()=>true,()=>false))));
        case 'studio_refresh_figma': return result(JSON.stringify(await (await import('./figma-input')).prepareFigma(o.projectId,a.url,o.signal,true)));
        case 'studio_font': return result(JSON.stringify(await resolveProjectFont(o.projectId,a.family,a.weight??400,a.style??'normal',o.signal)));
        case 'studio_plan': o.push('todo',JSON.stringify(a.todos)); return result('План обновлён');
        case 'studio_search': return result(JSON.stringify(await searchProject(o.projectId,a.text)));
        case 'studio_patch': o.push('tool',`Правит ${a.path}`); return result(JSON.stringify(await patchProject(o.projectId,a.path,a.before,a.after)));
        case 'studio_shared': {
          const shared=await readShared(a.path);
          return shared.kind==='image'?{success:true,contentItems:[{type:'inputImage',imageUrl:shared.url}]}:result(shared.text??'');
        }
        case 'studio_check': return result(JSON.stringify(await checkProject(o.projectId,o.signal)));
        case 'studio_media_frames': return result(JSON.stringify(await mediaFrames(o.projectId,a.path,a.times,o.signal,a.width)));
        case 'studio_crop': return result(JSON.stringify(await cropImage(o.projectId,a.path,{x:a.x,y:a.y,width:a.width,height:a.height},o.signal)));
        case 'studio_compare': return result(JSON.stringify(await compareImages(o.projectId,a.a,a.b,o.signal)));
        case 'studio_audio': return result(JSON.stringify(await audioEnvelope(o.projectId,a.path,a.from,a.seconds,o.signal)));

        case 'studio_import_asset': {
          const provenance = media.get(a.url);
          if (!provenance) throw new Error('Сначала получите ссылку на ассет из подключённого сервиса');
          const data = await downloadConnectorMedia(a.url,o.signal);
          const assets = await addAssets(o.projectId,[{name:a.file,data}],undefined,provenance);
          return result(JSON.stringify(assets));
        }
        case 'studio_connector_tools': {
          const all=await codexConnectorTools(connectorId(a.connector));
          const selected=typeof a.query==='string'?all.filter(t=>t.name===a.query||t.name.includes(a.query)):[];
          return result(JSON.stringify(selected.length && selected.length<=8?selected:{tools:all.map(t=>({name:t.name,description:t.description.slice(0,180)})),note:'Для полной схемы передайте query с точным именем инструмента.'}));
        }
        case 'studio_connector_call': {
          const call = connectorTail.then(()=>connectorCall(a));
          connectorTail = call.catch(()=>undefined);
          return await call;
        }
        case 'studio_list': {
          const file = await scopedPath(dir, a.path);
          return result((await fs.readdir(file, {withFileTypes: true})).filter((d) => !['.git', 'node_modules'].includes(d.name)).map((d) => d.name + (d.isDirectory() ? '/' : '')).join('\n'));
        }
        case 'studio_read': {
          const file = await scopedPath(dir, a.path);
          const stat = await fs.stat(file);
          if (/\.(png|jpe?g|webp)$/i.test(file)) {
            if (stat.size > 10_000_000) throw new Error('Изображение больше 10MB');
            const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
            return {success: true, contentItems: [{type: 'inputImage', imageUrl: `data:image/${ext};base64,${(await fs.readFile(file)).toString('base64')}`}]};
          }
          if (stat.size > 5_000_000) throw new Error('Текстовый файл больше 5MB');
          const lines=(await fs.readFile(file,'utf8')).split('\n');
          const start=Math.max(1,Number.isInteger(a.startLine)?a.startLine:1);
          const end=Math.min(lines.length,Number.isInteger(a.endLine)?a.endLine:start+599,start+999);
          return result(JSON.stringify({path:a.path,startLine:start,endLine:end,totalLines:lines.length,text:lines.slice(start-1,end).join('\n')}));
        }
        case 'studio_write': {
          const file = await scopedPath(dir, a.path, true);
          if (a.path.split(/[\\/]/).some((s: string) => ['.git', 'node_modules'].includes(s))) throw new Error('Служебная папка');
          if (typeof a.content !== 'string' || a.content.length > 2_000_000) throw new Error('Неверное содержимое');
          o.push('tool', `Пишет ${a.path}`);
          if (file === path.join(dir, 'project.json')) await writeProject(o.projectId, JSON.parse(a.content));
          else {await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, a.content, 'utf8');}
          return result('Сохранено');
        }
        case 'studio_copy': {
          const from = await scopedPath(dir, a.from);
          const to = await scopedPath(dir, a.to, true);
          if (a.to.split(/[\\/]/).some((s: string) => ['.git', 'node_modules'].includes(s))) throw new Error('Служебная папка');
          await fs.mkdir(path.dirname(to), {recursive: true}); await fs.copyFile(from, to);
          return result('Скопировано');
        }
        case 'studio_runtime': {
          if (!['manifest.ts', 'timeline.tsx', 'math.ts', 'styles.ts', 'backdrop.tsx', 'index.ts', 'mockup.tsx', 'shaders.ts'].includes(a.file)) throw new Error('Недоступный файл рантайма');
          return result(await fs.readFile(path.join(ROOT, 'runtime', a.file), 'utf8'));
        }
        case 'studio_still': {
          if (!Number.isInteger(a.frame) || a.frame < 0 || !/^[\w-]+\.png$/.test(a.file)) throw new Error('Неверный кадр или имя файла');
          const rel = `.moootion/poses/${a.file}`;
          const output = await scopedPath(dir, rel, true);
          o.push('tool', `Рендерит кадр ${a.frame}`);
          await (await import('./render')).renderProjectStill(o.projectId,a.frame,output,o.signal);
          return result(rel);
        }
        default: throw new Error('Инструмент недоступен');
      }
    } catch (e) {return {success: false, contentItems: [{type: 'inputText', text: (e as Error).message}]};}
  };
  try {
    if (o.signal.aborted) throw new Error('stopped');
    // Disable inherited integrations, shell and plugins. Only studio-owned scoped tools are exposed.
    const cfg = (await c.request('config/read', {includeLayers: false})).config ?? {};
    const disabledMcp = Object.fromEntries(Object.keys(cfg.mcp_servers ?? {}).map((name) => [`mcp_servers.${name}.enabled`, false]));
    // Optional model override belongs to this project, never to the Claude provider.
    const requestedModel = profile.model;
    const catalog = await c.request('model/list', {limit: 100});
    if (requestedModel !== undefined && (typeof requestedModel !== 'string' || !catalog.data?.some((m: any) => m.model === requestedModel))) {
      throw new Error('Запрошенная модель Codex недоступна: ' + String(requestedModel));
    }
    const effectiveModel = requestedModel ?? cfg.model ?? catalog.data?.find((m: any) => m.isDefault)?.model;
    if (typeof effectiveModel !== 'string' || !effectiveModel) throw new Error('Не удалось определить модель Codex');
    const guidance = resolveCodexGuidance(effectiveModel, profile.guidance);
    const contract = await codexGuidanceContract(o.projectId, o.contract, guidance);
    const motionContext = guidance === 'legacy' ? await codexChoreographyContext(await readProject(o.projectId), o.prompt) : '';
    o.push('status', `Профиль Codex: ${guidance}`);
    const r = await c.request('thread/start', {
      model: effectiveModel,
      cwd: dir, ephemeral: true, approvalPolicy: 'untrusted', sandbox: 'read-only',
      config: {...disabledMcp, 'features.shell_tool': false, 'features.unified_exec': false, 'features.code_mode': false, 'features.code_mode_host': false, 'features.apps': false, 'features.plugins': false, web_search: 'disabled'},
      developerInstructions: contract + motionContext + '\nРаботай только инструментами studio_*. Shell хоста и соседние проекты недоступны. Для произвольного Python/shell сначала проверь studio_executor_status, затем используй studio_exec в изолированном контейнере. Входы доступны в /input, результаты записывай в /output. При недоступности исполнителя сообщи об этом; не пытайся обойти изоляцию. Figma и Magnific вызывай только через studio_connector_tools и studio_connector_call. studio_read читает текст и изображения; studio_write пишет полный файл; studio_still рендерит кадр. Общий рантайм читай studio_runtime или studio_shared. Для эталона используй studio_shared с templates/demo/. Для поиска/точечных правок доступны studio_search/studio_patch. Проверяй TypeScript через studio_check. Видео-референсы разбирай studio_media_frames, звук — studio_audio, детали кадра — studio_crop и studio_compare. Перед итогом обязательно проверь типы и кадры, затем перечисли проверенные файлы. Не заявляй готовность, если остались заглушки, отсутствующие ассеты или ошибки сборки. Для Figma сначала получи схему get_design_context/get_metadata/get_screenshot; записи в Figma запрещены. Для Magnific сначала изучи инструменты и вызови simulate_cost с параметрами будущего платного вызова; затем вызови платный инструмент один раз и дождись ответа карточки. После отказа не повторяй. Скачивай ссылки на готовые файлы инструментом studio_import_asset: он кладёт файл в корзину и сохраняет источник. При необходимости дополни prompt/model/cost в inputs/assets.json. Для creations_get/wait сохрани сведения исходной генерации. Если сервис не подключён — попроси подключить его в настройках студии. Команды Bash/CLI в базовом контракте обозначают операции: TodoWrite заменён studio_plan, tsc — studio_check, remotion still — studio_still, FFmpeg/Python: нарезка — studio_media_frames; контакт-листы — studio_contact_sheet; масштаб/поворот — studio_image_transform; композиция — studio_image_compose; маски — studio_difference_mask/studio_image_mask; перекодирование — studio_transcode; анализ — studio_crop/studio_compare/studio_audio, curl — studio_import_asset. Не вызывай shell хоста; произвольные программы запускай только studio_exec. Образ контейнера содержит библиотеки, сеть выключена; скачивать пакеты из сети в скрипте нельзя. Сначала читай подготовленный пакет inputs/figma/, затем эталон и рантайм. Для каждого семейства и начертания макета вызови studio_font и загрузи возвращённые файлы через FontFace с delayRender/continueRender; запасной шрифт не является точным совпадением. Если шрифт не найден, явно запроси файл и не заявляй идентичную типографику. Не меняй студию.',
      dynamicTools: TOOLS,
    });
    o.job.model = r.model;
    o.push('status', `Codex на связи · ${r.model}`);
    await c.request('turn/start', {threadId: r.thread.id, input: [{type: 'text', text: o.prompt}], approvalPolicy: 'untrusted', sandboxPolicy: {type: 'readOnly', networkAccess: false}});
    return await completed;
  } finally {o.signal.removeEventListener('abort', stop); settled = true; c.close();}
};
