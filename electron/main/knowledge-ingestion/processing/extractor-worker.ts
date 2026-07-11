import { isAbsolute } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { RegistryError } from '../types';
import { extractDocxDocument } from './docx-extractor';
import type {
  ExtractorWorkerRequest,
  ExtractorWorkerResponse,
} from './extractor-contract';
import { extractPdfDocument } from './pdf-extractor';

function parseWorkerRequest(value: unknown): ExtractorWorkerRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RegistryError('FILE_PROCESSING', '基础抽取 worker 收到的任务格式不正确。');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.filePath !== 'string'
    || !isAbsolute(record.filePath)
    || record.filePath.includes('\0')
  ) {
    throw new RegistryError('FILE_PROCESSING', '基础抽取 worker 收到的受管原件路径不正确。');
  }
  if (record.sourceFormat !== 'docx' && record.sourceFormat !== 'pdf') {
    throw new RegistryError('FILE_PROCESSING', '基础抽取 worker 只支持 DOCX 和文本 PDF。');
  }
  if (typeof record.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.sourceHash)) {
    throw new RegistryError('FILE_PROCESSING', '基础抽取 worker 收到的来源 SHA-256 不正确。');
  }
  return {
    filePath: record.filePath,
    sourceFormat: record.sourceFormat,
    sourceHash: record.sourceHash,
  };
}

function toFailureResponse(error: unknown): ExtractorWorkerResponse {
  if (error instanceof RegistryError) {
    return {
      ok: false,
      code: error.code === 'CANCELLED' ? 'CANCELLED' : 'FILE_PROCESSING',
      message: error.message,
    };
  }
  return {
    ok: false,
    code: 'FILE_PROCESSING',
    message: '基础抽取 worker 执行失败，未生成处理工件。',
  };
}

async function run(): Promise<ExtractorWorkerResponse> {
  const input = parseWorkerRequest(workerData);
  const result = input.sourceFormat === 'docx'
    ? await extractDocxDocument({ filePath: input.filePath, sourceHash: input.sourceHash })
    : await extractPdfDocument({ filePath: input.filePath, sourceHash: input.sourceHash });
  return { ok: true, result };
}

const port = parentPort;
if (!port) {
  throw new Error('基础抽取 worker 缺少 Main 通信端口。');
}

void run()
  .then((response) => {
    port.postMessage(response);
    port.close();
  })
  .catch((error: unknown) => {
    port.postMessage(toFailureResponse(error));
    port.close();
  });
