import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, ipcMain } from 'electron';

type AiProvider = 'openai' | 'anthropic' | 'custom';
type GenerateType = 'lecture' | 'summary' | 'exercise' | 'exam';
type GenerateLength = 'short' | 'medium' | 'long';

interface AiGenerationRecord {
  id: string;
  type: GenerateType;
  typeLabel: string;
  topic: string;
  grade?: string;
  subject?: string;
  length?: GenerateLength;
  lengthLabel?: string;
  provider?: AiProvider;
  model?: string;
  content: string;
  createdAt: string;
}

interface LegacyAiGenerationRecordFile {
  version: 1;
  records: AiGenerationRecord[];
}

interface SingleAiGenerationRecordFile {
  version: 1;
  record: AiGenerationRecord;
}

interface AiGenerationRecordDirectoryResult {
  recordDirectoryPath: string;
  records: AiGenerationRecord[];
}

interface AiGenerationRecordWorkspacePayload {
  workspaceRootPath?: string | null;
}

interface AddAiGenerationRecordPayload extends AiGenerationRecordWorkspacePayload {
  record: Omit<AiGenerationRecord, 'id' | 'createdAt'> & Partial<Pick<AiGenerationRecord, 'id' | 'createdAt'>>;
}

interface DeleteAiGenerationRecordPayload extends AiGenerationRecordWorkspacePayload {
  recordId: string;
}

interface AiGenerationRecordDiskEntry {
  filePath: string;
  record: AiGenerationRecord;
}

const AI_RECORDS_DIR_NAME = 'AI生成记录';
const LEGACY_AI_RECORDS_FILE_NAME = 'records.json';
const AI_RECORD_FILE_EXTENSION = '.json';

function getDefaultWorkspacePath(): string {
  return path.join(app.getPath('documents'), 'LAYOUT3.0', '默认工作区');
}

function resolveWorkspaceRootPath(workspaceRootPath?: string | null): string {
  const trimmedPath = workspaceRootPath?.trim();
  return trimmedPath ? trimmedPath : getDefaultWorkspacePath();
}

function getAiRecordDirectoryPath(workspaceRootPath?: string | null): string {
  return path.join(resolveWorkspaceRootPath(workspaceRootPath), AI_RECORDS_DIR_NAME);
}

function getLegacyAiRecordFilePath(recordDirectoryPath: string): string {
  return path.join(recordDirectoryPath, LEGACY_AI_RECORDS_FILE_NAME);
}

function createRecordId(): string {
  return `ai-record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isKnownGenerateType(value: unknown): value is GenerateType {
  return value === 'lecture' || value === 'summary' || value === 'exercise' || value === 'exam';
}

function isKnownGenerateLength(value: unknown): value is GenerateLength {
  return value === 'short' || value === 'medium' || value === 'long';
}

function isKnownProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'anthropic' || value === 'custom';
}

function normalizeRecord(value: unknown): AiGenerationRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.content !== 'string' || typeof raw.topic !== 'string') {
    return null;
  }

  return {
    id: raw.id,
    type: isKnownGenerateType(raw.type) ? raw.type : 'lecture',
    typeLabel: typeof raw.typeLabel === 'string' ? raw.typeLabel : '讲义',
    topic: raw.topic,
    grade: typeof raw.grade === 'string' ? raw.grade : undefined,
    subject: typeof raw.subject === 'string' ? raw.subject : undefined,
    length: isKnownGenerateLength(raw.length) ? raw.length : undefined,
    lengthLabel: typeof raw.lengthLabel === 'string' ? raw.lengthLabel : undefined,
    provider: isKnownProvider(raw.provider) ? raw.provider : undefined,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    content: raw.content,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

function normalizeRecords(records: unknown): AiGenerationRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .map(normalizeRecord)
    .filter((record): record is AiGenerationRecord => record !== null)
    .sort((left, right) => {
      const rightTime = Date.parse(right.createdAt) || 0;
      const leftTime = Date.parse(left.createdAt) || 0;
      return rightTime - leftTime;
    });
}

function sanitizeRecordFileNamePart(value: string): string {
  const safeName = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\.+$/g, '_')
    .trim();

  return safeName.slice(0, 120) || 'ai-record';
}

function getRecordFilePath(recordDirectoryPath: string, recordId: string): string {
  return path.join(recordDirectoryPath, `${sanitizeRecordFileNamePart(recordId)}${AI_RECORD_FILE_EXTENSION}`);
}

function isRecordJsonFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(AI_RECORD_FILE_EXTENSION) && fileName !== LEGACY_AI_RECORDS_FILE_NAME;
}

function parseSingleRecordFile(raw: string, filePath: string): AiGenerationRecord {
  if (!raw.trim()) {
    throw new Error(`AI 生成记录文件为空：${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`AI 生成记录文件格式损坏：${filePath}`);
  }

  // 新格式是 { version, record }，这里兼容直接存单条记录对象的手工文件。
  const candidate =
    parsed && typeof parsed === 'object' && 'record' in parsed
      ? (parsed as { record?: unknown }).record
      : parsed;
  const record = normalizeRecord(candidate);
  if (!record) {
    throw new Error(`AI 生成记录文件格式损坏：${filePath}`);
  }

  return record;
}

