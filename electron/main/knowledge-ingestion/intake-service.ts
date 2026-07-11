import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  promises as fs,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import type {
  KnowledgeIngestionConfirmMetadataInput,
  KnowledgeIngestionItem,
} from '../../../src/types/knowledgeIngestion';
import type { IntakeStore } from './intake-store';
import { RegistryError } from './types';

// Electron 32 的 Node 20 ESM 翻译器无法稳定预解析该 CommonJS 包，使用原生 require 保持 ABI 一致。
const yauzl = createRequire(import.meta.url)('yauzl') as typeof import('yauzl');

const MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024;

interface ManagedCopyResult {
  managedPath: string;
  contentHash: string;
  sizeBytes: number;
  created: boolean;
}

async function inspectDocx(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(new RegistryError('INPUT_VALIDATION', 'DOCX 文件结构损坏或无法读取。'));
        return;
      }

      let hasContentTypes = false;
      let hasDocumentXml = false;
      let hasMacro = false;
      zipFile.on('error', () => {
        reject(new RegistryError('INPUT_VALIDATION', 'DOCX 文件结构损坏或无法读取。'));
      });
      zipFile.on('entry', (entry) => {
        const entryName = entry.fileName.replace(/\\/g, '/').toLowerCase();
        hasContentTypes ||= entryName === '[content_types].xml';
        hasDocumentXml ||= entryName === 'word/document.xml';
        hasMacro ||= entryName === 'word/vbaproject.bin';
        zipFile.readEntry();
      });
      zipFile.on('end', () => {
        if (!hasContentTypes || !hasDocumentXml) {
          reject(new RegistryError('INPUT_VALIDATION', '所选文件不是有效的 DOCX 文档。'));
          return;
        }
        if (hasMacro) {
          reject(new RegistryError('INPUT_VALIDATION', '带宏的 Office 文档暂不允许进入资料库。'));
          return;
        }
        resolve();
      });
      zipFile.readEntry();
    });
  });
}

async function inspectPdf(filePath: string): Promise<void> {
  const file = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(8);
    const readResult = await file.read(header, 0, header.length, 0);
    if (!header.subarray(0, readResult.bytesRead).toString('latin1').startsWith('%PDF-')) {
      throw new RegistryError('INPUT_VALIDATION', '所选文件不是有效的 PDF 文档。');
    }
  } finally {
    await file.close();
  }

  let overlap = '';
  let hasEncryptMarker = false;
  let hasEndMarker = false;
  for await (const chunk of createReadStream(filePath)) {
    const text = overlap + Buffer.from(chunk).toString('latin1');
    hasEncryptMarker ||= /\/Encrypt\b/.test(text);
    hasEndMarker ||= text.includes('%%EOF');
    overlap = text.slice(-32);
  }
  if (hasEncryptMarker) {
    throw new RegistryError('INPUT_VALIDATION', '加密 PDF 暂不允许进入资料库。');
  }
  if (!hasEndMarker) {
    throw new RegistryError('INPUT_VALIDATION', 'PDF 文件不完整，未找到结束标记。');
  }
}

async function validateSourceFile(filePath: string): Promise<{
  extension: '.docx' | '.pdf';
  sizeBytes: number;
  modifiedAtMs: number;
}> {
  let stat;
  try {
    stat = await fs.stat(filePath);
    await fs.access(filePath, fs.constants.R_OK);
  } catch {
    throw new RegistryError('INPUT_VALIDATION', '所选文件不存在或当前不可读取。');
  }
  if (!stat.isFile()) {
    throw new RegistryError('INPUT_VALIDATION', '只能接收单个本地文件。');
  }
  if (stat.size <= 0) {
    throw new RegistryError('INPUT_VALIDATION', '空文件不能进入资料库。');
  }
  if (stat.size > MAX_SINGLE_FILE_BYTES) {
    throw new RegistryError('INPUT_VALIDATION', '单文件暂不能超过 100 MB。');
  }

  const extension = extname(filePath).toLowerCase();
  if (extension !== '.docx' && extension !== '.pdf') {
    throw new RegistryError('INPUT_VALIDATION', '本步只支持 DOCX 和 PDF 文件。');
  }
  if (extension === '.docx') {
    await inspectDocx(filePath);
  } else {
    await inspectPdf(filePath);
  }
  return { extension, sizeBytes: stat.size, modifiedAtMs: stat.mtimeMs };
}

async function copyToManagedStorage(
  sourcePath: string,
  extension: '.docx' | '.pdf',
  expectedSize: number,
  expectedModifiedAtMs: number,
  managedRoot: string,
): Promise<ManagedCopyResult> {
  const temporaryDirectory = join(managedRoot, 'temporary');
  mkdirSync(temporaryDirectory, { recursive: true });
  const temporaryPath = join(temporaryDirectory, `${randomUUID()}${extension}.partial`);
  const hash = createHash('sha256');
  let copiedBytes = 0;

  const hashStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      copiedBytes += chunk.length;
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      createReadStream(sourcePath),
      hashStream,
      createWriteStream(temporaryPath, { flags: 'wx' }),
    );
    const finalSourceStat = await fs.stat(sourcePath);
    if (
      copiedBytes !== expectedSize
      || finalSourceStat.size !== expectedSize
      || finalSourceStat.mtimeMs !== expectedModifiedAtMs
    ) {
      throw new RegistryError('INPUT_VALIDATION', '文件在接收过程中发生变化，请重新选择。');
    }

    const contentHash = hash.digest('hex');
    const objectDirectory = join(managedRoot, 'objects', contentHash.slice(0, 2));
    const managedPath = join(objectDirectory, `${contentHash}${extension}`);
    mkdirSync(objectDirectory, { recursive: true });
    if (existsSync(managedPath)) {
      await fs.unlink(temporaryPath);
      return { managedPath, contentHash, sizeBytes: copiedBytes, created: false };
    }

    await fs.rename(temporaryPath, managedPath);
    return { managedPath, contentHash, sizeBytes: copiedBytes, created: true };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export class IntakeService {
  constructor(
    private readonly store: IntakeStore,
    private readonly managedRoot: string,
  ) {}

  async intakeFile(filePath: string): Promise<KnowledgeIngestionItem> {
    const validation = await validateSourceFile(filePath);
    const managedCopy = await copyToManagedStorage(
      filePath,
      validation.extension,
      validation.sizeBytes,
      validation.modifiedAtMs,
      this.managedRoot,
    );

    try {
      const item = this.store.recordManagedFile({
        sourcePath: filePath,
        managedSourcePath: managedCopy.managedPath,
        fileName: basename(filePath),
        extension: validation.extension,
        sizeBytes: managedCopy.sizeBytes,
        contentHash: managedCopy.contentHash,
      });
      // 完全重复只增加来源记录，不保留第二份未被版本引用的受管对象。
      if (item.isDuplicate && managedCopy.created) {
        await fs.rm(managedCopy.managedPath, { force: true });
      }
      return item;
    } catch (error) {
      if (managedCopy.created) {
        await fs.rm(managedCopy.managedPath, { force: true });
      }
      throw error;
    }
  }

  listItems(): KnowledgeIngestionItem[] {
    return this.store.listItems();
  }

  confirmMetadata(input: KnowledgeIngestionConfirmMetadataInput): KnowledgeIngestionItem {
    return this.store.confirmMetadata(input.itemId, input.metadata);
  }

  cancelProcessing(itemId: string): KnowledgeIngestionItem {
    return this.store.cancelProcessing(itemId);
  }

  retryProcessing(itemId: string): KnowledgeIngestionItem {
    return this.store.retryProcessing(itemId);
  }
}
