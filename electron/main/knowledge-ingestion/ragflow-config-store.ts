import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { RegistryError } from './types';

export interface CredentialCipher {
  isAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface RagflowIngestionConfigStatus {
  configured: boolean;
  baseUrl: string;
  stagingDatasetId: string;
  indexGeneration: string;
  hasApiKey: boolean;
}

export interface RagflowIngestionPrivateConfig {
  baseUrl: string;
  apiKey: string;
  stagingDatasetId: string;
  indexGeneration: string;
}

export interface SaveRagflowIngestionConfigInput {
  baseUrl: string;
  apiKey?: string;
  stagingDatasetId: string;
  indexGeneration: string;
}

export interface ReadRagflowDatasetOptionsInput {
  baseUrl: string;
  apiKey?: string;
}

interface StoredRagflowIngestionConfig {
  schemaVersion: 1;
  baseUrl: string;
  encryptedApiKey: string;
  stagingDatasetId: string;
  indexGeneration: string;
  updatedAt: string;
}

export function normalizeRagflowBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RegistryError('REMOTE_AUTH_CONFIG', 'RAGFlow 服务地址格式不正确。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new RegistryError('REMOTE_AUTH_CONFIG', 'RAGFlow 服务地址只允许不含账号密码的 HTTP 或 HTTPS 地址。');
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || /[\s/?#\\]/.test(normalized)) {
    throw new RegistryError('REMOTE_AUTH_CONFIG', `${label}格式不正确。`);
  }
  return normalized;
}

function isStoredConfig(value: unknown): value is StoredRagflowIngestionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.baseUrl === 'string'
    && typeof record.encryptedApiKey === 'string'
    && typeof record.stagingDatasetId === 'string'
    && typeof record.indexGeneration === 'string'
    && typeof record.updatedAt === 'string';
}

export class RagflowIngestionConfigStore {
  constructor(
    private readonly configPath: string,
    private readonly cipher: CredentialCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getStatus(): Promise<RagflowIngestionConfigStatus> {
    const stored = await this.readStored();
    return stored
      ? {
          configured: true,
          baseUrl: stored.baseUrl,
          stagingDatasetId: stored.stagingDatasetId,
          indexGeneration: stored.indexGeneration,
          hasApiKey: Boolean(stored.encryptedApiKey),
        }
      : {
          configured: false,
          baseUrl: 'http://127.0.0.1:9380',
          stagingDatasetId: '',
          indexGeneration: 'staging-v1',
          hasApiKey: false,
        };
  }

  async getPrivateConfig(): Promise<RagflowIngestionPrivateConfig> {
    const stored = await this.readStored();
    if (!stored) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '尚未配置资料入库专用 RAGFlow 连接。');
    }
    this.assertCipherAvailable();
    let apiKey: string;
    try {
      apiKey = this.cipher.decryptString(Buffer.from(stored.encryptedApiKey, 'base64')).trim();
    } catch (error) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '资料入库 API Key 无法解密，请重新配置。', { cause: error });
    }
    if (!apiKey) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '资料入库 API Key 为空，请重新配置。');
    }
    return {
      baseUrl: normalizeRagflowBaseUrl(stored.baseUrl),
      apiKey,
      stagingDatasetId: normalizeIdentifier(stored.stagingDatasetId, '暂存数据集 ID'),
      indexGeneration: normalizeIdentifier(stored.indexGeneration, '索引代次'),
    };
  }

  /** 首次配置使用本次提交的密钥，后续刷新只从 Main 安全存储读取既有密钥。 */
  async resolveDatasetReadConfig(
    input: ReadRagflowDatasetOptionsInput,
  ): Promise<Pick<RagflowIngestionPrivateConfig, 'baseUrl' | 'apiKey'>> {
    const baseUrl = normalizeRagflowBaseUrl(input.baseUrl);
    const submittedApiKey = input.apiKey?.trim();
    if (submittedApiKey) return { baseUrl, apiKey: submittedApiKey };
    const stored = await this.getPrivateConfig();
    return { baseUrl, apiKey: stored.apiKey };
  }

  async save(input: SaveRagflowIngestionConfigInput): Promise<RagflowIngestionConfigStatus> {
    this.assertCipherAvailable();
    const existing = await this.readStored();
    const baseUrl = normalizeRagflowBaseUrl(input.baseUrl);
    const stagingDatasetId = normalizeIdentifier(input.stagingDatasetId, '暂存数据集 ID');
    const indexGeneration = normalizeIdentifier(input.indexGeneration, '索引代次');
    const nextApiKey = input.apiKey?.trim();
    if (!nextApiKey && !existing?.encryptedApiKey) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '首次配置必须填写 RAGFlow API Key。');
    }

    const encryptedApiKey = nextApiKey
      ? this.cipher.encryptString(nextApiKey).toString('base64')
      : existing!.encryptedApiKey;
    const stored: StoredRagflowIngestionConfig = {
      schemaVersion: 1,
      baseUrl,
      encryptedApiKey,
      stagingDatasetId,
      indexGeneration,
      updatedAt: this.now().toISOString(),
    };
    await this.writeStored(stored);
    return this.getStatus();
  }

  async getProtectedDatasetIds(): Promise<string[]> {
    const stored = await this.readStored();
    return stored?.stagingDatasetId ? [stored.stagingDatasetId] : [];
  }

  async assertStagingDataset(datasetId: string): Promise<void> {
    const stored = await this.readStored();
    if (!stored || datasetId.trim() !== stored.stagingDatasetId) {
      throw new RegistryError(
        'REMOTE_AUTH_CONFIG',
        '目标数据集不是 Main 已确认的资料入库专用暂存数据集。',
      );
    }
  }

  private assertCipherAvailable(): void {
    if (!this.cipher.isAvailable()) {
      throw new RegistryError(
        'REMOTE_AUTH_CONFIG',
        '当前系统安全存储不可用，已拒绝保存或读取资料入库 API Key。',
      );
    }
  }

  private async readStored(): Promise<StoredRagflowIngestionConfig | null> {
    let source: string;
    try {
      source = await readFile(this.configPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new RegistryError('REMOTE_AUTH_CONFIG', '无法读取资料入库 RAGFlow 配置。', { cause: error });
    }
    try {
      const parsed = JSON.parse(source) as unknown;
      if (!isStoredConfig(parsed)) {
        throw new Error('配置结构不正确');
      }
      return parsed;
    } catch (error) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '资料入库 RAGFlow 配置已损坏，请重新配置。', { cause: error });
    }
  }

  private async writeStored(value: StoredRagflowIngestionConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.configPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw new RegistryError('REMOTE_AUTH_CONFIG', '无法保存资料入库 RAGFlow 配置。', { cause: error });
    }
  }
}
