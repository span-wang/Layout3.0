import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { applyRegistryMigrations, getAppliedSchemaVersion, REGISTRY_SCHEMA_VERSION } from './schema';
import { RegistryError } from './types';

export interface OpenRegistryDatabaseOptions {
  databasePath: string;
  backupDirectory?: string;
  busyTimeoutMs?: number;
  now?: () => Date;
  allowTestProcess?: boolean;
}

export class RegistryDatabase {
  private closed = false;

  constructor(
    readonly connection: Database.Database,
    readonly databasePath: string,
    readonly migrationBackupPath: string | null,
  ) {}

  close(): void {
    if (this.closed) {
      return;
    }

    this.connection.close();
    this.closed = true;
  }
}

function assertDatabaseOwner(allowTestProcess: boolean): void {
  const processType = (process as NodeJS.Process & { type?: string }).type;
  if (processType !== 'browser' && !allowTestProcess) {
    throw new RegistryError(
      'DATABASE_OWNER_VIOLATION',
      '资料登记库只允许 Electron Main 或显式测试进程持有。',
    );
  }
}

function buildBackupPath(databasePath: string, backupDirectory: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return join(backupDirectory, `${basename(databasePath)}.${timestamp}.pre-migration.bak`);
}

export async function openRegistryDatabase(
  options: OpenRegistryDatabaseOptions,
): Promise<RegistryDatabase> {
  assertDatabaseOwner(options.allowTestProcess === true);

  const now = options.now ?? (() => new Date());
  const databaseExisted = existsSync(options.databasePath) && statSync(options.databasePath).size > 0;
  mkdirSync(dirname(options.databasePath), { recursive: true });

  const database = new Database(options.databasePath);
  let migrationBackupPath: string | null = null;

  try {
    database.pragma('foreign_keys = ON');
    database.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);

    const appliedVersion = getAppliedSchemaVersion(database);
    if (appliedVersion > REGISTRY_SCHEMA_VERSION) {
      throw new RegistryError(
        'UNSUPPORTED_SCHEMA_VERSION',
        `资料登记库版本 ${appliedVersion} 高于当前程序支持的 ${REGISTRY_SCHEMA_VERSION}，已拒绝写入。`,
      );
    }
    database.pragma('journal_mode = WAL');
    if (databaseExisted && appliedVersion < REGISTRY_SCHEMA_VERSION) {
      const backupDirectory = options.backupDirectory ?? join(dirname(options.databasePath), 'backups');
      mkdirSync(backupDirectory, { recursive: true });
      migrationBackupPath = buildBackupPath(options.databasePath, backupDirectory, now());

      // backup() 使用 SQLite 在线备份协议，能把 WAL 中已提交内容一并纳入迁移前快照。
      await database.backup(migrationBackupPath);
    }

    applyRegistryMigrations(database, now().toISOString());

    const integrityResult = String(database.pragma('integrity_check', { simple: true }));
    if (integrityResult !== 'ok') {
      throw new RegistryError(
        'DATABASE_INTEGRITY_FAILED',
        `资料登记库完整性检查失败：${integrityResult}`,
      );
    }

    return new RegistryDatabase(database, options.databasePath, migrationBackupPath);
  } catch (error) {
    if (database.open) {
      database.close();
    }
    throw error;
  }
}
