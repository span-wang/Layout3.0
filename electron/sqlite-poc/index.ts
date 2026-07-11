import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

type CheckName =
  | 'electron32Runtime'
  | 'electronAbi128'
  | 'contractEnvironmentGuard'
  | 'packagedApplication'
  | 'nativeModuleLoaded'
  | 'nativeModuleUnpacked'
  | 'electronViteExternalized'
  | 'schemaMigrationApplied'
  | 'explicitTransactionCommitted'
  | 'explicitTransactionRolledBack'
  | 'foreignKeyEnforced'
  | 'closedAndReopened'
  | 'backupCreated'
  | 'backupRestored'
  | 'temporaryDirectoryCleaned';

interface PocReport {
  schemaVersion: '1.0.0';
  taskId: 'PH3-13A-foundation-contract-spike-v1';
  status: 'passed' | 'failed';
  runtime: {
    electron: string;
    node: string;
    modules: string;
    betterSqlite3: string;
    sqlite: string;
  };
  settings: {
    foreignKeys: number;
    journalMode: string;
    busyTimeoutMs: number;
  };
  checks: Record<CheckName, boolean>;
  failureCategory?: 'native-module' | 'database-lifecycle';
}

const reportPath = resolve('evaluation', 'sqlite', 'sqlite-electron-poc-report.v1.json');
const checks: PocReport['checks'] = {
  electron32Runtime: false,
  electronAbi128: false,
  contractEnvironmentGuard: false,
  packagedApplication: false,
  nativeModuleLoaded: false,
  nativeModuleUnpacked: false,
  electronViteExternalized: false,
  schemaMigrationApplied: false,
  explicitTransactionCommitted: false,
  explicitTransactionRolledBack: false,
  foreignKeyEnforced: false,
  closedAndReopened: false,
  backupCreated: false,
  backupRestored: false,
  temporaryDirectoryCleaned: false,
};
const report: PocReport = {
  schemaVersion: '1.0.0',
  taskId: 'PH3-13A-foundation-contract-spike-v1',
  status: 'failed',
  runtime: {
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    modules: process.versions.modules,
    betterSqlite3: '',
    sqlite: '',
  },
  settings: {
    foreignKeys: 0,
    journalMode: '',
    busyTimeoutMs: 0,
  },
  checks,
};

let temporaryRoot: string | null = null;
let openDatabase: import('better-sqlite3').Database | null = null;

function writeReport(): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function assertCheck(name: CheckName, condition: boolean, message: string): void {
  checks[name] = condition;
  if (!condition) {
    throw new Error(message);
  }
}

