import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT} from './paths';
import {readSettings} from './settings';
import {readJson} from '../tools/provider-context.mjs';
import {sandboxStatus} from './sandbox-executor';

export type SetupCheck = {id:string;name:string;ready:boolean;required:boolean;detail:string};
export async function setupStatus() {
  const settings = await readSettings();
  const provider = settings.agentProvider === 'codex' ? 'codex' : 'claude';
  const choices = await readJson(path.join(ROOT,'.moootion','setup.json'));
  const [git, executor, agent, runtime, connectors] = await Promise.all([
    promisify(execFile)('git',['--version'],{timeout:10000}).then(()=>true,()=>false),
    sandboxStatus(),
    provider === 'codex' ? (await import('./codex')).codexStatus() : (await import('./claude')).claudeStatus(),
    Promise.all(['node_modules/typescript/bin/tsc','node_modules/@remotion/renderer/package.json','node_modules/@remotion/cli/remotion-cli.js','node_modules/vite/bin/vite.js'].map(p=>fs.access(path.join(ROOT,p)))).then(()=>true,()=>false),
    // Both providers inspect connector status without starting a generation.
    provider === 'codex' ? (await import('./codex-connectors')).codexConnectorsStatus() : (await import('./claude')).connectorsStatus(),
  ]);
  const checks:SetupCheck[] = [
    {id:'runtime',name:'Сборка и рендер',ready:runtime,required:true,detail:runtime?'TypeScript, Remotion и FFmpeg установлены':'Запустите установку зависимостей: npm ci'},
    {id:'git',name:'Git · версии проектов',ready:git,required:true,detail:git?'Установлен':'Установите Git через moootion setup'},
    {id:'agent',name:provider==='codex'?'Codex / ChatGPT':'Claude',ready:Boolean(agent.cli&&(agent.login||agent.apiKey)),required:true,detail:!agent.cli?'Установите выбранного агента: moootion setup':agent.login||agent.apiKey?'Вход найден':'Войдите в аккаунт выбранного агента'},
    {id:'docker',name:'Docker · Python и shell',ready:executor.ready,required:choices.docker !== false,detail:executor.ready?'Образ исполнителя готов':executor.reason??'Выполните moootion setup'},
  ];
  for(const id of ['figma','magnific']) {
    const c=connectors?.connectors.find(c=>c.id===id);
    checks.push({id,name:id==='figma'?'Figma':'Magnific',ready:c?.status==='connected',required:Array.isArray(choices.connectors)&&choices.connectors.includes(id),detail:c?.status==='connected'?`${c.tools} инструментов`:provider==='claude'?'Подключите в claude.ai → Настройки → Коннекторы; проверьте подключение в студии':'Подключите сервис в настройках ниже'});
  }
  if(Array.isArray(choices.failures)&&choices.failures.length)checks.push({id:'installation',name:'Проверка установки',ready:false,required:true,detail:'Последняя проверка завершилась с ошибкой. Повторите moootion setup.'});
  return {provider,ready:checks.filter(c=>c.required).every(c=>c.ready),checks};
}
