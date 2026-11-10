import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {POLICY, auditSource, assertDestination, exportSource} from './publish.mjs';

async function fixture(t) {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-export-test-'));
  const root=path.join(base,'source'), target=path.join(base,'export');await fs.mkdir(root);
  for(const d of POLICY.directories)await fs.mkdir(path.join(root,d),{recursive:true});
  for(const p of POLICY.files){await fs.mkdir(path.dirname(path.join(root,p)),{recursive:true});await fs.writeFile(path.join(root,p),'fixture\n');}
  t.after(async()=>{
    const resolved=path.resolve(base);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('moootion-export-test-'));
    await fs.rm(resolved,{recursive:true,force:true});
  });
  return {base,root,target};
}
async function put(root,rel,data){await fs.mkdir(path.dirname(path.join(root,rel)),{recursive:true});await fs.writeFile(path.join(root,rel),data);}
const sha=b=>createHash('sha256').update(b).digest('hex');

test('existing target, source ancestors and source descendants are refused without changes',async t=>{
  const {base,root,target}=await fixture(t);await fs.mkdir(target);await put(target,'sentinel.txt','untouched');
  for(const p of [target,root,base,path.join(root,'new-export')])await assert.rejects(exportSource(root,p));
  assert.equal(await fs.readFile(path.join(target,'sentinel.txt'),'utf8'),'untouched');
  assert.deepEqual(await fs.readdir(target),['sentinel.txt']);
  const empty=path.join(base,'empty');await fs.mkdir(empty);await assert.rejects(assertDestination(root,empty),/exists/);
});

test('an existing ZIP or sidecar also blocks the export before target creation',async t=>{
  const {root,target}=await fixture(t);
  for(const suffix of ['.zip','.inventory.json','.sha256']){
    const dest=target+suffix;await fs.writeFile(dest,'keep');await assert.rejects(exportSource(root,target),/exists/);
    await assert.rejects(fs.stat(target),{code:'ENOENT'});assert.equal(await fs.readFile(dest,'utf8'),'keep');await fs.unlink(dest);
  }
});

test('source symlinks and destination junction ancestors fail closed',async t=>{
  const {root,target,base}=await fixture(t);const outside=path.join(base,'outside');await fs.mkdir(outside);
  const link=path.join(root,'server','linked');await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');
  assert.ok((await auditSource(root)).errors.some(x=>x.rule==='symlink-or-junction'));
  await assert.rejects(exportSource(root,target),/audit failed/);await assert.rejects(fs.stat(target),{code:'ENOENT'});
  const destlink=path.join(base,'redirect');await fs.symlink(outside,destlink,process.platform==='win32'?'junction':'dir');
  await assert.rejects(assertDestination(root,path.join(destlink,'new')),/link/i);
});

test('hardlinks, credential files, large files and secret content block export',async t=>{
  const {root,target,base}=await fixture(t);await put(root,'server/.env','API_KEY=placeholder');
  await put(root,'server/token.ts','export const token="'+'gh'+'p_'+'a'.repeat(36)+'";');
  await put(root,'server/private-path.ts','const home="'+'C:'+'\\Users\\real-person\\private'+'";');
  await fs.writeFile(path.join(base,'outside.txt'),'private');await fs.link(path.join(base,'outside.txt'),path.join(root,'server','hardlink.txt'));
  const h=await fs.open(path.join(root,'server','huge.txt'),'w');await h.truncate(POLICY.maxFileBytes+1);await h.close();
  const a=await auditSource(root);for(const rule of ['private-or-credential-file','service-token','personal-home-path','hardlink','large-file'])assert.ok(a.errors.some(x=>x.rule===rule),rule);
  await assert.rejects(exportSource(root,target),/audit failed/);await assert.rejects(fs.stat(target),{code:'ENOENT'});
  assert.ok(a.errors.every(x=>!JSON.stringify(x).includes('a'.repeat(36))),'diagnostics do not echo credential contents');
});

test('only allowlisted sources ship, exact method bytes survive, ZIP and sidecar hashes agree',async t=>{
  const {root,target}=await fixture(t);
  await put(root,'projects/personal/chat.json','private');await put(root,'.git/config','private');await put(root,'.moootion/history.git/config','private');
  await put(root,'docs/internal-review.md','private');await put(root,'rules/unreviewed.md','private');await put(root,'server/node_modules/private/index.js','private');
  await put(root,'server/example.test.ts','// S7 and Dodo are synthetic fixture names\n');
  const exact=Buffer.from('method\r\nexact\r\n');await put(root,'rules/astra-method-13.md',exact);
  const a=await auditSource(root);assert.equal(a.ok,true,JSON.stringify(a.errors));assert.ok(a.notices.some(x=>x.rule==='fixture-name-review'));
  const result=await exportSource(root,target);const inv=JSON.parse(await fs.readFile(result.inventory,'utf8'));
  for(const p of ['projects','.git','.moootion','docs/internal-review.md','rules/unreviewed.md','server/node_modules'])await assert.rejects(fs.stat(path.join(target,p)),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(path.join(target,'rules/astra-method-13.md')),exact);
  assert.match(await fs.readFile(path.join(target,'.gitignore'),'utf8'),/^projects\/$/m);
  assert.equal(await fs.readFile(path.join(root,'.gitignore'),'utf8'),'fixture\n');
  const zip=await fs.readFile(result.zip);assert.equal(sha(zip),inv.archive.sha256);
  let offset=0;const zipped=[];
  while(zip.readUInt32LE(offset)===0x04034b50){
    const size=zip.readUInt32LE(offset+18),nl=zip.readUInt16LE(offset+26),el=zip.readUInt16LE(offset+28),name=zip.subarray(offset+30,offset+30+nl).toString('utf8');
    const start=offset+30+nl+el,data=zip.subarray(start,start+size);const row=inv.files.find(x=>x.path===name);assert.ok(row);assert.equal(sha(data),row.sha256);zipped.push(name);offset=start+size;
  }
  assert.equal(zip.readUInt32LE(offset),0x02014b50);assert.equal(zipped.length,inv.files.length);
  for(const f of inv.files)assert.equal(sha(await fs.readFile(path.join(target,f.path))),f.sha256);
  assert.ok(!(await fs.readdir(target)).some(x=>x.endsWith('.inventory.json')||x.endsWith('.sha256')));
  await assert.rejects(exportSource(root,target),/exists/);
});
