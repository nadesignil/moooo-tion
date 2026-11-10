import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

type StartOptions = {cli:()=>Promise<void>; candidates:string[]; exists:(p:string)=>Promise<boolean>; launch:(p:string)=>Promise<void>};
export async function startDesktopWithFallback(options: StartOptions) {
  try {await options.cli(); return;} catch (error) {
    for (const candidate of options.candidates) {
      if (await options.exists(candidate)) {await options.launch(candidate); return;}
    }
    throw error;
  }
}

export async function startDockerDesktop(bin: string) {
  const candidates = process.platform === 'win32'
    ? [path.resolve(path.dirname(bin),'../..','Docker Desktop.exe')]
    : [];
  await startDesktopWithFallback({
    cli:async()=>{await promisify(execFile)(bin,['desktop','start','--detach'],{windowsHide:true,timeout:30000,maxBuffer:256000});},
    candidates,
    exists:p=>fs.access(p).then(()=>true,()=>false),
    launch:p=>new Promise((resolve,reject)=>{
      const child=spawn(p,[],{windowsHide:true,detached:true,stdio:'ignore',shell:false});
      child.once('error',reject);
      child.once('spawn',()=>{child.unref();resolve();});
    }),
  });
}
