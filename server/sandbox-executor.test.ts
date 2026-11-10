import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {containerArgs,inspectOutputs,safeRelative,validateRequest,runSandbox,sandboxStatus} from './sandbox-executor';
import {ROOT,projectDir} from './paths';

test('paths and request validation reject escape, ADS and unbounded commands',()=>{
 for(const p of ['../secret','/etc/passwd','C:/secret','a\\b','a/../b','a:secret','NUL.txt','a/','x.'])assert.throws(()=>safeRelative(p));
 assert.equal(safeRelative('inputs/пример 1.png'),'inputs/пример 1.png');
 assert.equal(validateRequest({language:'python',code:'print(1)',inputs:[]}),120);
 assert.throws(()=>validateRequest({language:'shell',code:'echo x',inputs:[],timeoutSeconds:301}));
 assert.throws(()=>validateRequest({language:'shell',code:'x'.repeat(100001),inputs:[]}));
});
test('container gets only two isolated mounts and no host shell or credentials',()=>{
 const args=containerArgs('moootion-exec-'+randomUUID(),'sha256:'+'a'.repeat(64),'C:\\scratch\\in','C:\\scratch\\out','python');
 assert.equal(args[args.indexOf('--network')+1],'none');assert.ok(args.includes('--read-only'));assert.ok(args.includes('no-new-privileges'));assert.ok(args.includes('ALL'));assert.ok(args.includes('1000:1000'));assert.ok(args.includes('--pids-limit'));
 assert.equal(args.filter(v=>v==='--mount').length,2);assert.ok(args.some(v=>v.includes('target=/input,readonly')));
 assert.deepEqual(args.slice(-3),['python','-I','-']);
 assert.equal(args.some(v=>/docker\.sock|privileged|env-file/.test(v)),false);
 assert.throws(()=>containerArgs('bad','bad','x','y','shell'));
 assert.throws(()=>containerArgs('moootion-exec-'+randomUUID(),'sha256:'+'a'.repeat(64),'x,readonly=false','y','shell'));
});
test('publishing accepts ordinary files, rejects hardlinks and junctions',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-sandbox-test-'));
 try{
  await fs.writeFile(path.join(root,'one.txt'),'ok');assert.deepEqual(await inspectOutputs(root),[{path:'one.txt',bytes:2}]);
  await fs.link(path.join(root,'one.txt'),path.join(root,'two.txt'));await assert.rejects(inspectOutputs(root),/hardlink/);await fs.unlink(path.join(root,'two.txt'));
  await fs.mkdir(path.join(root,'folder'));await fs.symlink(path.join(root,'folder'),path.join(root,'alias'),process.platform==='win32'?'junction':'dir');await assert.rejects(inspectOutputs(root),/Ссылки/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('pre-cancelled execution never starts Docker',async()=>{
 const abort=new AbortController();abort.abort();await assert.rejects(runSandbox('zz-sandbox',{language:'shell',code:'echo x',inputs:[]},abort.signal),/stopped/);
});

test('real container: Python libraries, shell, readonly input, no network/host files, timeout',{skip:process.env.MOOOTION_SANDBOX_INTEGRATION!=='1'},async()=>{
 const status=await sandboxStatus();assert.equal(status.ready,true,JSON.stringify(status));
 const id='zz-sandbox-'+randomUUID(),root=projectDir(id),signal=new AbortController().signal;
 await fs.mkdir(root);await fs.writeFile(path.join(root,'source.txt'),'original');
 try{
  const code=`import os, socket, subprocess\nimport numpy, cv2, scipy\nfrom PIL import Image\nassert open('/input/source.txt').read() == 'original'\ntry:\n open('/input/source.txt','w').write('bad')\n raise AssertionError('input writable')\nexcept OSError: pass\nassert not os.path.exists('/var/run/docker.sock')\nassert not os.path.exists('/host')\ns=socket.socket(); s.settimeout(1)\ntry:\n s.connect(('1.1.1.1',443))\n raise AssertionError('network reachable')\nexcept OSError: pass\nImage.new('RGBA',(32,32),(255,0,0,255)).save('/output/result.png')\nprint('libraries and isolation OK')\n`;
  const r=await runSandbox(id,{language:'python',code,inputs:['source.txt']},signal);assert.equal(r.exitCode,0,r.stderr);assert.equal(r.outputs.length,1);assert.match(r.stdout,/isolation OK/);assert.equal(await fs.readFile(path.join(root,'source.txt'),'utf8'),'original');
  const sh=await runSandbox(id,{language:'shell',code:'ffmpeg -version; printf done > /output/done.txt',inputs:[]},signal);assert.equal(sh.exitCode,0);assert.match(sh.stdout,/ffmpeg version/);
  await assert.rejects(runSandbox(id,{language:'shell',code:'sleep 30',inputs:[],timeoutSeconds:1},signal),/таймаут/);
 }finally{assert.equal(path.dirname(root),path.join(ROOT,'projects'));await fs.rm(root,{recursive:true,force:true});}
});
