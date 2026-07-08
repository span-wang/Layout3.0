export type AiRequestTransportErrorCode =
  | 'aborted'
  | 'connectionRefused'
  | 'dns'
  | 'tls'
  | 'timeout'
  | 'network'
  | 'unknown';

export interface AiRequestTransportErrorPayload {
  code: AiRequestTransportErrorCode;
  message: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

function getNestedNodeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code) {
    return code;
  }

  if ('cause' in error) {
    return getNestedNodeErrorCode(error.cause);
  }

  return undefined;
}

function buildErrorMessage(url: string, description: string): string {
  return `${description}\n请求地址：${url}`;
}

export function normalizeAiRequestTransportError(
  url: string,
  error: unknown,
  aborted: boolean,
): AiRequestTransportErrorPayload {
  const message = getErrorMessage(error);
  const lowerMessage = message.toLowerCase();
  const nodeCode = getNestedNodeErrorCode(error)?.toUpperCase();

  // 用户主动取消时，不再把它当成真正错误上抛到界面。
  if (aborted || lowerMessage.includes('aborterror') || lowerMessage.includes('aborted')) {
    return {
      code: 'aborted',
      message: '请求已取消',
    };
  }

  if (nodeCode === 'ECONNREFUSED') {
    return {
      code: 'connectionRefused',
      message: buildErrorMessage(url, '无法连接到目标服务，请确认服务已启动且地址端口填写正确。'),
    };
  }

  if (nodeCode === 'ENOTFOUND' || nodeCode === 'EAI_AGAIN') {
    return {
      code: 'dns',
      message: buildErrorMessage(url, '无法解析目标服务地址，请检查 Base URL 是否填写正确。'),
    };
  }

  if (
    nodeCode === 'CERT_HAS_EXPIRED' ||
    nodeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    nodeCode === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    lowerMessage.includes('certificate') ||
    lowerMessage.includes('cert ')
  ) {
    return {
      code: 'tls',
      message: buildErrorMessage(url, '无法建立安全连接，请检查 HTTPS 证书是否有效，或改用可访问的服务地址。'),
    };
  }

  if (
    nodeCode === 'ETIMEDOUT' ||
    nodeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    lowerMessage.includes('timeout')
  ) {
    return {
      code: 'timeout',
      message: buildErrorMessage(url, '连接目标服务超时，请检查服务状态、端口可达性或本机网络。'),
    };
  }

  if (lowerMessage.includes('fetch failed')) {
    return {
      code: 'network',
      message: buildErrorMessage(url, '网络请求失败，请检查服务地址、本机网络连接或代理设置。'),
    };
  }

  return {
    code: 'unknown',
    message: buildErrorMessage(url, `请求失败：${message || '未知错误'}`),
  };
}
