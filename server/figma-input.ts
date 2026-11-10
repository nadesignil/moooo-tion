import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {projectDir} from './paths';
import {readSettings} from './settings';
import {callCodexConnector, codexConnectorTools, codexConnectorsStatus} from './codex-connectors';
import {downloadConnectorMedia, mediaUrlAllowed} from './codex-media';
import {addAssets} from './assets';

export type FigmaCode = 'ready'|'invalid'|'needs-auth'|'forbidden'|'not-found'|'rate-limited'|'unavailable'|'assets-missing';
export type FigmaCheck = {ok:boolean;code:FigmaCode;message:string;fileKey?:string;nodeId?:string;name?:string;source?:'mcp'|'rest'};
export class FigmaInputError extends Error {
  constructor(public check:FigmaCheck) {super(check.message);this.name='FigmaInputError';}
}
export const parseFigmaUrl = (value:string) => {
  const u=new URL(value);
  if(u.protocol!=='https:' || !['figma.com','www.figma.com'].includes(u.hostname) || u.username || u.password) throw new Error('Нужна HTTPS-ссылка Figma');
  const key=u.pathname.match(/^\/(?:design|file|proto)\/([a-zA-Z0-9]+)(?:\/|$)/)?.[1];
  const node=u.searchParams.get('node-id')?.replace('-',':');
  if(!key || !node || !/^\d+:\d+$/.test(node)) throw new Error('Нужна ссылка на конкретный узел Figma с node-id');
  return {fileKey:key,nodeId:node,url:`https://www.figma.com/design/${key}/?node-id=${node.replace(':','-')}`};
};
export const classifyFigmaError = (raw:string):FigmaCode => /429|rate.limit|quota/i.test(raw)?'rate-limited':/404|not.found|not exist/i.test(raw)?'not-found':/403|forbidden|permission|access.denied/i.test(raw)?'forbidden':/401|auth|log.?in|unauthori/i.test(raw)?'needs-auth':'unavailable';
const MESSAGES:Record<FigmaCode,string>={ready:'Узел Figma доступен',invalid:'Нужна ссылка на конкретный узел Figma с node-id','needs-auth':'Войдите в Figma в настройках подключений Codex и нажмите «Продолжить» у задачи.',forbidden:'Подключённый аккаунт Figma не имеет доступа к этому файлу. Проверьте аккаунт и права файла.','not-found':'Файл или узел Figma не найден. Проверьте node-id в ссылке.','rate-limited':'Figma временно ограничила запросы. Повторите позже.',unavailable:'Не удалось прочитать Figma. Проверьте подключение и повторите.','assets-missing':'Не все исходные ассеты Figma скачаны. Импорт сохранён; повторите подготовку исходников.'};
export const mcpResultText = (r:any) => [...(r.content??[]).filter((x:any)=>x.type==='text').map((x:any)=>x.text),...(r.structuredContent===undefined?[]:[JSON.stringify(r.structuredContent,null,2)])].join('\n');
/** Only response data, not service instructions/examples or transport metadata, are media sources. */
export const figmaAssetUrls=(outputs:any[])=>{
  const urls=new Set<string>();
  const visit=(v:unknown,depth=0)=>{
    if(depth>20)return;
    if(typeof v==='string')for(const m of v.matchAll(/https:\/\/[^\s<>"'\\)]+/g)){
      if(mediaUrlAllowed(m[0]) && (/\.(png|jpe?g|webp|svg|woff2?|ttf|otf)$/i.test(new URL(m[0]).pathname)||new URL(m[0]).pathname.startsWith('/api/mcp/asset/')))urls.add(m[0]);
    }else if(v&&typeof v==='object')for(const x of Object.values(v))visit(x,depth+1);
  };
  for(const o of outputs){visit(o.content?.[0]);visit(o.structuredContent);}
  return urls;
};
const checked = (r:any) => {if(r.isError) throw new Error(mcpResultText(r));return r;};
const api = async (route:string,token:string,signal?:AbortSignal) => {
  const r=await fetch(`https://api.figma.com/v1/${route}`,{headers:{'X-Figma-Token':token},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error(`Figma HTTP ${r.status}`);
  return r.json();
};
const toolArgs = (schema:any, fileKey:string,nodeId:string) => {
  const props=schema?.properties??{};const a:Record<string,unknown>={};
  const values:Record<string,unknown>={fileKey,file_key:fileKey,nodeId,node_id:nodeId,nodeIds:[nodeId],node_ids:[nodeId],clientFrameworks:'react',clientLanguages:'typescript',includeScreenshot:true,skillNames:'figma-design-to-code'};
  for(const k of Object.keys(props)) if(k in values) a[k]=values[k];
  for(const k of schema?.required??[]) if(!(k in a)) throw new Error(`Unsupported Figma parameter: ${k}`);
  return a;
};
const probe = async (value:string,signal?:AbortSignal) => {
  const parsed=parseFigmaUrl(value);const settings=await readSettings();
  if(settings.figmaToken) {
    const r=await api(`files/${parsed.fileKey}/nodes?ids=${encodeURIComponent(parsed.nodeId)}`,settings.figmaToken,signal);
    const node=r.nodes?.[parsed.nodeId]?.document;if(!node) throw new Error('404 node not found');
    return {...parsed,source:'rest' as const,metadata:r,node,tools:[] as any[]};
  }
  const status=await codexConnectorsStatus(true);
  const row=status.connectors.find(c=>c.id==='figma');
  if(row?.status==='needs-auth') throw new Error('401 needs authentication');
  const tools=await codexConnectorTools('figma');
  const tool=tools.find(t=>t.name==='get_metadata')??tools.find(t=>t.name==='get_design_context');
  if(!tool) throw new Error(row?.status==='failed'?'Figma MCP unavailable':'401 Figma has no available tools');
  const metadata=checked(await callCodexConnector('figma',tool.name,toolArgs(tool.inputSchema,parsed.fileKey,parsed.nodeId)));
  return {...parsed,source:'mcp' as const,metadata,node:null,tools};
};
export const checkFigma = async (value:string):Promise<FigmaCheck> => {
  try {parseFigmaUrl(value);} catch {return {ok:false,code:'invalid',message:MESSAGES.invalid};}
  try {const p=await probe(value);return {ok:true,code:'ready',message:MESSAGES.ready,fileKey:p.fileKey,nodeId:p.nodeId,name:p.node?.name,source:p.source};}
  catch(e) {const code=classifyFigmaError((e as Error).message);return {ok:false,code,message:MESSAGES[code]};}
};
export type FigmaSnapshot={version:1;url:string;fileKey:string;nodeId:string;source:'mcp'|'rest';capturedAt:string;directory:string;files:string[];assets:{file:string;path:string;url:string}[];warnings:string[];complete:boolean};
export const prepareFigma = async (projectId:string,value:string,signal:AbortSignal,refresh=false):Promise<FigmaSnapshot> => {
  let parsed:ReturnType<typeof parseFigmaUrl>;
  try {parsed=parseFigmaUrl(value);} catch {throw new FigmaInputError({ok:false,code:'invalid',message:MESSAGES.invalid});}
  const key=createHash('sha256').update(parsed.url).digest('hex').slice(0,16);
  const relative=`inputs/figma/${key}`;const dir=path.join(projectDir(projectId),relative);
  const manifestFile=path.join(dir,'snapshot.json');
  const previous=await fs.readFile(manifestFile,'utf8').then(t=>JSON.parse(t) as FigmaSnapshot).catch(()=>null);
  if(!refresh && previous?.complete && previous.url===parsed.url) {
    const present=await Promise.all(previous.files.map(f=>fs.access(path.join(dir,f)).then(()=>true,()=>false)));
    const assets=await Promise.all(previous.assets.map(a=>fs.access(path.join(projectDir(projectId),a.path)).then(()=>true,()=>false)));
    if(present.every(Boolean)&&assets.every(Boolean)) return previous;
  }
  if(!refresh && previous && !previous.complete && previous.source==='mcp' && previous.url===parsed.url && previous.files.includes('reference.png') && previous.files.includes('design-context.txt')) {
    const captured=await Promise.all(['metadata.json','get_design_context.json','get_screenshot.json','get_variable_defs.json'].map(f=>fs.readFile(path.join(dir,f),'utf8').then(t=>JSON.parse(t)).catch(()=>null)));
    const urls=figmaAssetUrls(captured.filter(Boolean));
    const screenshot=captured[2];
    try {const target=JSON.parse(screenshot?.content?.[0]?.text??'null');if(target?.image_url)urls.delete(target.image_url);}catch{}
    previous.assets=previous.assets.filter(a=>urls.has(a.url));
    previous.warnings=previous.warnings.filter(w=>!w.startsWith('Не скачан ассет:'));
    for(const url of urls) {
      if(previous.assets.some(a=>a.url===url && a.path))continue;
      try {
        const data=await downloadConnectorMedia(url,signal);const ext=new URL(url).pathname.match(/\.(png|jpe?g|webp|svg)$/i)?.[0]??'.png';
        const name=`figma-${createHash('sha256').update(url).digest('hex').slice(0,16)}${ext}`;
        const list=await addAssets(projectId,[{name,data}],undefined,{source:'figma'});const added=list.find(a=>a.file===name)??list.at(-1)!;
        previous.assets.push({file:added.file,path:added.path,url});
      }catch{previous.warnings.push(`Не скачан ассет: ${new URL(url).hostname}${new URL(url).pathname}`);}
    }
    previous.complete=previous.assets.length===urls.size;
    await fs.writeFile(manifestFile,JSON.stringify(previous,null,2));
    if(previous.complete)return previous;
    throw new FigmaInputError({ok:false,code:'assets-missing',message:MESSAGES['assets-missing']});
  }
  await fs.mkdir(dir,{recursive:true});
  let stage='metadata';
  try {
    if(signal.aborted) throw new Error('stopped');
    const p=await probe(value,signal);
    const snapshot:FigmaSnapshot={version:1,...parsed,source:p.source,capturedAt:new Date().toISOString(),directory:relative,files:[],assets:[],warnings:[],complete:false};
    const save=async (name:string,data:string|Buffer)=>{await fs.writeFile(path.join(dir,name),data);snapshot.files.push(name);};
    await save('metadata.json',JSON.stringify(p.metadata,null,2));
    const outputs:any[]=[p.metadata];
    const urls=new Set<string>();
    const referenceUrls=new Set<string>();
    if(p.source==='rest') {
      const settings=await readSettings();const token=settings.figmaToken!;
      const image=await api(`images/${p.fileKey}?ids=${encodeURIComponent(p.nodeId)}&format=png&scale=1`,token,signal);
      const url=image.images?.[p.nodeId];if(!url) throw new Error('Figma screenshot missing');
      await save('reference.png',await downloadConnectorMedia(url,signal));
      const fills=await api(`files/${p.fileKey}/images`,token,signal);
      const refs=new Set<string>();const visit=(v:any)=>{if(!v||typeof v!=='object')return;if(typeof v.imageRef==='string')refs.add(v.imageRef);for(const x of Object.values(v))visit(x);};visit(p.node);
      for(const ref of refs) if(fills.meta?.images?.[ref]) urls.add(fills.meta.images[ref]);
      await save('design-context.txt',JSON.stringify(p.node,null,2));
    } else {
      for(const name of ['get_design_context','get_screenshot','get_variable_defs']) {
        const tool=p.tools.find(t=>t.name===name);if(!tool) {snapshot.warnings.push(`${name}: инструмент не предоставлен сервером`);continue;}
        stage=name;
        let result:any;
        try {result=checked(await callCodexConnector('figma',name,toolArgs(tool.inputSchema,p.fileKey,p.nodeId)));}
        catch(e) {if(name==='get_variable_defs'){snapshot.warnings.push('Переменные отдельно не получены; используйте значения из design-context.txt');continue;}throw e;}

        outputs.push(result);
        await save(`${name}.json`,JSON.stringify(result,null,2));
        if(name==='get_design_context') await save('design-context.txt',mcpResultText(result));
        for(const item of result.content??[]) if(item.type==='image'&&item.mimeType==='image/png'&&!snapshot.files.includes('reference.png')) await save('reference.png',Buffer.from(item.data,'base64'));
        if(name==='get_screenshot'&&!snapshot.files.includes('reference.png')) {
          for(const item of result.content??[]) if(item.type==='text') {
            try {
              const image=JSON.parse(item.text);
              if(typeof image.image_url==='string' && mediaUrlAllowed(image.image_url)) {
                await save('reference.png',await downloadConnectorMedia(image.image_url,signal));
                referenceUrls.add(image.image_url);break;
              }
            } catch(e) {if(signal.aborted)throw e;}
          }
        }

      }
      for(const url of figmaAssetUrls(outputs))urls.add(url);
    }
    for(const url of referenceUrls)urls.delete(url);
    if(!snapshot.files.includes('design-context.txt')) throw new Error('Figma design context unavailable');
    if(!snapshot.files.includes('reference.png')) throw new Error('Figma reference screenshot unavailable');
    stage='assets';
    for(const url of urls) {
      if(signal.aborted) throw new Error('stopped');
      try {
        const data=await downloadConnectorMedia(url,signal);
        const ext=new URL(url).pathname.match(/\.(png|jpe?g|webp|svg)$/i)?.[0]??'.png';
        const name=`figma-${createHash('sha256').update(url).digest('hex').slice(0,16)}${ext}`;
        const list=await addAssets(projectId,[{name,data}],undefined,{source:'figma'});
        const found=list.find(a=>a.file===name)??list.at(-1)!;
        snapshot.assets.push({file:found.file,path:found.path,url});
      } catch {snapshot.warnings.push(`Не скачан ассет: ${new URL(url).hostname}${new URL(url).pathname}`);}
    }
    snapshot.complete=snapshot.assets.length===urls.size;
    await fs.writeFile(manifestFile,JSON.stringify(snapshot,null,2));
    if(!snapshot.complete) throw new FigmaInputError({ok:false,code:'assets-missing',message:MESSAGES['assets-missing']});
    return snapshot;
  } catch(e) {
    if(signal.aborted) throw e;
    await fs.writeFile(path.join(dir,'diagnostics.json'),JSON.stringify({stage,error:(e as Error).message.slice(0,1000),at:new Date().toISOString()},null,2));
    if(e instanceof FigmaInputError) throw e;
    const code=classifyFigmaError((e as Error).message);throw new FigmaInputError({ok:false,code,message:MESSAGES[code]});
  }
};
export const figmaSnapshotSection=(s:FigmaSnapshot)=>`\n## Подготовленные исходники Figma\nУзел ${s.nodeId}, источник ${s.source}. Сначала прочитай ${s.directory}/snapshot.json, metadata.json и design-context.txt; визуальная цель — ${s.directory}/reference.png. Исходные ассеты уже в корзине, их пути — в snapshot.json. Не используй временные URL как runtime-src и не заменяй интерфейс одной картинкой. Сначала собери точный статичный экран, затем движение.\n`;
