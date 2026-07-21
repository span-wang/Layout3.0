import { RagflowError } from './ragflow/errors';
import { RegistryError } from './types';

const safeRemoteMessages = {
  REMOTE_AUTH_CONFIG: 'RAGFlow 身份认证失败，请检查入库地址、API Key 和数据集权限。',
  REMOTE_TRANSIENT: '暂时无法连接 RAGFlow 或服务繁忙，请稍后重试。',
  REMOTE_CONTRACT: 'RAGFlow 返回结果不符合入库安全合同，请检查服务状态后重试。',
  QUALITY_BLOCK: '当前资料未通过质量门禁，不能继续此操作。',
  CANCELLED: '资料入库操作已取消。',
} as const;

function getSafeRegistryMessage(error: RegistryError): string {
  switch (error.code) {
    case 'PUBLICATION_CONFLICT':
      return '当前资料分支已有发布或回滚操作，请刷新后重试。';
    case 'PUBLICATION_PRECONDITION_FAILED':
    case 'LAST_ACTIVE_PUBLICATION':
      return '当前资料状态不满足发布或回滚条件，请刷新后检查。';
    case 'INCOMPLETE_RAGFLOW_MAPPING':
    case 'EMPTY_ACTIVE_DOCUMENT_SET':
      return '资料的受管索引状态不完整，当前操作已安全阻断。';
    case 'JOB_STATE_CONFLICT':
      return '当前任务状态已发生变化，请刷新后重试。';
    case 'RECORD_NOT_FOUND':
      return '未找到对应资料记录，请刷新列表后重试。';
    case 'RUNTIME_UNAVAILABLE':
      return '资料入库服务暂不可用，请稍后重试。';
    case 'FILE_PROCESSING':
      return '资料处理失败，请检查文件内容或格式后重试。';
    case 'REMOTE_AUTH_CONFIG':
    case 'REMOTE_TRANSIENT':
    case 'REMOTE_CONTRACT':
    case 'QUALITY_BLOCK':
    case 'CANCELLED':
      return safeRemoteMessages[error.code];
    default:
      // 其余错误均由 Main 的受控输入校验和状态机产生，可保留具体中文指引。
      return error.message;
  }
}

/**
 * 只向 Renderer 返回已归一化的安全中文错误，未知异常不得携带内部地址、密钥或调用栈。
 */
export function toSafeKnowledgeIngestionIpcError(error: unknown): Error {
  if (error instanceof RegistryError) {
    return new Error(`[${error.code}] ${getSafeRegistryMessage(error)}`);
  }
  if (error instanceof RagflowError) {
    return new Error(`[${error.code}] ${safeRemoteMessages[error.code]}`);
  }
  return new Error('[RUNTIME_UNAVAILABLE] 资料入库操作失败，请稍后重试。');
}
