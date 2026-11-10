#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {initializeProvider, readJson, saveJson, resolveProvider} from './provider-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const exists = p => fs.access(p).then(()=>true,()=>false);
const options = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
  if (!match || !['provider','yes','check','login','docker','connectors','skip-render','help'].includes(match[1])) throw new Error(`Неизвестный параметр: ${arg}`);
  options.set(match[1], match[2] ?? true);
}
const run = (bin,args,env={}) => new Promise((resolve,reject)=>{
  const child = spawn(bin,args,{cwd:ROOT,stdio:'inherit',shell:false,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,...env}});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${path.basename(bin)}: код ${code}`)));
});
async function probe() {
  const {stdout}=await exec(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/setup-status.ts'],{cwd:ROOT,timeout:150000,maxBuffer:2*1024*1024});
  return JSON.parse(stdout.trim().split('\n').at(-1));
}
async function agentCommand(provider) {
  const code = provider==='codex' ? "import {findCodex} from './server/codex.ts'; console.log(JSON.stringify(await findCodex()));" : "import {bundledClaude} from './server/claude.ts'; console.log(JSON.stringify(bundledClaude()));";
  const {stdout}=await exec(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:ROOT});
  const bin=JSON.parse(stdout.trim());
  return bin ? /\.m?js$/i.test(bin) ? [process.execPath,[bin]] : [bin,[]] : null;
}
async function dockerCommand() {
  const candidates = process.platform==='darwin' ? [path.join(os.homedir(),'.docker/bin/docker'),'/Applications/Docker.app/Contents/Resources/bin/docker'] : process.platform==='win32' ? [path.join(process.env.ProgramFiles??'C:\\Program Files','Docker/Docker/resources/bin/docker.exe'),path.join(process.env.LOCALAPPDATA??'','Programs/DockerDesktop/resources/bin/docker.exe')] : [];
  const bin=(await Promise.all(candidates.map(async p=>await exists(p)?p:null))).find(Boolean) ?? (process.platform==='win32'?'docker.exe':'docker');
  let host=process.platform==='win32'?'npipe:////./pipe/docker_engine':'unix:///var/run/docker.sock';
  const socket=path.join(os.homedir(),'.docker/run/docker.sock');
  if(process.platform==='darwin' && await exists(socket))host=`unix://${socket}`;
  return {bin,host};
}
async function main() {
  if(options.has('help')) {
    console.log('moootion setup [--provider=chatgpt|claude] [--yes] [--docker=install|skip] [--connectors=figma,magnific|none]\nmoootion doctor (проверка без установки)\nmoootion login (вход в выбранный аккаунт)\n--yes разрешает установку компонентов; вход и условия сервисов остаются в штатных окнах.');return;
  }
  if(options.has('check')) {
    const status=await probe();console.log(JSON.stringify(status,null,2));process.exitCode=status.ready?0:2;return;
  }
  const saved=await readJson(path.join(ROOT,'.moootion/settings.json'));
  const explicit=options.get('provider');
  if(explicit===true)throw new Error('Укажите --provider=chatgpt или --provider=claude');
  let provider=resolveProvider({explicit,saved:saved.agentProvider});
  const interactive=Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const rl=interactive?createInterface({input:process.stdin,output:process.stdout}):null;
  const answer=async(label,defaultYes=true)=>{
    if(options.has('yes'))return true;
    if(!rl)return false;
    const value=(await rl.question(`${label} ${defaultYes?'[Y/n]':'[y/N]'} `)).trim().toLowerCase();
    return value?['y','yes','д','да'].includes(value):defaultYes;
  };
  try {
    if(!provider && rl)provider=resolveProvider({explicit:(await rl.question('Откуда устанавливаете: ChatGPT/Codex или Claude? ')).trim(),env:{}});
    if(!provider)throw new Error('Источник установки не определён. Укажите --provider=chatgpt или --provider=claude.');
    console.log(`Агент студии: ${provider==='codex'?'Codex / ChatGPT':'Claude'}`);
    await initializeProvider(ROOT,{explicit:provider});
    let command=await agentCommand(provider);
    if(options.has('login')) {
      if(!command)throw new Error('Агент не установлен. Выполните moootion setup.');
      await run(command[0],[...command[1],...(provider==='codex'?['login']:['auth','login'])]);return;
    }
    console.log('Проверяю сборку, Git, аккаунт, Docker, Figma и Magnific…');
    let status=await probe();
    const previous=await readJson(path.join(ROOT,'.moootion/setup.json'));
    const dockerOption=options.get('docker');
    if(dockerOption!==undefined && !['install','skip'].includes(dockerOption))throw new Error('--docker=install или --docker=skip');
    const connectorsOption=options.get('connectors');
    if(connectorsOption!==undefined && (typeof connectorsOption!=='string'||(connectorsOption!=='none'&&connectorsOption.split(',').some(x=>!['figma','magnific'].includes(x)))))throw new Error('--connectors=figma,magnific или --connectors=none');
    const missing=id=>!status.checks.find(c=>c.id===id)?.ready;
    console.log(status.checks.map(c=>`${c.ready?'✓':'○'} ${c.name}: ${c.detail}`).join('\n'));
    if(!interactive && !options.has('yes') && (previous.docker===undefined && dockerOption===undefined || !Array.isArray(previous.connectors) && connectorsOption===undefined || !command || missing('git'))) {
      console.log('Нужен выбор компонентов: Docker для Python/shell, Figma для макетов, Magnific для генерации; агент и Git устанавливаются при отсутствии.');
      console.log('Запустите moootion setup в терминале либо после выбора компонентов передайте --yes --docker=install|skip --connectors=figma,magnific|none.');
      process.exitCode=2;return;
    }
    // Collect choices before downloading anything or opening login windows.
    const installAgent=!command && await answer(`Установить ${provider==='codex'?'Codex CLI':'Claude Agent SDK'}?`);
    const installGit=missing('git') && await answer('Установить Git для версий проектов?');
    const docker= dockerOption ? dockerOption==='install' : previous.docker ?? await answer('Подготовить Docker, Python, OpenCV, SciPy, Pillow и FFmpeg для скриптов?');
    const connectors=connectorsOption!==undefined ? connectorsOption==='none'?[]:connectorsOption.split(',') : Array.isArray(previous.connectors)?previous.connectors:[];
    if(connectorsOption===undefined && !Array.isArray(previous.connectors))for(const id of ['figma','magnific'])if(await answer(id==='figma'?'Подключить Figma для импорта макетов?':'Подключить Magnific для изображений, видео и звука?'))connectors.push(id);
    const login=missing('agent') && await answer(`Открыть вход в ${provider==='codex'?'ChatGPT / Codex':'Claude'} после установки?`);
    const choices={version:1,provider,docker,connectors,updatedAt:new Date().toISOString()};
    await saveJson(path.join(ROOT,'.moootion/setup.json'),choices);
    const failures=[];
    const step=async(name,action)=>{try{console.log(`\n${name}…`);await action();}catch(e){failures.push(`${name}: ${e.message}`);console.error(failures.at(-1));}};
    if(installAgent)await step('Установка агента',async()=>{
      const npmCandidates=[path.join(ROOT,'.runtime/node',process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'lib/node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'../lib/node_modules/npm/bin/npm-cli.js')];
      const npm=(await Promise.all(npmCandidates.map(async p=>await exists(p)?p:null))).find(Boolean);
      if(!npm)throw new Error('npm не найден; установите Node.js 22 с npm');
      if(provider==='codex')await run(process.execPath,[npm,'install','--prefix',path.join(ROOT,'.runtime/agents'),'--no-audit','--no-fund','@openai/codex']);
      else {
        const lock=await readJson(path.join(ROOT,'package-lock.json'));
        const version=lock.packages?.['node_modules/@anthropic-ai/claude-agent-sdk']?.version;
        if(!version)throw new Error('Нет закреплённой версии Claude Agent SDK');
        await run(process.execPath,[npm,'install','--no-save','--no-audit','--no-fund',`@anthropic-ai/claude-agent-sdk@${version}`]);
      }
      command=await agentCommand(provider);
    });
    const dependency=async(name)=>{
      if(process.platform==='darwin')await run('/bin/bash',[path.join(ROOT,'install/dependencies.sh'),name]);
      else if(process.platform==='win32')await run('powershell.exe',['-NoProfile','-File',path.join(ROOT,'install/dependencies.ps1'),'-Component',name]);
      else throw new Error('Установите Git и Docker средствами вашей ОС, затем повторите setup');
    };
    if(installGit)await step('Установка Git',()=>dependency('git'));
    if(docker && missing('docker'))await step('Подготовка Docker',async()=>{
      let d=await dockerCommand();
      const installed=await exec(d.bin,['--version']).then(()=>true,()=>false);
      if(!installed)await dependency('docker');
      d=await dockerCommand();
      const linux=await exec(d.bin,['--host',d.host,'info','--format','{{.OSType}}'],{timeout:15000}).then(r=>r.stdout.trim()==='linux',()=>false);
      if(!linux)throw new Error('Завершите первый запуск Docker Desktop (условия и системные запросы), дождитесь запуска Linux-движка и повторите moootion setup.');
      await run(d.bin,['--host',d.host,'build','-t','moootion-executor:1',path.join(ROOT,'install/executor')],{PATH:path.dirname(d.bin)+path.delimiter+process.env.PATH});
      await run(process.execPath,['--import','tsx','--test','server/sandbox-executor.test.ts'],{MOOOTION_SANDBOX_INTEGRATION:'1'});
    });
    if(login && command && interactive)await step('Вход в аккаунт',()=>run(command[0],[...command[1],...(provider==='codex'?['login']:['auth','login'])]));
    else if(login && !interactive)console.log('Для входа выполните moootion login в терминале или войдите через настройки студии.');
    if(!options.has('skip-render'))await step('Пробный рендер',()=>run(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/smoke.ts']));
    status=await probe();
    const pending=status.checks.filter(c=>c.required&&!c.ready);
    await saveJson(path.join(ROOT,'.moootion/setup.json'),{...choices,ready:!pending.length&&!failures.length,checkedAt:new Date().toISOString(),pending:pending.map(c=>c.id),failures});
    console.log('\n'+status.checks.map(c=>`${c.ready?'✓':'○'} ${c.name}: ${c.detail}${!c.required?' (по желанию)':''}`).join('\n'));
    if(connectors.some(id=>status.checks.some(c=>c.id===id&&!c.ready)))console.log(provider==='codex'?'Откройте http://localhost:5173/?setup=1 → Подключения Codex и войдите в выбранные сервисы.':'Подключите выбранные сервисы в claude.ai → Настройки → Коннекторы, затем проверьте подключения в студии.');
    if(pending.length||failures.length){console.log('Установка требует завершения перечисленных шагов. Повторить: moootion setup');process.exitCode=2;}
    else console.log('Проверки пройдены. Запуск: moootion');
    if(!interactive&&!options.has('yes'))console.log('Для установки недостающих компонентов из AI-чата: moootion setup --yes --docker=install --connectors=figma,magnific');
  } finally {rl?.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
