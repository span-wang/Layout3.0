import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

interface AiGenerationRecordFile {
  version: 1;
  records: AiGenerationRecord[];
}

interface AiGenerationRecordFileResult {
  recordFilePath: string;
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

const AI_RECORDS_DIR_NAME = 'AI生成记录';
const AI_RECORDS_FILE_NAME = 'records.json';

function getDefaultWorkspacePath(): string {
  return path.join(app.getPath('documents'), 'LAYOUT3.0', '默认工作区');
}

function resolveWorkspaceRootPath(workspaceRootPath?: string | null): string {
  const trimmedPath = workspaceRootPath?.trim();
  return trimmedPath ? trimmedPath : getDefaultWorkspacePath();
}

function getAiRecordFilePath(workspaceRootPath?: string | null): string {
  return path.join(resolveWorkspaceRootPath(workspaceRootPath), AI_RECORDS_DIR_NAME, AI_RECORDS_FILE_NAME);
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
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

async function readAiRecordFile(workspaceRootPath?: string | null): Promise<AiGenerationRecordFileResult> {
  const recordFilePath = getAiRecordFilePath(workspaceRootPath);

  try {
    const raw = await readFile(recordFilePath, 'utf8');
    if (!raw.trim()) {
      return { recordFilePath, records: [] };
    }

    let parsed: AiGenerationRecordFile;
    try {
      parsed = JSON.parse(raw) as AiGenerationRecordFile;
    } catch {
      throw new Error(`AI 生成记录文件格式损坏：${recordFilePath}`);
    }

    return {
      recordFilePath,
      records: normalizeRecords(parsed.records),
    };
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { recordFilePath, records: [] };
    }

    throw error;
  }
}

async function writeAiRecordFile(
  recordFilePath: string,
  records: AiGenerationRecord[],
): Promise<AiGenerationRecordFileResult> {
  await mkdir(path.dirname(recordFilePath), { recursive: true });
  const sortedRecords = normalizeRecords(records);
  const content: AiGenerationRecordFile = {
    version: 1,
    records: sortedRecords,
  };

  await writeFile(recordFilePath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  return { recordFilePath, records: sortedRecords };
}

async function addAiGenerationRecord({
  workspaceRootPath,
  record,
}: AddAiGenerationRecordPayload): Promise<AiGenerationRecordFileResult> {
  if (!record.content.trim()) {
    throw new Error('AI 生成内容为空，无法保存记录');
  }

  const currentFile = await readAiRecordFile(workspaceRootPath);
  const nextRecord: AiGenerationRecord = {
    ...record,
    id: record.id?.trim() || createRecordId(),
    createdAt: record.createdAt?.trim() || new Date().toISOString(),
  };

  return writeAiRecordFile(currentFile.recordFilePath, [nextRecord, ...currentFile.records]);
}

async function deleteAiGenerationRecord({
  workspaceRootPath,
  recordId,
}: DeleteAiGenerationRecordPayload): Promise<AiGenerationRecordFileResult> {
  const currentFile = await readAiRecordFile(workspaceRootPath);
  const nextRecords = currentFile.records.filter((record) => record.id !== recordId);
  return writeAiRecordFile(currentFile.recordFilePath, nextRecords);
}

async function clearAiGenerationRecords(
  payload: AiGenerationRecordWorkspacePayload,
): Promise<AiGenerationRecordFileResult> {
  const recordFilePath = getAiRecordFilePath(payload.workspaceRootPath);
  return writeAiRecordFile(recordFilePath, []);
}

export function registerAiRecordHandlers(): void {
  ipcMain.handle('aiRecords:list', (_event, payload: AiGenerationRecordWorkspacePayload) =>
    readAiRecordFile(payload?.workspaceRootPath),
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
