import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronPackagePath = join(projectRoot, 'node_modules', 'electron', 'package.json');
const sqlitePackagePath = join(projectRoot, 'node_modules', 'better-sqlite3');
const prebuildInstallPath = join(projectRoot, 'node_modules', 'prebuild-install', 'bin.js');
const nativeBindingPath = join(sqlitePackagePath, 'build', 'Release', 'better_sqlite3.node');
const expectedNativeBindingSha256 = '74a19708a559c80545b77f551b9bc9ccdc3ee205798d1946b929cc069073b063';

if (!existsSync(electronPackagePath) || !existsSync(sqlitePackagePath) || !existsSync(prebuildInstallPath)) {
  throw new Error('SQLite PoC 准备失败：请先执行 npm install。');
}

const electronPackage = JSON.parse(readFileSync(electronPackagePath, 'utf8'));
const electronVersion = String(electronPackage.version ?? '');

if (!electronVersion.startsWith('32.')) {
  throw new Error(`SQLite PoC 仅验证 Electron 32，当前版本为 ${electronVersion || '未知'}。`);
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('SQLite PoC 当前只验证 Windows x64 目录包。');
}

// 当前网络对 GitHub Release 直链不稳定，镜像只负责传输官方同名预编译资产。
const binaryHostMirror =
  process.env.npm_config_better_sqlite3_binary_host_mirror ??
  'https://npmmirror.com/mirrors/better-sqlite3';
const result = spawnSync(
  process.execPath,
  [
    prebuildInstallPath,
    '--runtime',
    'electron',
    '--target',
    electronVersion,
    '--platform',
    process.platform,
    '--arch',
    process.arch,
    '--force',
  ],
  {
    cwd: sqlitePackagePath,
    env: {
      ...process.env,
      npm_config_better_sqlite3_binary_host_mirror: binaryHostMirror,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`SQLite PoC 准备失败：预编译资产安装命令退出码为 ${result.status ?? '未知'}。`);
}

const actualNativeBindingSha256 = createHash('sha256')
  .update(readFileSync(nativeBindingPath))
  .digest('hex');
if (actualNativeBindingSha256 !== expectedNativeBindingSha256) {
  throw new Error('SQLite PoC 准备失败：Electron ABI 预编译资产校验值不一致。');
}

console.log(`SQLite Electron ABI 准备完成：Electron ${electronVersion}，SHA-256 校验通过。`);
