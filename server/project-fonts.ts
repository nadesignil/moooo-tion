import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {projectDir} from './paths';
import {scopedPath} from './project-scope';
const exec=promisify(execFile);
const norm=(s:string)=>s.toLowerCase().replace(/[^a-zа-яё0-9]/g,'');
export type ProjectFont={family:string;weight:number;style:string;path:string;source:'system'|'google';unicodeRange?:string};
const systemFont=async(family:string,weight:number,style:string):Promise<string|null>=>{
  if(process.platform==='win32'){
    const roots=[path.join(process.env.WINDIR??'C:/Windows','Fonts'),path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local'),'Microsoft','Windows','Fonts')];
    const all:{label:string;file:string}[]=[];
    for(const key of ['HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']){
      try {const r=await exec('reg.exe',['query',key],{windowsHide:true,timeout:5000});for(const line of r.stdout.split(/\r?\n/)){const m=line.trim().match(/^(.+?)\s+REG_SZ\s+(.+)$/);if(m)all.push({label:m[1].replace(/\s*\([^)]*\)$/,''),file:path.isAbsolute(m[2])?m[2]:path.join(roots[0],m[2])});}}catch{}
    }
    const candidates=all.filter(x=>{const label=norm(x.label);const base=norm(family);return label.startsWith(base)&&(!label.slice(base.length)||/^(regular|normal|medium|bold|semibold|light|thin|italic|heavy|black|ultralight|extrabold)/.test(label.slice(base.length)))&&(/italic/i.test(x.label)===(style==='italic'));});
    const faceWeight=(s:string)=>/semibold/i.test(s)?600:/bold/i.test(s)?700:/medium/i.test(s)?500:/ultralight/i.test(s)?200:/thin/i.test(s)?100:/light/i.test(s)?300:/heavy|black/i.test(s)?900:400;
    for(let i=candidates.length-1;i>=0;i--)if(faceWeight(candidates[i].label)!==weight)candidates.splice(i,1);
    candidates.sort((a,b)=>Math.abs(faceWeight(a.label)-weight)-Math.abs(faceWeight(b.label)-weight));
    for(const candidate of candidates){
      for(const root of roots){try {const rel=path.relative(root,candidate.file);const safe=await scopedPath(root,rel);if(/\.(ttf|otf|woff2?)$/i.test(safe))return safe;}catch{}}
    }
  } else {
    // Fontconfig is optional on Unix. Require the requested family, never a fallback match.
    try {
      const r=await exec('fc-match',['-f','%{family}\t%{file}\n',family],{timeout:5000});
      const [names,file]=r.stdout.trim().split('\t');
      if(names?.split(',').some(n=>norm(n)===norm(family))&&file){
        for(const root of ['/usr/share/fonts','/usr/local/share/fonts',path.join(os.homedir(),'.fonts'),path.join(os.homedir(),'.local/share/fonts'),'/Library/Fonts','/System/Library/Fonts',path.join(os.homedir(),'Library/Fonts')]){
          try{return await scopedPath(root,path.relative(root,file));}catch{}
        }
      }
    }catch{}
  }
  return null;
};
export const resolveProjectFont=async(id:string,family:string,weight:number,style:string,signal:AbortSignal)=>{
  if(!/^[\p{L}\p{N} ._-]{1,100}$/u.test(family)||!Number.isInteger(weight)||weight<100||weight>900||!['normal','italic'].includes(style))throw new Error('Некорректное семейство или начертание шрифта');
  const local=await systemFont(family,weight,style);
  const save=async(data:Buffer,extension:string,source:'system'|'google',unicodeRange?:string):Promise<ProjectFont>=>{
    if(signal.aborted)throw new Error('stopped');if(data.length>10000000)throw new Error('Файл шрифта больше 10MB');
    const file=`public/fonts/${createHash('sha256').update(data).digest('hex').slice(0,20)}${extension}`;
    const dest=await scopedPath(projectDir(id),file,true);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,data);
    return {family,weight,style,path:file.replace(/^public\//,''),source,...(unicodeRange?{unicodeRange}:{})};
  };
  if(local)return {found:true,faces:[await save(await fs.readFile(local),path.extname(local),'system')],note:'Загрузите FontFace с этим семейством, весом и стилем; дождитесь face.load() через delayRender/continueRender.'};
  const axis=style==='italic'?`ital,wght@1,${weight}`:`wght@${weight}`;
  const response=await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axis}&display=swap`,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),redirect:'error'});
  if(!response.ok)return {found:false,family,note:'Шрифт не найден среди установленных и в Google Fonts. Импортируйте лицензированный файл в ассеты проекта; не заменяйте его молча.'};
  const css=await response.text();const faces:ProjectFont[]=[];
  for(const block of css.matchAll(/@font-face\s*\{([^}]+)\}/g)){
    const url=block[1].match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];if(!url)continue;
    const res=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),redirect:'error'});if(!res.ok)throw new Error('Google Fonts не вернул файл шрифта');
    const type=res.headers.get('content-type')??'';const ext=/woff2/.test(type)?'.woff2':/woff/.test(type)?'.woff':'.ttf';
    faces.push(await save(Buffer.from(await res.arrayBuffer()),ext,'google',block[1].match(/unicode-range:\s*([^;]+)/)?.[1]));
  }
  return {found:faces.length>0,faces,note:'Загрузите каждую FontFace с weight/style/unicodeRange и дождитесь face.load() через delayRender/continueRender.'};
};
