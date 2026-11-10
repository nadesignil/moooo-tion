import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PNG} from 'pngjs';
import {ROOT,projectDir} from './paths';
import {scopedPath} from './project-scope';
const exec=promisify(execFile);
const IMAGE=/\.(png|jpe?g|webp)$/i;
const MEDIA=/\.(mp4|mov|webm|mkv|mp3|wav|m4a|ogg)$/i;
const limit=(n:number,min:number,max:number)=>{if(!Number.isFinite(n)||n<min||n>max)throw new Error(`Value outside ${min}..${max}`);return n;};
const integer=(n:number,min:number,max:number)=>{limit(n,min,max);if(!Number.isInteger(n))throw new Error('Integer required');return n;};
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw new Error('stopped');};
async function ffmpeg(args:string[],signal:AbortSignal){
 stopped(signal);
 return exec(process.execPath,[path.join(ROOT,'node_modules/@remotion/cli/remotion-cli.js'),'ffmpeg','-hide_banner','-loglevel','error','-nostdin',...args],{cwd:ROOT,windowsHide:true,timeout:300000,maxBuffer:2000000,signal});
}
async function output(id:string,ext:string,publicVideo=false){
 const rel=`${publicVideo?'public/video':'.moootion/check'}/workbench-${randomUUID()}.${ext}`;
 const file=await scopedPath(projectDir(id),rel,true);await fs.mkdir(path.dirname(file),{recursive:true});return {file,path:rel};
}
async function input(id:string,rel:string,pattern:RegExp){if(typeof rel!=='string'||!pattern.test(rel))throw new Error('Unsupported local media');const f=await scopedPath(projectDir(id),rel);if(!(await fs.stat(f)).isFile())throw new Error('File required');return f;}
async function load(id:string,rel:string,signal:AbortSignal){
 const file=await input(id,rel,IMAGE);stopped(signal);
 let src=file;let temp:string|undefined;
 try{
  if(!/\.png$/i.test(file)){const out=await output(id,'png');src=out.file;temp=src;await ffmpeg(['-i',file,'-frames:v','1','-vf','scale=w=min(4096\\,iw):h=min(4096\\,ih):force_original_aspect_ratio=decrease',src],signal);}
  const data=await fs.readFile(src);
  if(data.length<24||data.toString('hex',0,8)!=='89504e470d0a1a0a'||data.readUInt32BE(16)*data.readUInt32BE(20)>16777216)throw new Error('PNG exceeds 16 megapixels');
  return PNG.sync.read(data);
 }finally{if(temp)await fs.rm(temp,{force:true});}
}
/** Alpha compositing in explicit canvas coordinates, deterministic and independently testable. */
export function composite(canvas:PNG,src:PNG,x:number,y:number,width:number,height:number,opacity=1){
 for(let dy=0;dy<height;dy++){const cy=y+dy;if(cy<0||cy>=canvas.height)continue;
  for(let dx=0;dx<width;dx++){const cx=x+dx;if(cx<0||cx>=canvas.width)continue;
   const si=(Math.min(src.height-1,Math.floor(dy*src.height/height))*src.width+Math.min(src.width-1,Math.floor(dx*src.width/width)))*4;
   const di=(cy*canvas.width+cx)*4;const sa=src.data[si+3]/255*opacity,da=canvas.data[di+3]/255,a=sa+da*(1-sa);
   for(let c=0;c<3;c++)canvas.data[di+c]=a?Math.round((src.data[si+c]*sa+canvas.data[di+c]*da*(1-sa))/a):0;
   canvas.data[di+3]=Math.round(a*255);
  }
 }
}
export const composeImages=async(id:string,a:{width:number;height:number;layers:{path:string;x:number;y:number;width:number;height:number;opacity?:number}[]},signal:AbortSignal)=>{
 integer(a.width,1,4096);integer(a.height,1,4096);if(!Array.isArray(a.layers)||!a.layers.length||a.layers.length>32)throw new Error('1–32 layers required');
 const canvas=new PNG({width:a.width,height:a.height});canvas.data.fill(0);
 for(const l of a.layers){stopped(signal);integer(l.x,-8192,8192);integer(l.y,-8192,8192);integer(l.width,1,4096);integer(l.height,1,4096);limit(l.opacity??1,0,1);composite(canvas,await load(id,l.path,signal),l.x,l.y,l.width,l.height,l.opacity??1);}
 const out=await output(id,'png');stopped(signal);await fs.writeFile(out.file,PNG.sync.write(canvas));return {path:out.path,width:a.width,height:a.height,note:'Nearest-neighbour scaling for inspection; geometry is explicit. Use image_transform for smooth resizing.'};
};
export const contactSheet=async(id:string,a:{paths:string[];columns:number;cellWidth:number;cellHeight:number},signal:AbortSignal)=>{
 integer(a.columns,1,8);integer(a.cellWidth,64,1920);integer(a.cellHeight,64,1080);
 if(!Array.isArray(a.paths)||!a.paths.length||a.paths.length>32)throw new Error('1–32 images required');
 const width=a.columns*a.cellWidth,height=Math.ceil(a.paths.length/a.columns)*a.cellHeight;integer(width,1,4096);integer(height,1,4096);
 const canvas=new PNG({width,height});canvas.data.fill(255);
 const cells=[];
 for(const [i,file]of a.paths.entries()){stopped(signal);const src=await load(id,file,signal);const scale=Math.min(a.cellWidth/src.width,a.cellHeight/src.height);const w=Math.max(1,Math.round(src.width*scale)),h=Math.max(1,Math.round(src.height*scale));const x=(i%a.columns)*a.cellWidth+Math.floor((a.cellWidth-w)/2),y=Math.floor(i/a.columns)*a.cellHeight+Math.floor((a.cellHeight-h)/2);composite(canvas,src,x,y,w,h);cells.push({index:i,path:file,x,y,width:w,height:h});}
 const out=await output(id,'png');stopped(signal);await fs.writeFile(out.file,PNG.sync.write(canvas));return {path:out.path,cells,note:'Aspect ratios preserved. Order pairs reference/result for side-by-side comparison. Cell labels are in this returned map.'};
};
export const transformImage=async(id:string,a:{path:string;width?:number;height?:number;rotation?:number;flipX?:boolean;flipY?:boolean},signal:AbortSignal)=>{
 const file=await input(id,a.path,IMAGE);const filters:string[]=[];
 if(a.width!==undefined||a.height!==undefined){const w=a.width===undefined?-2:integer(a.width,1,4096),h=a.height===undefined?-2:integer(a.height,1,4096);filters.push(`scale=${w}:${h}:flags=lanczos`);}
 if(a.rotation!==undefined){if(![0,90,180,270].includes(a.rotation))throw new Error('Rotation must be 0/90/180/270');if(a.rotation===90)filters.push('transpose=1');if(a.rotation===180)filters.push('hflip','vflip');if(a.rotation===270)filters.push('transpose=2');}
 if(a.flipX)filters.push('hflip');if(a.flipY)filters.push('vflip');
 const out=await output(id,'png');try{await ffmpeg(['-i',file,'-frames:v','1',...(filters.length?['-vf',filters.join(',')]:[]),out.file],signal);return {path:out.path};}catch(e){await fs.rm(out.file,{force:true});throw e;}
};
export const maskImage=async(id:string,a:{path:string;mask:string;mode:'alpha'|'luminance';invert?:boolean},signal:AbortSignal)=>{
 const src=await load(id,a.path,signal),mask=await load(id,a.mask,signal);
 if(src.width!==mask.width||src.height!==mask.height)throw new Error('Mask must have identical dimensions');if(!['alpha','luminance'].includes(a.mode))throw new Error('Invalid mask mode');
 for(let i=0;i<src.data.length;i+=4){let v=a.mode==='alpha'?mask.data[i+3]/255:(.2126*mask.data[i]+.7152*mask.data[i+1]+.0722*mask.data[i+2])/255;if(a.invert)v=1-v;src.data[i+3]=Math.round(src.data[i+3]*v);}
 const out=await output(id,'png');stopped(signal);await fs.writeFile(out.file,PNG.sync.write(src));return {path:out.path};
};
export const differenceMask=async(id:string,a:{a:string;b:string;threshold:number},signal:AbortSignal)=>{
 const first=await load(id,a.a,signal),second=await load(id,a.b,signal);integer(a.threshold,0,255);if(first.width!==second.width||first.height!==second.height)throw new Error('Equal sizes required');
 for(let i=0;i<first.data.length;i+=4){const value=Math.max(...[0,1,2].map(c=>Math.abs(first.data[i+c]-second.data[i+c])))>a.threshold?255:0;first.data[i]=first.data[i+1]=first.data[i+2]=value;first.data[i+3]=255;}
 const out=await output(id,'png');stopped(signal);await fs.writeFile(out.file,PNG.sync.write(first));return {path:out.path,note:'White = changed RGB pixels; not semantic segmentation. Inspect before using as a luminance mask.'};
};
export const transcodeMedia=async(id:string,a:{path:string;from?:number;seconds?:number;width?:number;fps?:number;mute?:boolean;speed?:number},signal:AbortSignal)=>{
 const src=await input(id,a.path,MEDIA);const start=limit(a.from??0,0,36000),seconds=limit(a.seconds??60,.01,600),speed=limit(a.speed??1,.25,4);
 const filters:string[]=[];if(a.width!==undefined)filters.push(`scale=${integer(a.width,16,3840)}:-2`);filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');if(a.fps!==undefined)integer(a.fps,1,120);
 const out=await output(id,'mp4',true);
 try{await ffmpeg(['-ss',String(start),'-t',String(seconds),'-itsscale',String(1/speed),'-i',src,'-map','0:v:0','-map','0:a:0?','-vf',filters.join(','),...(a.fps!==undefined?['-r',String(a.fps)]:[]),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',...(a.mute!==false?['-an']:['-c:a','aac',...(speed!==1?['-af',(speed<0.5?`atempo=0.5,atempo=${speed*2}`:`atempo=${speed}`)]:[])]),'-movflags','+faststart',out.file],signal);return {path:out.path,asset:out.path.replace(/^public\//,''),from:start,inputSeconds:seconds,speed};}catch(e){await fs.rm(out.file,{force:true});throw e;}
};
