import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronBuilderCli = resolve(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
const windowsPowerShellDirectory = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0';
const appDirectory = resolve(projectRoot, 'out', 'sqlite-poc');
const sourceModulesDirectory = resolve(projectRoot, 'node_modules');
const stagedModulesDirectory = resolve(appDirectory, 'node_modules');

if (!existsSync(resolve(appDirectory, 'index.js'))) {
  throw new Error('SQLite PoC 目录打包失败：请先执行 sqlite:poc:build。');
}

// 目录包只带运行探针所需的三个模块，避免收集根项目的全部前端依赖。
mkdirSync(stagedModulesDirectory, { recursive: true });
cpSync(resolve(sourceModulesDirectory, 'better-sqlite3', 'lib'), resolve(stagedModulesDirectory, 'better-sqlite3', 'lib'), {
  recursive: true,
});
mkdirSync(resolve(stagedModulesDirectory, 'better-sqlite3', 'build', 'Release'), { recursive: true });
copyFileSync(
  resolve(sourceModulesDirectory, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  resolve(stagedModulesDirectory, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
);
cpSync(resolve(sourceModulesDirectory, 'bindings'), resolve(stagedModulesDirectory, 'bindings'), { recursive: true });
cpSync(resolve(sourceModulesDirectory, 'file-uri-to-path'), resolve(stagedModulesDirectory, 'file-uri-to-path'), {
  recursive: true,
});

const sourceSqlitePackage = JSON.parse(
  readFileSync(resolve(sourceModulesDirectory, 'better-sqlite3', 'package.json'), 'utf8'),
);
writeFileSync(
  resolve(stagedModulesDirectory, 'better-sqlite3', 'package.json'),
  `${JSON.stringify(
    {
      name: sourceSqlitePackage.name,
      version: sourceSqlitePackage.version,
      main: sourceSqlitePackage.main,
      dependencies: {
        bindings: sourceSqlitePackage.dependencies.bindings,
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);
writeFileSync(
  resolve(appDirectory, 'package.json'),
  `${JSON.stringify(
    {
      name: 'layout3-sqlite-poc',
      version: '0.0.0',
      private: true,
      type: 'module',
      main: 'index.js',
      dependencies: {
        'better-sqlite3': sourceSqlitePackage.version,
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

// electron-builder 26 会固定调用 powershell.exe，当前环境需要把系统标准目录补入子进程 PATH。
const result = spawnSync(
  process.execPath,
  [
    electronBuilderCli,
    '--dir',
    '--win',
    '--x64',
    '--config',
    'electron-builder.sqlite-poc.yml',
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH:
        process.platform === 'win32'
          ? `${windowsPowerShellDirectory}${delimiter}${process.env.PATH ?? ''}`
          : process.env.PATH,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`SQLite PoC 目录打包失败：electron-builder 退出码为 ${result.status ?? '未知'}。`);
}