async function readRecordEntries(recordDirectoryPath: string): Promise<AiGenerationRecordDiskEntry[]> {
  let directoryEntries;
  try {
    directoryEntries = await readdir(recordDirectoryPath, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const records: AiGenerationRecordDiskEntry[] = [];
  for (const entry of directoryEntries) {
    if (!entry.isFile() || !isRecordJsonFile(entry.name)) {
      continue;
    }

    const filePath = path.join(recordDirectoryPath, entry.name);
    const raw = await readFile(filePath, 'utf8');
    records.push({
      filePath,
      record: parseSingleRecordFile(raw, filePath),
    });
  }

  return records.sort((left, right) => {
    const rightTime = Date.parse(right.record.createdAt) || 0;
    const leftTime = Date.parse(left.record.createdAt) || 0;
    return rightTime - leftTime;
  });
}

async function readLegacyRecordFile(
  recordDirectoryPath: string,
): Promise<{ filePath: string; records: AiGenerationRecord[] } | null> {
  const legacyFilePath = getLegacyAiRecordFilePath(recordDirectoryPath);

  try {
    const raw = await readFile(legacyFilePath, 'utf8');
    if (!raw.trim()) {
      return { filePath: legacyFilePath, records: [] };
    }

    let parsed: LegacyAiGenerationRecordFile;
    try {
      parsed = JSON.parse(raw) as LegacyAiGenerationRecordFile;
    } catch {
      throw new Error(`AI 生成记录旧文件格式损坏：${legacyFilePath}`);
    }

    return {
      filePath: legacyFilePath,
      records: normalizeRecords(parsed.records),
    };
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function writeSingleRecordFile(recordDirectoryPath: string, record: AiGenerationRecord): Promise<void> {
  const normalizedRecord = normalizeRecord(record);
  if (!normalizedRecord) {
    throw new Error('AI 生成记录数据不完整，无法保存');
  }

  await mkdir(recordDirectoryPath, { recursive: true });
  const content: SingleAiGenerationRecordFile = {
    version: 1,
    record: normalizedRecord,
  };
  await writeFile(
    getRecordFilePath(recordDirectoryPath, normalizedRecord.id),
    `${JSON.stringify(content, null, 2)}\n`,
    'utf8',
  );
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function migrateLegacyRecordFile(recordDirectoryPath: string): Promise<void> {
  const legacyRecordFile = await readLegacyRecordFile(recordDirectoryPath);
  if (!legacyRecordFile) {
    return;
  }

  const existingEntries = await readRecordEntries(recordDirectoryPath);
  const existingRecordIds = new Set(existingEntries.map((entry) => entry.record.id));

  // 迁移旧 records.json 时不覆盖同 ID 的新文件，避免用户已经手工修过单条记录后被旧文件覆盖。
  for (const record of legacyRecordFile.records) {
    if (existingRecordIds.has(record.id)) {
      continue;
    }

    await writeSingleRecordFile(recordDirectoryPath, record);
    existingRecordIds.add(record.id);
  }

  await unlinkIfExists(legacyRecordFile.filePath);
}

async function readAiRecordDirectory(
  workspaceRootPath?: string | null,
): Promise<AiGenerationRecordDirectoryResult> {
  const recordDirectoryPath = getAiRecordDirectoryPath(workspaceRootPath);

  await migrateLegacyRecordFile(recordDirectoryPath);
  const entries = await readRecordEntries(recordDirectoryPath);

  return {
    recordDirectoryPath,
    records: entries.map((entry) => entry.record),
  };
}

async function addAiGenerationRecord({
  workspaceRootPath,
  record,
}: AddAiGenerationRecordPayload): Promise<AiGenerationRecordDirectoryResult> {
  if (!record.content.trim()) {
    throw new Error('AI 生成内容为空，无法保存记录');
  }

  const currentDirectory = await readAiRecordDirectory(workspaceRootPath);
  const nextRecord: AiGenerationRecord = {
    ...record,
    id: record.id?.trim() || createRecordId(),
    createdAt: record.createdAt?.trim() || new Date().toISOString(),
  };

  await writeSingleRecordFile(currentDirectory.recordDirectoryPath, nextRecord);
  return readAiRecordDirectory(workspaceRootPath);
}

async function deleteAiGenerationRecord({
  workspaceRootPath,
  recordId,
}: DeleteAiGenerationRecordPayload): Promise<AiGenerationRecordDirectoryResult> {
  const currentDirectory = await readAiRecordDirectory(workspaceRootPath);
  const entries = await readRecordEntries(currentDirectory.recordDirectoryPath);

  for (const entry of entries) {
    if (entry.record.id === recordId) {
      await unlinkIfExists(entry.filePath);
    }
  }

  return readAiRecordDirectory(workspaceRootPath);
}

async function clearAiGenerationRecords(
  payload: AiGenerationRecordWorkspacePayload,
): Promise<AiGenerationRecordDirectoryResult> {
  const recordDirectoryPath = getAiRecordDirectoryPath(payload.workspaceRootPath);
  let directoryEntries;

  try {
    directoryEntries = await readdir(recordDirectoryPath, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { recordDirectoryPath, records: [] };
    }

    throw error;
  }

  for (const entry of directoryEntries) {
    if (entry.isFile() && (isRecordJsonFile(entry.name) || entry.name === LEGACY_AI_RECORDS_FILE_NAME)) {
      await unlinkIfExists(path.join(recordDirectoryPath, entry.name));
    }
  }

  return { recordDirectoryPath, records: [] };
}

export function registerAiRecordHandlers(): void {
  ipcMain.handle('aiRecords:list', (_event, payload: AiGenerationRecordWorkspacePayload) =>
    readAiRecordDirectory(payload?.workspaceRootPath),
  );
  ipcMain.handle('aiRecords:add', (_event, payload: AddAiGenerationRecordPayload) =>
    addAiGenerationRecord(payload),
  );
  ipcMain.handle('aiRecords:delete', (_event, payload: DeleteAiGenerationRecordPayload) =>
    deleteAiGenerationRecord(payload),
  );
  ipcMain.handle('aiRecords:clear', (_event, payload: AiGenerationRecordWorkspacePayload) =>
    clearAiGenerationRecords(payload ?? {}),
  );
}
