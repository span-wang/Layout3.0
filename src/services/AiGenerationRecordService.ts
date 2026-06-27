import type { AiGenerationRecord, AiGenerationRecordFileResult } from '@/types/ai';

type AiRecordApiMethodName =
  | 'listAiGenerationRecords'
  | 'addAiGenerationRecord'
  | 'deleteAiGenerationRecord'
  | 'clearAiGenerationRecords';

function requireAiRecordApiMethod<T extends AiRecordApiMethodName>(methodName: T) {
  const method = window.layoutAPI?.[methodName];

  if (typeof method !== 'function') {
    throw new Error('当前窗口尚未加载最新 AI 生成记录接口，请重启应用后重试');
  }

  return method;
}

function normalizeWorkspacePath(workspaceRootPath: string | null | undefined): string | null {
  return workspaceRootPath?.trim() ? workspaceRootPath : null;
}

export async function listAiGenerationRecords(
  workspaceRootPath: string | null | undefined,
): Promise<AiGenerationRecordFileResult> {
  const listRecords = requireAiRecordApiMethod('listAiGenerationRecords');
  return await listRecords({ workspaceRootPath: normalizeWorkspacePath(workspaceRootPath) });
}

export async function addAiGenerationRecord(payload: {
  workspaceRootPath: string | null | undefined;
  record: Omit<AiGenerationRecord, 'id' | 'createdAt'> & Partial<Pick<AiGenerationRecord, 'id' | 'createdAt'>>;
}): Promise<AiGenerationRecordFileResult> {
  const addRecord = requireAiRecordApiMethod('addAiGenerationRecord');
  return await addRecord({
    workspaceRootPath: normalizeWorkspacePath(payload.workspaceRootPath),
    record: payload.record,
  });
}

export async function deleteAiGenerationRecord(
  workspaceRootPath: string | null | undefined,
  recordId: string,
): Promise<AiGenerationRecordFileResult> {
  const deleteRecord = requireAiRecordApiMethod('deleteAiGenerationRecord');
  return await deleteRecord({
    workspaceRootPath: normalizeWorkspacePath(workspaceRootPath),
    recordId,
  });
}

export async function clearAiGenerationRecords(
  workspaceRootPath: string | null | undefined,
): Promise<AiGenerationRecordFileResult> {
  const clearRecords = requireAiRecordApiMethod('clearAiGenerationRecords');
  return await clearRecords({ workspaceRootPath: normalizeWorkspacePath(workspaceRootPath) });
}
