export interface MainProcessTransportErrorPayload {
  code: string;
  message: string;
}

export function isMainProcessAbortedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function buildUrlScopedMessage(url: string, message: string): string {
  return `${message}\n请求地址：${url}`;
}

function normalizeLegacyIpcInvokeMessage(url: string, message: string): string | null {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('aborterror') || lowerMessage.includes('this operation was aborted')) {
    return '请求已取消';
  }

  if (lowerMessage.includes('econnrefused')) {
    return buildUrlScopedMessage(url, '无法连接到目标服务，请确认服务已启动且地址端口填写正确。');
  }

  if (lowerMessage.includes('enotfound') || lowerMessage.includes('eai_again')) {
    return buildUrlScopedMessage(url, '无法解析目标服务地址，请检查 Base URL 是否填写正确。');
  }

  if (
    lowerMessage.includes('certificate') ||
    lowerMessage.includes('cert_has_expired') ||
    lowerMessage.includes('self_signed_cert') ||
    lowerMessage.includes('altname_invalid')
  ) {
    return buildUrlScopedMessage(url, '无法建立安全连接，请检查 HTTPS 证书是否有效，或改用可访问的服务地址。');
  }

  if (lowerMessage.includes('timeout')) {
    return buildUrlScopedMessage(url, '连接目标服务超时，请检查服务状态、端口可达性或本机网络。');
  }

  if (lowerMessage.includes('fetch failed') || lowerMessage.includes("error invoking remote method 'ai:request'")) {
    return buildUrlScopedMessage(url, '网络请求失败，请检查服务地址、本机网络连接或代理设置。');
  }

  return null;
}

export function throwNormalizedMainProcessInvokeError(url: string, error: unknown): never {
  if (isMainProcessAbortedError(error)) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalizedMessage = normalizeLegacyIpcInvokeMessage(url, message);
  if (normalizedMessage === '请求已取消') {
    throw new DOMException('请求已取消', 'AbortError');
  }

  throw new Error(normalizedMessage ?? (message || '请求失败'));
}

export function throwIfMainProcessTransportError(params: {
  url: string;
  transportError?: MainProcessTransportErrorPayload;
}): void {
  if (!params.transportError) {
    return;
  }

  if (params.transportError.code === 'aborted') {
    throw new DOMException('请求已取消', 'AbortError');
  }

  throw new Error(params.transportError.message || `请求失败：${params.transportError.code}`);
}
