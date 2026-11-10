import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {startDockerDesktop} from './docker-desktop-start';
import {ROOT} from './paths';
import {dockerBin, executorDocker, sandboxStatus, EXECUTOR_IMAGE} from './sandbox-executor';

type Status = {ready: boolean; reason?: string; image: string; imageId?: string; code?: string};
type Dependencies = {
  status: () => Promise<Status>;
  start: () => Promise<void>;
  build: () => Promise<void>;
  diagnostic: () => Promise<string | undefined>;
  wait: () => Promise<void>;
  now: () => number;
  timeoutMs: number;
  log: (message: string) => void;
};

/** One startup/build per API process, shared by startup and concurrent agent jobs. */
export function createExecutorStartup(deps: Dependencies) {
  let pending: Promise<Status> | undefined;
  let phase = 'idle';
  let last: Status | undefined;
  const state = () => ({phase, ...(last ?? {ready:false,image:EXECUTOR_IMAGE})});
  const ensure = () => pending ??= (async () => {
    try {
      phase = 'checking';
      let status = await deps.status();
      if (status.ready) {phase = 'ready'; return last = status;}
      if (status.code === 'wrong-engine') throw new Error(status.reason);
      // A running engine with a missing image needs a build, not another Desktop instance.
      if (status.code !== 'image-missing') {
        phase = 'starting'; deps.log('Запускаю Docker Desktop…');
        try {await deps.start();} catch (e) {throw new Error(await deps.diagnostic() ?? (e instanceof Error ? e.message : String(e)));}
        const reason = await deps.diagnostic();
        if (reason) throw new Error(reason);
        const deadline = deps.now() + deps.timeoutMs;
        while (true) {
          status = await deps.status();
          if (status.ready || status.code === 'image-missing') break;
          if (status.code === 'wrong-engine') throw new Error(status.reason);
          if (deps.now() >= deadline) throw new Error(status.reason ?? 'Docker не запустился за отведённое время');
          await deps.wait();
        }
      }
      if (!status.ready) {
        phase = 'building'; deps.log('Собираю образ изолированного Python/shell (первый запуск может занять несколько минут)…');
        await deps.build();
        status = await deps.status();
        if (!status.ready) throw new Error(status.reason ?? 'Образ исполнителя не готов после сборки');
      }
      phase = 'ready'; deps.log('Изолированный Python/shell готов');
      return last = status;
    } catch (e) {
      phase = 'unavailable';
      last = {ready:false,image:EXECUTOR_IMAGE,reason:e instanceof Error ? e.message : String(e)};
      deps.log(`Изолированный исполнитель недоступен: ${last.reason}`);
      return last;
    }
  })();
  return {ensure,state};
}

const exec = promisify(execFile);
const startup = createExecutorStartup({
  status: () => sandboxStatus(),
  start: async () => {
    // Native Docker CLI; no agent code and no arbitrary host shell.
    await startDockerDesktop(await dockerBin());
  },
  diagnostic: async () => {
    if (process.platform !== 'win32') return;
    // WSL's installed feature can still need a reboot before vmcompute becomes available.
    const {stdout} = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
      "$pending=Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending'; $compute=Get-Service vmcompute -ErrorAction SilentlyContinue; if($pending -and -not $compute){Write-Output 'REBOOT_REQUIRED'}"
    ], {windowsHide:true,timeout:15_000}).catch(() => ({stdout:''}));
    if (stdout.includes('REBOOT_REQUIRED')) return 'Windows ожидает перезагрузки после включения виртуализации; служба vmcompute ещё недоступна. Сохраните работу и перезагрузите компьютер вручную, затем запустите студию.';
  },
  build: async () => {
    const result = await executorDocker(['build','--tag',EXECUTOR_IMAGE,path.join(ROOT,'install','executor')], {timeout:20*60_000,maxOutput:16*1024*1024});
    if (result.code !== 0) throw new Error(`Не удалось собрать образ исполнителя: ${result.stderr.slice(-2000)}`);
  },
  now: Date.now,
  timeoutMs: 180_000,
  wait: () => new Promise(resolve => setTimeout(resolve,2000)),
  log: message => console.log(`[executor] ${message}`),
});

export const ensureExecutor = startup.ensure;
export const executorStartupState = startup.state;

/** A cancelled project stops waiting; it must not cancel another project's shared startup. */
export async function waitForExecutor(signal: AbortSignal, prepare = ensureExecutor) {
  if (signal.aborted) throw new Error('stopped');
  return new Promise<Status>((resolve,reject) => {
    const abort = () => reject(new Error('stopped'));
    signal.addEventListener('abort',abort,{once:true});
    prepare().then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}
