import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = resolve(
  projectRoot,
  'release',
  'sqlite-poc',
  'win-unpacked',
  'LAYOUT3-SQLite-PoC.exe',
);

if (!existsSync(executablePath)) {
  throw new Error('SQLite PoC 运行失败：未找到 electron-builder 目录包。');
}

// 专用环境变量避免普通应用启动时误执行会创建和删除临时数据库的合同探针。
const result = spawnSync(executablePath, [], {
  cwd: projectRoot,
  env: {
    ...process.env,
    LAYOUT3_SQLITE_CONTRACT_POC: '1',
  },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`SQLite PoC 运行失败：目录包退出码为 ${result.status ?? '未知'}。`);
}
