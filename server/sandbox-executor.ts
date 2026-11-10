import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {TEMP_ROOT,projectDir} from './paths';
import {scopedPath} from './project-scope';

export const EXECUTOR_IMAGE='moootion-executor:1';
const MAX_BYTES=1024*1024*1024;
// /Applications is not shared with Docker Desktop. Stage only copied inputs in
// the macOS temporary directory, which Docker can mount without wider access.
const EXECUTOR_TEMP_ROOT=process.platform==='darwin'?path.join(os.tmpdir(),'moootion-executor'):path.join(TEMP_ROOT,'executor');
const active=new Set<string>();
type CommandResult={code:number;stdout:string;stderr:string};
export type SandboxRequest={language:'python'|'shell';code:string;inputs:string[];timeoutSeconds?:number};

export function validateRequest(a:SandboxRequest){
 if(!a||!['python','shell'].includes(a.language)||typeof a.code!=='string'||!a.code.trim()||Buffer.byteLength(a.code)>100000)throw new Error('Нужен Python/shell-скрипт до 100 КБ');
 if(!Array.isArray(a.inputs)||a.inputs.length>64||a.inputs.some(p=>typeof p!=='string'))throw new Error('Передайте до 64 входных файлов');
 const seconds=a.timeoutSeconds??120;
 if(!Number.isInteger(seconds)||seconds<1||seconds>300)throw new Error('Таймаут — 1–300 секунд');
 for(const p of a.inputs)safeRelative(p);
 return seconds;
}
export function safeRelative(p:string){
 const parts=p.split('/');
 if(!p||p.includes('\\')||parts.some(s=>!s||s==='.'||s==='..'||/[<>:"|?*\x00-\x1f]/.test(s)||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))throw new Error('Недопустимый относительный путь');
 return p;
}
async function dockerHost(){
 if(process.platform==='win32')return 'npipe:////./pipe/docker_engine';
 if(process.platform==='darwin'){
  const socket=path.join(os.homedir(),'.docker','run','docker.sock');
  if(await fs.stat(socket).then(s=>s.isSocket(),()=>false))return `unix://${socket}`;
 }
 return 'unix:///var/run/docker.sock';
}
export async function dockerBin(){
 if(process.platform==='win32'){
  const candidates=[
   process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Programs','DockerDesktop','resources','bin','docker.exe'),
   path.join(process.env.ProgramFiles??'C:\\Program Files','Docker','Docker','resources','bin','docker.exe'),
  ].filter((p):p is string=>Boolean(p));
  for(const bin of candidates)if(await fs.access(bin).then(()=>true,()=>false))return bin;
 }
 if(process.platform==='darwin'){
  for(const bin of [path.join(os.homedir(),'.docker','bin','docker'),'/Applications/Docker.app/Contents/Resources/bin/docker']){
   if(await fs.access(bin).then(()=>true,()=>false))return bin;
  }
 }
 return process.platform==='win32'?'docker.exe':'docker';
}
/** Never invokes a host shell. Script text only travels to container stdin. */
async function command(bin:string,args:string[],opts:{signal?:AbortSignal;stdin?:string;timeout?:number;maxOutput?:number}={}):Promise<CommandResult>{
 if(opts.signal?.aborted)throw new Error('stopped');
 const host=await dockerHost();
 return new Promise((resolve,reject)=>{
  const child=spawn(bin,['--host',host,...args],{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
  let stdout='',stderr='',bytes=0,error:Error|undefined;
  const stop=(reason:string)=>{error??=new Error(reason);child.kill();};
  const abort=()=>stop('stopped');
  const timer=setTimeout(()=>stop('Превышено время выполнения'),opts.timeout??15000);
  opts.signal?.addEventListener('abort',abort,{once:true});
  const read=(kind:'stdout'|'stderr',data:Buffer)=>{bytes+=data.length;if(bytes>(opts.maxOutput??1024*1024)){stop('Превышен лимит вывода 1 МБ');return;}if(kind==='stdout')stdout+=data.toString('utf8');else stderr+=data.toString('utf8');};
  child.stdout.on('data',b=>read('stdout',b));child.stderr.on('data',b=>read('stderr',b));
  child.stdin.on('error',()=>{});
  child.once('error',e=>{error=e;});
  child.once('close',code=>{clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve({code:code??-1,stdout,stderr});});
  child.stdin.end(opts.stdin??'');
  if(opts.signal?.aborted)abort();
 });
}
export const executorDocker=async(args:string[],opts:{timeout?:number;maxOutput?:number}={})=>command(await dockerBin(),args,opts);
export async function sandboxStatus(signal?:AbortSignal){
 const bin=await dockerBin();
 const install=process.platform==='win32'?'Установите Docker Desktop с WSL 2, затем выполните tools/build-executor.ps1.':'Установите и запустите Docker Desktop, затем выполните docker build -t moootion-executor:1 install/executor.';
 const start=process.platform==='win32'?'Запустите Docker Desktop; после установки WSL может требоваться перезагрузка Windows.':'Запустите Docker Desktop и дождитесь готовности движка.';
 try{
  const info=await command(bin,['info','--format','{{.OSType}}'],{signal});
  if(info.code!==0)return {ready:false,code:'engine-unavailable',reason:'Linux-движок Docker не отвечает. '+start,image:EXECUTOR_IMAGE};
  if(info.stdout.trim()!=='linux')return {ready:false,code:'wrong-engine',reason:'Переключите Docker на Linux-контейнеры',image:EXECUTOR_IMAGE};
  const image=await command(bin,['image','inspect',EXECUTOR_IMAGE,'--format','{{.Id}}'],{signal});
  if(image.code!==0||!/^sha256:[a-f0-9]{64}$/.test(image.stdout.trim()))return {ready:false,code:'image-missing',reason:'Образ исполнителя ещё не собран; студия подготовит его при запуске.',image:EXECUTOR_IMAGE};
  return {ready:true,image:EXECUTOR_IMAGE,imageId:image.stdout.trim()};
 }catch(e){
  if(signal?.aborted)throw new Error('stopped');
  const missing=(e as NodeJS.ErrnoException).code==='ENOENT';
  return {ready:false,reason:missing?'Docker не найден. '+install:'Docker установлен, но Linux-движок не отвечает. '+start,image:EXECUTOR_IMAGE};
 }
}
export function containerArgs(name:string,imageId:string,inputDir:string,outputDir:string,language:'python'|'shell'){
 if(!/^moootion-exec-[a-f0-9-]+$/.test(name)||!/^sha256:[a-f0-9]{64}$/.test(imageId))throw new Error('Invalid container identity');
 if([inputDir,outputDir].some(p=>p.includes(',')||p.includes('\n')))throw new Error('Unsupported mount path');
 return ['create','--name',name,'--label','moootion.executor=1','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--pids-limit','128','--memory','2g','--memory-swap','2g','--cpus','2','--ulimit','nofile=256:256','--ulimit','fsize=536870912:536870912','--init','--tmpfs','/tmp:rw,noexec,nosuid,size=256m','--mount',`type=bind,source=${inputDir},target=/input,readonly,bind-recursive=disabled`,'--mount',`type=bind,source=${outputDir},target=/output,bind-recursive=disabled`,'--workdir','/output','--env','HOME=/tmp','--env','TMPDIR=/tmp','--env','PYTHONDONTWRITEBYTECODE=1','--env','OPENBLAS_NUM_THREADS=2','--interactive',imageId,...(language==='python'?['python','-I','-']:['/bin/sh','-s'])];
}
/** Reject links and special files; only files created in this run can be published. */
export async function inspectOutputs(root:string){
 const entries:{path:string;bytes:number}[]=[];let bytes=0,nodes=0;
 const walk=async(dir:string,relative='')=>{
  const items=await fs.readdir(dir,{withFileTypes:true});
  for(const item of items){if(++nodes>512)throw new Error('Слишком много результатов (максимум 512 файлов/каталогов)');
   const rel=relative?`${relative}/${item.name}`:item.name;safeRelative(rel);
   const file=path.join(dir,item.name),stat=await fs.lstat(file);
   if(stat.isSymbolicLink())throw new Error('Ссылки в результатах запрещены');
   if(stat.isDirectory()){await walk(file,rel);continue;}
   if(!stat.isFile()||stat.nlink>1)throw new Error('Специальные файлы и hardlink запрещены');
   bytes+=stat.size;if(bytes>MAX_BYTES)throw new Error('Результаты превысили 1 ГиБ');entries.push({path:rel,bytes:stat.size});
  }
 };
 await walk(root);return entries;
}
export async function runSandbox(id:string,a:SandboxRequest,signal:AbortSignal){
 const seconds=validateRequest(a);if(signal.aborted)throw new Error('stopped');
 if(active.has(id))throw new Error('В этом проекте уже выполняется скрипт');active.add(id);
 const runId=randomUUID(),name=`moootion-exec-${runId}`;
 let bin='',staging='',containerAttempted=false,removed=false;
 try{
  const status=await sandboxStatus(signal);if(!status.ready||!status.imageId)throw new Error(status.reason??'Исполнитель недоступен');
  bin=await dockerBin();
  const base=EXECUTOR_TEMP_ROOT;await fs.mkdir(base,{recursive:true});
  staging=await fs.mkdtemp(path.join(base,'run-'));
  const inputDir=path.join(staging,'input'),outputDir=path.join(staging,'output');await fs.mkdir(inputDir);await fs.mkdir(outputDir,{mode:0o777});await fs.chmod(outputDir,0o777);
  let bytes=0;const inputs=[];
  for(const rel of [...new Set(a.inputs)]){
   if(signal.aborted)throw new Error('stopped');
   const src=await scopedPath(projectDir(id),rel),stat=await fs.stat(src);
   if(!stat.isFile())throw new Error('Входы — только отдельные файлы');bytes+=stat.size;if(bytes>MAX_BYTES*4)throw new Error('Входы превышают 4 ГиБ');
   const dst=path.join(inputDir,rel);await fs.mkdir(path.dirname(dst),{recursive:true});await fs.copyFile(src,dst);inputs.push({projectPath:rel,containerPath:`/input/${rel}`});
  }
  containerAttempted=true;
  const create=await command(bin,containerArgs(name,status.imageId,inputDir,outputDir,a.language),{signal});
  if(create.code!==0)throw new Error('Не удалось создать контейнер: '+create.stderr.slice(0,2000));
  const controller=new AbortController();let quotaError:Error|undefined,pendingCheck:Promise<void>|undefined;
  const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const timer=setTimeout(()=>controller.abort(),seconds*1000);
  // Container cannot touch project files. Quota failures stop its process tree before publishing.
  const quota=setInterval(()=>{if(pendingCheck)return;pendingCheck=inspectOutputs(outputDir).then(()=>{}).catch(e=>{quotaError=e;controller.abort();}).finally(()=>{pendingCheck=undefined;});},500);
  let result:CommandResult;
  try{result=await command(bin,['start','--attach','--interactive',name],{stdin:a.code,signal:controller.signal,timeout:seconds*1000+1000});}
  catch(e){if(quotaError)throw quotaError;if(signal.aborted)throw new Error('stopped');if(controller.signal.aborted)throw new Error(`Скрипт остановлен по таймауту ${seconds} с`);throw e;}
  finally{clearTimeout(timer);clearInterval(quota);signal.removeEventListener('abort',abort);await pendingCheck;}
  if(quotaError)throw quotaError;
  const state=await command(bin,['inspect',name,'--format','{{json .State}}']);
  if(state.code!==0)throw new Error('Не удалось проверить завершение контейнера');
  const finalState=JSON.parse(state.stdout);if(finalState.Running)throw new Error('Контейнер всё ещё выполняется');
  const rm=await command(bin,['rm','--force',name]);if(rm.code!==0)throw new Error('Не удалось удалить контейнер');removed=true;
  if(signal.aborted)throw new Error('stopped');
  const files=await inspectOutputs(outputDir);
  const relRoot=`.moootion/executions/${runId}`,dest=await scopedPath(projectDir(id),relRoot,true);await fs.mkdir(dest,{recursive:true});
  for(const file of files){const target=await scopedPath(projectDir(id),`${relRoot}/${file.path}`,true);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(outputDir,file.path),target);}
  const report={runId,language:a.language,imageId:status.imageId,exitCode:finalState.ExitCode,oomKilled:Boolean(finalState.OOMKilled),stdout:result.stdout,stderr:result.stderr,inputs,outputs:files.map(f=>({path:`${relRoot}/${f.path}`,bytes:f.bytes})),at:new Date().toISOString()};
  // Keep provenance outside the untrusted result directory.
  await fs.writeFile(await scopedPath(projectDir(id),`.moootion/executions/${runId}.json`,true),JSON.stringify({...report,code:a.code},null,2));
  return report;
 }finally{
  if(containerAttempted&&!removed){try{const r=await command(bin,['rm','--force',name]);removed=r.code===0||/No such container/i.test(r.stderr);}catch{console.error('Sandbox cleanup failed for',name);}}
  // Never delete a bind mount while an unconfirmed container could still be writing to it.
  if(staging&&(!containerAttempted||removed)&&path.dirname(staging)===EXECUTOR_TEMP_ROOT)await fs.rm(staging,{recursive:true,force:true,maxRetries:3});
  active.delete(id);
 }
}