async function runPoc(): Promise<void> {
  checks.electron32Runtime = report.runtime.electron.startsWith('32.');
  checks.electronAbi128 = report.runtime.modules === '128';
  checks.contractEnvironmentGuard = process.env.LAYOUT3_SQLITE_CONTRACT_POC === '1';
  assertCheck('packagedApplication', app.isPackaged, '当前进程不是 electron-builder 目录包。');

  // 读取当前构建产物，证明 electron-vite 保留了原生模块的外部 require。
  const builtSource = readFileSync(__filename, 'utf8');
  checks.electronViteExternalized = /\b(?:require|import)\((['"])better-sqlite3\1\)/.test(builtSource);

  let Database: typeof import('better-sqlite3');
  try {
    Database = (await import('better-sqlite3')).default;
    checks.nativeModuleLoaded = true;
  } catch (error) {
    report.failureCategory = 'native-module';
    throw error;
  }

  const unpackedNativeBindingPath = join(
    `${app.getAppPath()}.unpacked`,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  );
  assertCheck(
    'nativeModuleUnpacked',
    existsSync(unpackedNativeBindingPath),
    'better_sqlite3.node 没有落在 app.asar.unpacked。',
  );

  const sqlitePackage = JSON.parse(
    readFileSync(join(app.getAppPath(), 'node_modules', 'better-sqlite3', 'package.json'), 'utf8'),
  );
  report.runtime.betterSqlite3 = String(sqlitePackage.version ?? '');

  temporaryRoot = mkdtempSync(join(tmpdir(), 'layout3-sqlite-poc-'));
  const databasePath = join(temporaryRoot, 'primary.sqlite');
  const backupPath = join(temporaryRoot, 'backup.sqlite');
  const restoredPath = join(temporaryRoot, 'restored.sqlite');

  openDatabase = new Database(databasePath);
  openDatabase.pragma('foreign_keys = ON');
  report.settings.foreignKeys = Number(openDatabase.pragma('foreign_keys', { simple: true }));
  report.settings.journalMode = String(openDatabase.pragma('journal_mode = WAL', { simple: true }));
  openDatabase.pragma('busy_timeout = 5000');
  report.settings.busyTimeoutMs = Number(openDatabase.pragma('busy_timeout', { simple: true }));
  report.runtime.sqlite = String(
    (openDatabase.prepare('SELECT sqlite_version() AS version').get() as { version: string }).version,
  );

  openDatabase.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  // 每个迁移和业务写入都由显式事务包裹，后续登记库可以复用同一纪律。
  openDatabase.transaction(() => {
    openDatabase?.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );
      CREATE TABLE document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL
      );
    `);
    openDatabase
      ?.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(1, 'initial-registry-schema', '2026-07-10T00:00:00.000Z');
  })();
  assertCheck(
    'schemaMigrationApplied',
    Number(openDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations').pluck().get()) === 1,
    'schema_migrations 没有记录已执行迁移。',
  );

  openDatabase.transaction(() => {
    openDatabase?.prepare('INSERT INTO documents (id, title) VALUES (?, ?)').run('doc-1', 'SQLite PoC 文档');
    openDatabase
      ?.prepare('INSERT INTO document_versions (id, document_id, content_hash) VALUES (?, ?, ?)')
      .run('version-1', 'doc-1', 'sha256:poc');
  })();
  assertCheck(
    'explicitTransactionCommitted',
    Number(openDatabase.prepare('SELECT COUNT(*) AS count FROM document_versions').pluck().get()) === 1,
    '显式事务没有完整提交测试数据。',
  );

  try {
    openDatabase.transaction(() => {
      openDatabase?.prepare('INSERT INTO documents (id, title) VALUES (?, ?)').run('doc-rollback', '应回滚文档');
      throw new Error('触发回滚');
    })();
  } catch {
    // 这是有意触发的异常，用于确认 better-sqlite3 会回滚整个事务。
  }
  assertCheck(
    'explicitTransactionRolledBack',
    Number(openDatabase.prepare("SELECT COUNT(*) AS count FROM documents WHERE id = 'doc-rollback'").pluck().get()) === 0,
    '显式事务异常后没有回滚。',
  );

  try {
    openDatabase
      .prepare('INSERT INTO document_versions (id, document_id, content_hash) VALUES (?, ?, ?)')
      .run('orphan-version', 'missing-document', 'sha256:orphan');
  } catch (error) {
    checks.foreignKeyEnforced =
      (error as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY';
  }
  assertCheck('foreignKeyEnforced', checks.foreignKeyEnforced, '外键约束没有阻止孤儿版本记录。');

  openDatabase.close();
  openDatabase = new Database(databasePath);
  openDatabase.pragma('foreign_keys = ON');
  openDatabase.pragma('busy_timeout = 5000');
  assertCheck(
    'closedAndReopened',
    Number(openDatabase.prepare('SELECT COUNT(*) AS count FROM document_versions').pluck().get()) === 1,
    '数据库关闭重开后数据不一致。',
  );

  await openDatabase.backup(backupPath);
  assertCheck('backupCreated', existsSync(backupPath) && statSync(backupPath).size > 0, '数据库备份未生成。');
  openDatabase.close();
  openDatabase = null;

  copyFileSync(backupPath, restoredPath);
  openDatabase = new Database(restoredPath, { readonly: true });
  const restoredVersionCount = Number(
    openDatabase.prepare('SELECT COUNT(*) AS count FROM document_versions').pluck().get(),
  );
  const restoredMigrationCount = Number(
    openDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations').pluck().get(),
  );
  const integrityResult = String(openDatabase.pragma('integrity_check', { simple: true }));
  assertCheck(
    'backupRestored',
    restoredVersionCount === 1 && restoredMigrationCount === 1 && integrityResult === 'ok',
    '备份恢复后的数据或完整性检查不一致。',
  );
}

async function main(): Promise<void> {
  try {
    await runPoc();
  } catch (error) {
    report.failureCategory ??= 'database-lifecycle';
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    if (openDatabase?.open) {
      openDatabase.close();
    }
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
      checks.temporaryDirectoryCleaned = !existsSync(temporaryRoot);
    }

    const allChecksPassed = Object.values(checks).every(Boolean);
    report.status = allChecksPassed ? 'passed' : 'failed';
    if (allChecksPassed) {
      delete report.failureCategory;
    }
    writeReport();
    console.log(`SQLite Electron PoC：${report.status === 'passed' ? '通过' : '失败'}。`);
    app.exit(report.status === 'passed' ? 0 : 1);
  }
}

app.disableHardwareAcceleration();
if (process.env.LAYOUT3_SQLITE_CONTRACT_POC !== '1') {
  console.error('SQLite Electron PoC 未启用：缺少合同探针环境变量。');
  app.exit(2);
} else {
  void app.whenReady().then(main);
}
