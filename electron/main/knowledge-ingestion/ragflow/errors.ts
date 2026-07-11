export type RagflowErrorCode =
  | 'REMOTE_AUTH_CONFIG'
  | 'REMOTE_TRANSIENT'
  | 'REMOTE_CONTRACT'
  | 'QUALITY_BLOCK'
  | 'CANCELLED';

export type RagflowErrorReason =
  | 'AUTHENTICATION'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'API_ERROR'
  | 'INVALID_RESPONSE'
  | 'PAGINATION_INCOMPLETE'
  | 'DUPLICATE_REMOTE_NAME'
  | 'DOCUMENT_NOT_FOUND'
  | 'BINDING_DRIFT'
  | 'METADATA_MISMATCH'
  | 'PARSE_FAILED'
  | 'UNKNOWN_PARSE_STATE'
  | 'ZERO_CHUNKS'
  | 'CANCELLED';

export interface RagflowErrorOptions {
  code: RagflowErrorCode;
  reason: RagflowErrorReason;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  apiCode?: number;
  cause?: unknown;
}

export class RagflowError extends Error {
  readonly code: RagflowErrorCode;
  readonly reason: RagflowErrorReason;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly apiCode?: number;

  constructor(options: RagflowErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RagflowError';
    this.code = options.code;
    this.reason = options.reason;
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus;
    this.apiCode = options.apiCode;
  }
}

export function createRagflowHttpError(status: number, statusText: string): RagflowError {
  if (status === 401 || status === 403) {
    return new RagflowError({
      code: 'REMOTE_AUTH_CONFIG',
      reason: 'AUTHENTICATION',
      message: `RAGFlow 身份认证失败（HTTP ${status}），请检查入库地址、API Key 和数据集权限。`,
      retryable: false,
      httpStatus: status,
    });
  }
  if (status === 429) {
    return new RagflowError({
      code: 'REMOTE_TRANSIENT',
      reason: 'RATE_LIMITED',
      message: 'RAGFlow 请求受到限流（HTTP 429），稍后可按退避策略重试。',
      retryable: true,
      httpStatus: status,
    });
  }
  if (status >= 500) {
    return new RagflowError({
      code: 'REMOTE_TRANSIENT',
      reason: 'SERVER_ERROR',
      message: `RAGFlow 服务暂时不可用（HTTP ${status}${statusText ? ` ${statusText}` : ''}）。`,
      retryable: true,
      httpStatus: status,
    });
  }
  return new RagflowError({
    code: 'REMOTE_CONTRACT',
    reason: 'HTTP_ERROR',
    message: `RAGFlow 返回不符合当前入库合同的 HTTP 状态 ${status}${statusText ? ` ${statusText}` : ''}。`,
    retryable: false,
    httpStatus: status,
  });
}

export function normalizeRagflowError(error: unknown, action: string): RagflowError {
  if (error instanceof RagflowError) {
    return error;
  }
  return new RagflowError({
    code: 'REMOTE_TRANSIENT',
    reason: 'NETWORK',
    message: `${action}时无法连接 RAGFlow，可按退避策略重试。`,
    retryable: true,
    cause: error,
  });
}

export function createRagflowContractError(
  reason: Extract<
    RagflowErrorReason,
    | 'INVALID_RESPONSE'
    | 'PAGINATION_INCOMPLETE'
    | 'DUPLICATE_REMOTE_NAME'
    | 'DOCUMENT_NOT_FOUND'
    | 'BINDING_DRIFT'
    | 'METADATA_MISMATCH'
    | 'PARSE_FAILED'
    | 'UNKNOWN_PARSE_STATE'
  >,
  message: string,
): RagflowError {
  return new RagflowError({
    code: 'REMOTE_CONTRACT',
    reason,
    message,
    retryable: false,
  });
}
