import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { RegistryError } from '../types';
import type { ExtractedDocument } from './types';
import type {
  DocumentExtractionInput,
  DocumentExtractorBridge,
  ExtractorWorkerRequest,
  ExtractorWorkerResponse,
} from './extractor-contract';

function createCancellationError(): RegistryError {
  return new RegistryError('CANCELLED', '资料处理已取消。');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExtractedDocument(value: unknown): value is ExtractedDocument {
  return isRecord(value)
    && typeof value.bodyText === 'string'
    && value.bodyText.trim().length > 0
    && isRecord(value.locatorMap)
    && typeof value.toolName === 'string'
    && typeof value.toolVersion === 'string';
}

function parseWorkerResponse(value: unknown): ExtractorWorkerResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new RegistryError('FILE_PROCESSING', '基础抽取 worker 返回了无法识别的结果。');
  }
  if (value.ok === true) {
    if (!isExtractedDocument(value.result)) {
      throw new RegistryError('FILE_PROCESSING', '基础抽取 worker 返回的正文或定位结果不完整。');
    }
    return { ok: true, result: value.result };
  }
  if (
    (value.code !== 'FILE_PROCESSING' && value.code !== 'CANCELLED')
    || typeof value.message !== 'string'
    || !value.message.trim()
  ) {
    throw new RegistryError('FILE_PROCESSING', '基础抽取 worker 返回的错误结果不完整。');
  }
  return {
    ok: false,
    code: value.code,
    message: value.message,
  };
}

function createSourceTestWorker(workerUrl: URL, request: ExtractorWorkerRequest): Worker {
  // worker_threads 不会在解析 TS 入口前应用父进程的 tsx hook；先用纯 JS 启动器注册 tsx，再导入入口。
  const require = createRequire(import.meta.url);
  const tsxApiPath = require.resolve('tsx/esm/api');
  const bootstrap = `
    const { register } = require(${JSON.stringify(tsxApiPath)});
    register();
    import(${JSON.stringify(workerUrl.href)}).catch((error) => {
      setImmediate(() => { throw error; });
    });
  `;
  return new Worker(bootstrap, { eval: true, workerData: request });
}

export interface WorkerDocumentExtractorBridgeOptions {
  workerUrl?: URL;
}

export class WorkerDocumentExtractorBridge implements DocumentExtractorBridge {
  constructor(private readonly options: WorkerDocumentExtractorBridgeOptions = {}) {}

  async extract(input: DocumentExtractionInput): Promise<ExtractedDocument> {
    if (input.signal?.aborted) throw createCancellationError();

    const request: ExtractorWorkerRequest = {
      filePath: input.filePath,
      sourceFormat: input.sourceFormat,
      sourceHash: input.sourceHash,
    };
    let worker: Worker;
    try {
      const runningFromSource = new URL(import.meta.url).pathname.endsWith('.ts');
      const workerUrl = this.options.workerUrl ?? new URL(
        runningFromSource ? './extractor-worker.ts' : './extractor-worker.js',
        import.meta.url,
      );
      if (workerUrl.pathname.endsWith('.ts')) {
        worker = createSourceTestWorker(workerUrl, request);
      } else {
        // Main 构建把 extractor-worker 作为同目录第二入口输出，不依赖安装包携带 TypeScript 或 tsx。
        if (input.signal?.aborted) throw createCancellationError();
        worker = new Worker(workerUrl, { workerData: request });
      }
    } catch (error) {
      throw new RegistryError('FILE_PROCESSING', '无法启动基础抽取 worker。', { cause: error });
    }

    return new Promise<ExtractedDocument>((resolve, reject) => {
      let settled = false;
      let response: ExtractorWorkerResponse | null = null;
      let workerError: RegistryError | null = null;

      const cleanup = (): void => {
        input.signal?.removeEventListener('abort', onAbort);
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        worker.removeListener('exit', onExit);
      };

      const finishAfterExit = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (workerError) {
          reject(workerError);
        } else if (!response) {
          reject(new RegistryError('FILE_PROCESSING', '基础抽取 worker 未返回处理结果。'));
        } else if (response.ok) {
          resolve(response.result);
        } else {
          reject(new RegistryError(response.code, response.message));
        }
      };

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        // 取消必须等待线程真正退出，防止 runner 随后关闭 SQLite 时仍有抽取线程在运行。
        void worker.terminate()
          .catch(() => undefined)
          .then(() => reject(createCancellationError()));
      };

      const onMessage = (value: unknown): void => {
        try {
          response = parseWorkerResponse(value);
        } catch (error) {
          workerError = error instanceof RegistryError
            ? error
            : new RegistryError('FILE_PROCESSING', '基础抽取 worker 结果校验失败。', { cause: error });
        }
      };

      const onError = (error: Error): void => {
        workerError = new RegistryError('FILE_PROCESSING', '基础抽取 worker 异常退出。', { cause: error });
      };

      const onExit = (code: number): void => {
        if (settled) return;
        if (code !== 0 && !workerError) {
          workerError = new RegistryError('FILE_PROCESSING', `基础抽取 worker 异常退出（代码 ${code}）。`);
        }
        finishAfterExit();
      };

      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      input.signal?.addEventListener('abort', onAbort, { once: true });
      if (input.signal?.aborted) onAbort();
    });
  }
}
