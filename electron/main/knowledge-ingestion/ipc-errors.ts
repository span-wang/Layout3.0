import { RagflowError } from './ragflow/errors';
import { RegistryError } from './types';

/**
 * 只向 Renderer 返回已归一化的安全中文错误，未知异常不得携带内部地址、密钥或调用栈。
 */
export function toSafeKnowledgeIngestionIpcError(error: unknown): Error {
  if (error instanceof RegistryError) {
    return new Error(`[${error.code}] ${error.message}`);
  }
  if (error instanceof RagflowError) {
    return new Error(`[${error.code}] ${error.message}`);
  }
  return new Error('[RUNTIME_UNAVAILABLE] 资料入库操作失败，请稍后重试。');
}
