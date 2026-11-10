import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PNG} from 'pngjs';
import {ROOT, projectDir} from './paths';
import {scopedPath} from './project-scope';
import {writeProject} from './projects';
const exec=promisify(execFile);
const TEXT=/\.(tsx?|jsx?|json|md|txt|css|html|svg|py|mjs|cjs)$/i;
export const searchProject=async(id:string,text:string)=>{
  if(!text || text.length>300) throw new Error('Нужна строка поиска до 300 символов');
  const root=projectDir(id);const hits:{file:string;line:number;text:string}[]=[];let files=0;
  const walk=async(dir:string)=>{
    for(const e of await fs.readdir(dir,{withFileTypes:true})) {
      if(hits.length>=100||files>=1000)return;
      if(e.isSymbolicLink()||['.git','node_modules'].includes(e.name))continue;
      const f=path.join(dir,e.name);
      if(e.isDirectory()){await walk(f);continue;}
      if(!TEXT.test(f)||(await fs.stat(f)).size>2000000)continue;
      const safe=await scopedPath(root,path.relative(root,f));files++;
      const lines=(await fs.readFile(safe,'utf8')).split('\n');
      for(let i=0;i<lines.length&&hits.length<100;i++)if(lines[i].toLowerCase().includes(text.toLowerCase()))hits.push({file:path.relative(root,f).replace(/\\/g,'/'),line:i+1,text:lines[i].slice(0,400)});
    }
  };await walk(root);return {hits,truncated:hits.length>=100||files>=1000};
};
export const patchProject=async(id:string,file:string,before:string,after:string)=>{
  const root=projectDir(id);const f=await scopedPath(root,file);
  if(!before||after.length>2000000||file.split(/[\\/]/).some(p=>['.git','node_modules'].includes(p)))throw new Error('Недопустимая правка');
  const old=await fs.readFile(f,'utf8');
  if(old.split(before).length!==2)throw new Error('Искомый текст должен встретиться ровно один раз');
  const next=old.replace(before,()=>after);
  if(f===path.join(root,'project.json'))await writeProject(id,JSON.parse(next));else await fs.writeFile(f,next,'utf8');
  return {file,changed:true};
};
export const readShared=async(file:string)=>{
  const normalized=file.replace(/\\/g,'/');
  const group=normalized.match(/^(runtime|templates\/demo|library)(?:\/|$)/)?.[1];
  if(!group)throw new Error('Доступны runtime/, templates/demo/ и library/');
  const f=await scopedPath(path.join(ROOT,group),normalized.slice(group.length).replace(/^\//,''));
  const stat=await fs.stat(f);
  if(stat.isDirectory())return {kind:'text',text:(await fs.readdir(f)).join('\n')};
  if(stat.size>10000000)throw new Error('Файл больше 10MB');
  if(/\.(png|jpe?g|webp)$/i.test(f))return {kind:'image',url:`data:image/${path.extname(f).slice(1).replace('jpg','jpeg')};base64,${(await fs.readFile(f)).toString('base64')}`};
  if(!TEXT.test(f))throw new Error('Этот общий файл нельзя прочитать как текст');
  return {kind:'text',text:await fs.readFile(f,'utf8')};
};
export const checkProject=async(id:string,signal?:AbortSignal)=>{
  try {
    await exec(process.execPath,[path.join(ROOT,'node_modules/typescript/bin/tsc'),'--noEmit','-p',path.join(projectDir(id),'tsconfig.json')],{cwd:projectDir(id),windowsHide:true,timeout:90000,maxBuffer:1000000,signal});
    return {ok:true,diagnostics:''};
  } catch(e) {const r=e as {stdout?:string;stderr?:string;message:string};if(signal?.aborted)throw e;return {ok:false,diagnostics:(r.stdout||r.stderr||r.message).slice(0,16000)};}
};
const image=/\.(png|jpe?g|webp)$/i;
const media=/\.(mp4|mov|webm|mkv|mp3|wav|m4a|ogg)$/i;
const ffmpeg=async(args:string[],signal:AbortSignal)=>{
  if(signal.aborted)throw new Error('stopped');
  return exec(process.execPath,[path.join(ROOT,'node_modules/@remotion/cli/remotion-cli.js'),'ffmpeg',...args],{cwd:ROOT,windowsHide:true,timeout:90000,maxBuffer:2000000,signal});
};
const output=async(id:string,name:string)=>{
  if(!/^[\w-]+\.(png|wav)$/.test(name))throw new Error('Недопустимое имя результата');
  const rel=`.moootion/check/${name}`;const f=await scopedPath(projectDir(id),rel,true);await fs.mkdir(path.dirname(f),{recursive:true});return {file:f,path:rel};
};
export const mediaFrames=async(id:string,file:string,times:number[],signal:AbortSignal,width=640)=>{
  if(!media.test(file)||!times.length||times.length>12||times.some(t=>!Number.isFinite(t)||t<0||t>36000))throw new Error('Нужно медиа проекта и 1–12 времён в секундах');
  if(!Number.isInteger(width)||width<16||width>3840)throw new Error('Ширина кадра 16–3840');
  const input=await scopedPath(projectDir(id),file);const frames:string[]=[];
  for(const [i,time] of times.entries()){
    const o=await output(id,`reference-${randomUUID()}-${i}.png`);
    await ffmpeg(['-y','-ss',String(time),'-i',input,'-frames:v','1','-vf',`scale=${width}:-2`,o.file],signal);frames.push(o.path);
  }return {frames};
};
const loadImage=async(id:string,file:string,signal:AbortSignal)=>{
  if(!image.test(file))throw new Error('Нужно PNG/JPEG/WebP изображение проекта');
  let input=await scopedPath(projectDir(id),file);
  if(!/\.png$/i.test(file)) {
    const converted=await output(id,`decoded-${Date.now()}.png`);
    await ffmpeg(['-y','-i',input,'-frames:v','1',converted.file],signal);input=converted.file;
  }
  const bytes=await fs.readFile(input);
  if(bytes.length<24||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>25000000)throw new Error('Изображение слишком большое');
  return PNG.sync.read(bytes);
};
export const cropImage=async(id:string,file:string,rect:{x:number;y:number;width:number;height:number},signal:AbortSignal)=>{
  if(Object.values(rect).some(v=>!Number.isInteger(v)||v<0)||rect.width<1||rect.height<1)throw new Error('Неверная область изображения');
  const src=await loadImage(id,file,signal);
  if(rect.x+rect.width>src.width||rect.y+rect.height>src.height)throw new Error('Кроп выходит за границы изображения');
  const dest=new PNG({width:rect.width,height:rect.height});
  for(let y=0;y<rect.height;y++)src.data.copy(dest.data,y*rect.width*4,((y+rect.y)*src.width+rect.x)*4,((y+rect.y)*src.width+rect.x+rect.width)*4);
  const o=await output(id,`crop-${Date.now()}.png`);await fs.writeFile(o.file,PNG.sync.write(dest));return {path:o.path};
};
export const compareImages=async(id:string,a:string,b:string,signal:AbortSignal)=>{
  const aa=await loadImage(id,a,signal);const bb=await loadImage(id,b,signal);
  if(aa.width!==bb.width||aa.height!==bb.height)throw new Error('Изображения должны иметь одинаковый размер');
  const diff=new PNG({width:aa.width,height:aa.height});let sum=0,squares=0,changed=0;
  for(let i=0;i<aa.data.length;i+=4){let pixelChanged=false;for(let c=0;c<4;c++){const d=Math.abs(aa.data[i+c]-bb.data[i+c]);sum+=d;squares+=d*d;if(d)pixelChanged=true;diff.data[i+c]=c===3?255:d;}if(pixelChanged)changed++;}
  const o=await output(id,`diff-${Date.now()}.png`);await fs.writeFile(o.file,PNG.sync.write(diff));
  return {difference:o.path,identical:changed===0,changedPixels:changed,totalPixels:aa.width*aa.height,meanAbsoluteError:sum/aa.data.length,rmse:Math.sqrt(squares/aa.data.length),note:'Пиксельные метрики помогают найти различия. Шрифты, геометрию и ассеты дополнительно проверяйте визуально.'};
};
export const audioEnvelope=async(id:string,file:string,from:number,seconds:number,signal:AbortSignal)=>{
  if(!media.test(file)||!Number.isFinite(from)||from<0||!Number.isFinite(seconds)||seconds<=0||seconds>180)throw new Error('Нужно медиа и отрезок до 180 секунд');
  const input=await scopedPath(projectDir(id),file);const o=await output(id,`audio-${Date.now()}.wav`);
  await ffmpeg(['-y','-ss',String(from),'-i',input,'-t',String(seconds),'-vn','-ac','1','-ar','8000','-acodec','pcm_s16le',o.file],signal);
  const data=await fs.readFile(o.file);let start=12;let end=0;
  while(start+8<=data.length){const size=data.readUInt32LE(start+4);if(data.toString('ascii',start,start+4)==='data'){end=Math.min(data.length,start+8+size);start+=8;break;}start+=8+size+(size%2);}
  if(!end)throw new Error('Не найден PCM-блок аудио');
  const values:number[]=[];for(let at=start;at<end;at+=800){let sum=0,n=0;for(let i=at;i<Math.min(end,at+800)-1;i+=2){const v=data.readInt16LE(i)/32768;sum+=v*v;n++;}values.push(Math.sqrt(sum/Math.max(n,1)));}
  const peaks=values.flatMap((v,i)=>i>0&&i<values.length-1&&v>values[i-1]*1.25&&v>=values[i+1]?[Number((from+i*0.05).toFixed(2))]:[]);
  return {sampleSeconds:0.05,from,seconds,energy:values.map(v=>Number(v.toFixed(4))),onsets:peaks.slice(0,200),note:'Энергия и кандидаты атак для разбора ритма; это не гарантированная BPM-сетка.'};
};

/** Inspect only the actual stage import graph; unused scaffold files do not block a finished project. */
export const screenPlaceholders = async (id:string) => {
  const root=projectDir(id);const seen=new Set<string>();const found:string[]=[];
  const visit=async(file:string)=>{
    if(seen.has(file))return;seen.add(file);
    const safe=await scopedPath(root,file);const text=await fs.readFile(safe,'utf8');
    if(text.includes('Экран появится после сборки'))found.push(file);
    for(const m of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const base=path.resolve(path.dirname(safe),m[1]);const rel=path.relative(root,base);
      if(rel.startsWith('..')||path.isAbsolute(rel))continue;
      for(const candidate of [base,base+'.tsx',base+'.ts',path.join(base,'index.tsx'),path.join(base,'index.ts')]) {
        if(await fs.stat(candidate).then(s=>s.isFile(),()=>false)){await visit(path.relative(root,candidate));break;}
      }
    }
  };
  await visit('src/project.tsx');return found;
};
