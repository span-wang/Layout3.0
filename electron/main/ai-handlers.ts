import { ipcMain } from 'electron';
import {
  normalizeAiRequestTransportError,
  type AiRequestTransportErrorPayload,
} from './ai-request-errors';

interface AiRequestPayload {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface AiRequestResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  transportError?: AiRequestTransportErrorPayload;
}

const activeAiRequests = new Map<string, AbortController>();

function serializeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function requestAi(payload: AiRequestPayload): Promise<AiRequestResult> {
  const abortController = new AbortController();
  activeAiRequests.set(payload.requestId, abortController);

  try {
    try {
      // AI 请求放在主进程里执行，避开 renderer 的浏览器 CORS 限制。
      const response = await fetch(payload.url, {
        method: payload.method,
        headers: payload.headers,
        body: payload.body,
        signal: abortController.signal,
      });
      const body = await response.text();

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: serializeHeaders(response.headers),
        body,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: 'Transport Error',
        headers: {},
        body: '',
        transportError: normalizeAiRequestTransportError(payload.url, error, abortController.signal.aborted),
      };
    }
  } finally {
    activeAiRequests.delete(payload.requestId);
  }
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:request', (_event, payload: AiRequestPayload) => requestAi(payload));
  ipcMain.handle('ai:cancelRequest', (_event, requestId: string) => {
    const abortController = activeAiRequests.get(requestId);
    if (!abortController) {
      return false;
    }

    abortController.abort();
    activeAiRequests.delete(requestId);
    return true;
  });
}
