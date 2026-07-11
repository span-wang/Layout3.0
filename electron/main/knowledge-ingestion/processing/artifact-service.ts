import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { RegistryDatabase } from '../registry-database';
import {
  RegistryError,
  type ProcessingArtifactRecord,
  type ProcessingArtifactType,
} from '../types';
import {
  DOCX_EXTRACTOR_TOOL,
  PDF_EXTRACTOR_TOOL,
  type DocumentExtractorBridge,
} from './extractor-contract';
import {
  LOCATOR_SCHEMA_VERSION,
  PROCESSING_MANIFEST_SCHEMA_VERSION,
  type ExtractedDocument,
  type ProcessingArtifactReference,
  type ProcessingArtifactSet,
  type ProcessingManifest,
  type ProcessingManifestArtifact,
} from './types';
import { WorkerDocumentExtractorBridge } from './worker-extractor-bridge';

interface MaterialSourceRow {
  version_id: string;
  content_hash: string;
  managed_source_path: string | null;
  parser_profile: string | null;
}

interface ArtifactRow {
  artifact_id: string;
  version_id: string;
  artifact_type: ProcessingArtifactType;
  relative_path: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  source_hash: string;
  processing_profile: string;
  tool_name: string;
  tool_version: string;
  lineage_json: string;
  created_at: string;
  updated_at: string;
}

interface FileDigest {
  sha256: string;
  sizeBytes: number;
}

interface ExpectedBundle {
  artifactSetKey: string;
  relativeDirectory: string;
  absoluteDirectory: string;
  bodyRelativePath: string;
  locatorRelativePath: string;
  manifestRelativePath: string;
  bodyAbsolutePath: string;
  locatorAbsolutePath: string;
  manifestAbsolutePath: string;
}

interface ValidatedBundle {
  manifest: ProcessingManifest;
  body: ProcessingManifestArtifact & { absolutePath: string };
  locatorMap: ProcessingManifestArtifact & { absolutePath: string };
  manifestFile: {
    artifactType: 'manifest';
    relativePath: string;
    absolutePath: string;
    mediaType: string;
    sizeBytes: number;
    sha256: string;
  };
}

interface ProcessorTool {
  name: string;
  version: string;
}

const BODY_MEDIA_TYPE = 'text/plain; charset=utf-8';
const JSON_MEDIA_TYPE = 'application/json; charset=utf-8';

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RegistryError('CANCELLED', '资料处理已取消。');
  }
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeSourceHash(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new RegistryError('FILE_PROCESSING', '资料版本缺少合法的 SHA-256 来源指纹。');
  }
  return normalized;
}

function normalizeProcessingProfile(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new RegistryError('FILE_PROCESSING', '处理 profile 不能为空且不能超过 200 个字符。');
  }
  return normalized;
}

function buildArtifactId(input: {
  versionId: string;
  artifactType: ProcessingArtifactType;
  sourceHash: string;
  processingProfile: string;
  toolName: string;
  toolVersion: string;
}): string {
  return `artifact_${sha256Text([
    input.versionId,
    input.artifactType,
    input.sourceHash,
    input.processingProfile,
    input.toolName,
    input.toolVersion,
  ].join('\u0000')).slice(0, 32)}`;
}

function mapArtifactRow(row: ArtifactRow): ProcessingArtifactRecord {
  return {
    artifactId: row.artifact_id,
    versionId: row.version_id,
    artifactType: row.artifact_type,
    relativePath: row.relative_path,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    sourceHash: row.source_hash,
    processingProfile: row.processing_profile,
    toolName: row.tool_name,
    toolVersion: row.tool_version,
    lineage: JSON.parse(row.lineage_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveManagedRelativePath(managedRoot: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new RegistryError('FILE_PROCESSING', '处理工件路径必须是受管目录内的相对路径。');
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new RegistryError('FILE_PROCESSING', '处理工件相对路径包含非法目录段。');
  }
  const root = resolve(managedRoot);
  const absolutePath = resolve(root, ...segments);
  const relativeCheck = relative(root, absolutePath);
  if (relativeCheck.startsWith('..') || isAbsolute(relativeCheck)) {
    throw new RegistryError('FILE_PROCESSING', '处理工件路径越过受管目录边界。');
  }
  return absolutePath;
}

async function hashFile(filePath: string, signal?: AbortSignal): Promise<FileDigest> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  try {
    for await (const chunk of createReadStream(filePath)) {
      throwIfCancelled(signal);
      const buffer = Buffer.from(chunk);
      hash.update(buffer);
      sizeBytes += buffer.length;
    }
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    throw new RegistryError('FILE_PROCESSING', '处理文件无法读取或校验。', { cause: error });
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

async function writeFileAndSync(filePath: string, content: string): Promise<void> {
  const file = await fs.open(filePath, 'wx');
  try {
    await file.writeFile(content, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifestArtifact(value: unknown): value is ProcessingManifestArtifact {
  return isRecord(value)
    && (value.artifactType === 'extracted_text' || value.artifactType === 'locator_map')
    && typeof value.relativePath === 'string'
    && typeof value.mediaType === 'string'
    && typeof value.sizeBytes === 'number'
    && Number.isInteger(value.sizeBytes)
    && value.sizeBytes > 0
    && typeof value.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function parseManifest(value: unknown): ProcessingManifest | null {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.processing)) return null;
  if (
    value.schemaVersion !== PROCESSING_MANIFEST_SCHEMA_VERSION
    || typeof value.artifactSetKey !== 'string'
    || typeof value.versionId !== 'string'
    || typeof value.source.sha256 !== 'string'
    || (value.source.format !== 'docx' && value.source.format !== 'pdf')
    || typeof value.processing.profile !== 'string'
    || typeof value.processing.toolName !== 'string'
    || typeof value.processing.toolVersion !== 'string'
    || value.locatorSchemaVersion !== LOCATOR_SCHEMA_VERSION
    || !Array.isArray(value.artifacts)
    || !value.artifacts.every(isManifestArtifact)
    || typeof value.createdAt !== 'string'
  ) {
    return null;
  }
  return value as unknown as ProcessingManifest;
}

function getToolForExtension(extension: string): ProcessorTool {
  if (extension === '.docx') return DOCX_EXTRACTOR_TOOL;
  if (extension === '.pdf') return PDF_EXTRACTOR_TOOL;
  throw new RegistryError('FILE_PROCESSING', '本步只支持 DOCX 和文本 PDF 基础处理。');
}

function buildExpectedBundle(input: {
  managedRoot: string;
  versionId: string;
  sourceHash: string;
  processingProfile: string;
  tool: ProcessorTool;
}): ExpectedBundle {
  const artifactSetKey = sha256Text([
    input.versionId,
    input.sourceHash,
    input.processingProfile,
    input.tool.name,
    input.tool.version,
  ].join('\u0000'));
  const relativeDirectory = `artifacts/${artifactSetKey.slice(0, 2)}/${artifactSetKey}`;
  const bodyRelativePath = `${relativeDirectory}/body.txt`;
  const locatorRelativePath = `${relativeDirectory}/locator-map.json`;
  const manifestRelativePath = `${relativeDirectory}/manifest.json`;
  return {
    artifactSetKey,
    relativeDirectory,
    absoluteDirectory: resolveManagedRelativePath(input.managedRoot, relativeDirectory),
    bodyRelativePath,
    locatorRelativePath,
    manifestRelativePath,
    bodyAbsolutePath: resolveManagedRelativePath(input.managedRoot, bodyRelativePath),
    locatorAbsolutePath: resolveManagedRelativePath(input.managedRoot, locatorRelativePath),
    manifestAbsolutePath: resolveManagedRelativePath(input.managedRoot, manifestRelativePath),
  };
}

async function loadValidBundle(input: {
  expected: ExpectedBundle;
  versionId: string;
  sourceHash: string;
  sourceFormat: 'docx' | 'pdf';
  processingProfile: string;
  tool: ProcessorTool;
  signal?: AbortSignal;
}): Promise<ValidatedBundle | null> {
  try {
    throwIfCancelled(input.signal);
    const manifestText = await fs.readFile(input.expected.manifestAbsolutePath, 'utf8');
    const manifest = parseManifest(JSON.parse(manifestText));
    if (
      !manifest
      || manifest.artifactSetKey !== input.expected.artifactSetKey
      || manifest.versionId !== input.versionId
      || manifest.source.sha256 !== input.sourceHash
      || manifest.source.format !== input.sourceFormat
      || manifest.processing.profile !== input.processingProfile
      || manifest.processing.toolName !== input.tool.name
      || manifest.processing.toolVersion !== input.tool.version
      || manifest.artifacts.length !== 2
    ) {
      return null;
    }

    const body = manifest.artifacts.find((artifact) => artifact.artifactType === 'extracted_text');
    const locatorMap = manifest.artifacts.find((artifact) => artifact.artifactType === 'locator_map');
    if (
      !body
      || !locatorMap
      || body.relativePath !== input.expected.bodyRelativePath
      || body.mediaType !== BODY_MEDIA_TYPE
      || locatorMap.relativePath !== input.expected.locatorRelativePath
      || locatorMap.mediaType !== JSON_MEDIA_TYPE
    ) {
      return null;
    }

    const [bodyDigest, locatorDigest, manifestDigest, bodyText, locatorText] = await Promise.all([
      hashFile(input.expected.bodyAbsolutePath, input.signal),
      hashFile(input.expected.locatorAbsolutePath, input.signal),
      hashFile(input.expected.manifestAbsolutePath, input.signal),
      fs.readFile(input.expected.bodyAbsolutePath, 'utf8'),
      fs.readFile(input.expected.locatorAbsolutePath, 'utf8'),
    ]);
    if (
      !bodyText.trim()
      || bodyDigest.sha256 !== body.sha256
      || bodyDigest.sizeBytes !== body.sizeBytes
      || locatorDigest.sha256 !== locatorMap.sha256
      || locatorDigest.sizeBytes !== locatorMap.sizeBytes
      || manifestDigest.sizeBytes <= 0
    ) {
      return null;
    }
    const locator = JSON.parse(locatorText) as unknown;
    if (
      !isRecord(locator)
      || locator.schemaVersion !== LOCATOR_SCHEMA_VERSION
      || locator.sourceHash !== input.sourceHash
      || locator.sourceFormat !== input.sourceFormat
    ) {
      return null;
    }

    return {
      manifest,
      body: { ...body, absolutePath: input.expected.bodyAbsolutePath },
      locatorMap: { ...locatorMap, absolutePath: input.expected.locatorAbsolutePath },
      manifestFile: {
        artifactType: 'manifest',
        relativePath: input.expected.manifestRelativePath,
        absolutePath: input.expected.manifestAbsolutePath,
        mediaType: JSON_MEDIA_TYPE,
        sizeBytes: manifestDigest.sizeBytes,
        sha256: manifestDigest.sha256,
      },
    };
  } catch (error) {
    if (error instanceof RegistryError && error.code === 'CANCELLED') throw error;
    return null;
  }
}

export interface ProcessingArtifactServiceOptions {
  now?: () => Date;
  extractor?: DocumentExtractorBridge;
}

export class ProcessingArtifactService {
  private readonly database: RegistryDatabase['connection'];
  private readonly managedRoot: string;
  private readonly now: () => Date;
  private readonly extractor: DocumentExtractorBridge;

  constructor(
    registryDatabase: RegistryDatabase,
    managedRoot: string,
    options: ProcessingArtifactServiceOptions = {},
  ) {
    this.database = registryDatabase.connection;
    this.managedRoot = resolve(managedRoot);
    this.now = options.now ?? (() => new Date());
    this.extractor = options.extractor ?? new WorkerDocumentExtractorBridge();
  }

  async processVersion(input: {
    versionId: string;
    processingProfile?: string;
    signal?: AbortSignal;
  }): Promise<ProcessingArtifactSet> {
    throwIfCancelled(input.signal);
    const source = this.database
      .prepare(`
        SELECT version_id, content_hash, managed_source_path, parser_profile
        FROM material_versions
        WHERE version_id = ?
      `)
      .get(input.versionId) as MaterialSourceRow | undefined;
    if (!source) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到资料版本 ${input.versionId}。`);
    }
    if (!source.managed_source_path) {
      throw new RegistryError('FILE_PROCESSING', `资料版本 ${input.versionId} 缺少受管原件。`);
    }

    const sourceHash = normalizeSourceHash(source.content_hash);
    const processingProfile = normalizeProcessingProfile(
      input.processingProfile ?? source.parser_profile ?? 'basic-processing-v1',
    );
    const extension = extname(source.managed_source_path).toLowerCase();
    if (extension !== '.docx' && extension !== '.pdf') {
      throw new RegistryError('FILE_PROCESSING', '本步只支持 DOCX 和文本 PDF 基础处理。');
    }
    const sourceFormat = extension.slice(1) as 'docx' | 'pdf';
    const tool = getToolForExtension(extension);
    const expected = buildExpectedBundle({
      managedRoot: this.managedRoot,
      versionId: source.version_id,
      sourceHash,
      processingProfile,
      tool,
    });

    const sourceDigest = await hashFile(source.managed_source_path, input.signal);
    if (sourceDigest.sha256 !== sourceHash) {
      throw new RegistryError(
        'FILE_PROCESSING',
        `资料版本 ${input.versionId} 的受管原件与登记 SHA-256 不一致，已停止处理。`,
      );
    }

    // 先验证磁盘完整工件。即使进程曾在“落盘后、登记前”退出，也可直接接管而不重复抽取。
    const reusable = await loadValidBundle({
      expected,
      versionId: source.version_id,
      sourceHash,
      sourceFormat,
      processingProfile,
      tool,
      signal: input.signal,
    });
    if (reusable) {
      return this.registerAndBuildResult(reusable, source.version_id, sourceHash, processingProfile, true);
    }

    const extracted = await this.extractor.extract({
      filePath: source.managed_source_path,
      sourceFormat,
      sourceHash,
      signal: input.signal,
    });
    if (extracted.toolName !== tool.name || extracted.toolVersion !== tool.version) {
      throw new RegistryError('FILE_PROCESSING', '基础抽取器版本与工件路径版本不一致。');
    }
    const published = await this.publishBundle({
      expected,
      versionId: source.version_id,
      sourceHash,
      sourceFormat,
      processingProfile,
      extracted,
      signal: input.signal,
    });
    return this.registerAndBuildResult(
      published,
      source.version_id,
      sourceHash,
      processingProfile,
      false,
    );
  }

  listArtifacts(versionId: string): ProcessingArtifactReference[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM processing_artifacts
        WHERE version_id = ?
        ORDER BY created_at, artifact_type, artifact_id
      `)
      .all(versionId) as ArtifactRow[];
    return rows.map((row) => {
      const record = mapArtifactRow(row);
      return {
        ...record,
        absolutePath: resolveManagedRelativePath(this.managedRoot, record.relativePath),
      };
    });
  }

  private async publishBundle(input: {
    expected: ExpectedBundle;
    versionId: string;
    sourceHash: string;
    sourceFormat: 'docx' | 'pdf';
    processingProfile: string;
    extracted: ExtractedDocument;
    signal?: AbortSignal;
  }): Promise<ValidatedBundle> {
    const parentDirectory = resolve(input.expected.absoluteDirectory, '..');
    await fs.mkdir(parentDirectory, { recursive: true });
    const temporaryDirectory = join(
      parentDirectory,
      `.${input.expected.artifactSetKey}.${randomUUID()}.partial`,
    );
    const quarantineDirectory = join(
      parentDirectory,
      `.${input.expected.artifactSetKey}.${randomUUID()}.replaced`,
    );
    await fs.mkdir(temporaryDirectory);
    let quarantinedExisting = false;

    try {
      throwIfCancelled(input.signal);
      const temporaryBodyPath = join(temporaryDirectory, 'body.txt');
      const temporaryLocatorPath = join(temporaryDirectory, 'locator-map.json');
      const temporaryManifestPath = join(temporaryDirectory, 'manifest.json');
      const locatorText = `${JSON.stringify(input.extracted.locatorMap, null, 2)}\n`;
      await writeFileAndSync(temporaryBodyPath, input.extracted.bodyText);
      await writeFileAndSync(temporaryLocatorPath, locatorText);
      const [bodyDigest, locatorDigest] = await Promise.all([
        hashFile(temporaryBodyPath, input.signal),
        hashFile(temporaryLocatorPath, input.signal),
      ]);
      if (bodyDigest.sizeBytes <= 0 || locatorDigest.sizeBytes <= 0) {
        throw new RegistryError('FILE_PROCESSING', '基础抽取器生成了空处理工件。');
      }

      const manifest: ProcessingManifest = {
        schemaVersion: PROCESSING_MANIFEST_SCHEMA_VERSION,
        artifactSetKey: input.expected.artifactSetKey,
        versionId: input.versionId,
        source: { sha256: input.sourceHash, format: input.sourceFormat },
        processing: {
          profile: input.processingProfile,
          toolName: input.extracted.toolName,
          toolVersion: input.extracted.toolVersion,
        },
        locatorSchemaVersion: LOCATOR_SCHEMA_VERSION,
        artifacts: [
          {
            artifactType: 'extracted_text',
            relativePath: input.expected.bodyRelativePath,
            mediaType: BODY_MEDIA_TYPE,
            sizeBytes: bodyDigest.sizeBytes,
            sha256: bodyDigest.sha256,
          },
          {
            artifactType: 'locator_map',
            relativePath: input.expected.locatorRelativePath,
            mediaType: JSON_MEDIA_TYPE,
            sizeBytes: locatorDigest.sizeBytes,
            sha256: locatorDigest.sha256,
          },
        ],
        createdAt: this.now().toISOString(),
      };
      await writeFileAndSync(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await hashFile(temporaryManifestPath, input.signal);

      if (await pathExists(input.expected.absoluteDirectory)) {
        // 发布前再次检查，若另一执行者已生成相同完整工件，当前临时目录直接丢弃。
        const concurrentBundle = await loadValidBundle({
          expected: input.expected,
          versionId: input.versionId,
          sourceHash: input.sourceHash,
          sourceFormat: input.sourceFormat,
          processingProfile: input.processingProfile,
          tool: {
            name: input.extracted.toolName,
            version: input.extracted.toolVersion,
          },
          signal: input.signal,
        });
        if (concurrentBundle) {
          await fs.rm(temporaryDirectory, { recursive: true, force: true });
          return concurrentBundle;
        }
        await fs.rename(input.expected.absoluteDirectory, quarantineDirectory);
        quarantinedExisting = true;
      }

      // 三个文件先在同级临时目录完成回读校验，再用一次目录改名对外发布完整集合。
      await fs.rename(temporaryDirectory, input.expected.absoluteDirectory);
      if (quarantinedExisting) {
        await fs.rm(quarantineDirectory, { recursive: true, force: true });
        quarantinedExisting = false;
      }

      const validated = await loadValidBundle({
        expected: input.expected,
        versionId: input.versionId,
        sourceHash: input.sourceHash,
        sourceFormat: input.sourceFormat,
        processingProfile: input.processingProfile,
        tool: { name: input.extracted.toolName, version: input.extracted.toolVersion },
        signal: input.signal,
      });
      if (!validated) {
        throw new RegistryError('FILE_PROCESSING', '处理工件发布后的 SHA-256 回读校验失败。');
      }
      return validated;
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
      if (quarantinedExisting && !(await pathExists(input.expected.absoluteDirectory))) {
        await fs.rename(quarantineDirectory, input.expected.absoluteDirectory);
        quarantinedExisting = false;
      }
      if (error instanceof RegistryError) throw error;
      throw new RegistryError('FILE_PROCESSING', '处理工件原子落盘失败。', { cause: error });
    } finally {
      if (quarantinedExisting) {
        await fs.rm(quarantineDirectory, { recursive: true, force: true });
      }
    }
  }

  private registerAndBuildResult(
    bundle: ValidatedBundle,
    versionId: string,
    sourceHash: string,
    processingProfile: string,
    reused: boolean,
  ): ProcessingArtifactSet {
    const timestamp = this.now().toISOString();
    const artifactInputs = [bundle.body, bundle.locatorMap, bundle.manifestFile];
    const upsert = this.database.prepare(`
      INSERT INTO processing_artifacts (
        artifact_id, version_id, artifact_type, relative_path, media_type, size_bytes,
        sha256, source_hash, processing_profile, tool_name, tool_version, lineage_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (
        version_id, artifact_type, source_hash, processing_profile, tool_name, tool_version
      ) DO UPDATE SET
        relative_path = excluded.relative_path,
        media_type = excluded.media_type,
        size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256,
        lineage_json = excluded.lineage_json,
        updated_at = excluded.updated_at
    `);

    const records = this.database.transaction(() => {
      for (const artifact of artifactInputs) {
        const lineage: Record<string, unknown> = {
          schemaVersion: 'layout3_lineage_v1',
          artifactSetKey: bundle.manifest.artifactSetKey,
          source: { kind: 'managed_source', versionId, sha256: sourceHash },
        };
        if (artifact.artifactType === 'locator_map') {
          lineage.describesArtifactSha256 = bundle.body.sha256;
        } else if (artifact.artifactType === 'manifest') {
          lineage.describesArtifactSha256 = [bundle.body.sha256, bundle.locatorMap.sha256];
        }
        upsert.run(
          buildArtifactId({
            versionId,
            artifactType: artifact.artifactType,
            sourceHash,
            processingProfile,
            toolName: bundle.manifest.processing.toolName,
            toolVersion: bundle.manifest.processing.toolVersion,
          }),
          versionId,
          artifact.artifactType,
          artifact.relativePath,
          artifact.mediaType,
          artifact.sizeBytes,
          artifact.sha256,
          sourceHash,
          processingProfile,
          bundle.manifest.processing.toolName,
          bundle.manifest.processing.toolVersion,
          JSON.stringify(lineage),
          bundle.manifest.createdAt,
          timestamp,
        );
      }
      return this.database
        .prepare(`
          SELECT * FROM processing_artifacts
          WHERE version_id = ? AND source_hash = ? AND processing_profile = ?
            AND tool_name = ? AND tool_version = ?
          ORDER BY artifact_type
        `)
        .all(
          versionId,
          sourceHash,
          processingProfile,
          bundle.manifest.processing.toolName,
          bundle.manifest.processing.toolVersion,
        ) as ArtifactRow[];
    })();

    const references = records.map((row) => {
      const record = mapArtifactRow(row);
      return {
        ...record,
        absolutePath: resolveManagedRelativePath(this.managedRoot, record.relativePath),
      };
    });
    const byType = new Map(references.map((reference) => [reference.artifactType, reference]));
    const body = byType.get('extracted_text');
    const locatorMap = byType.get('locator_map');
    const manifest = byType.get('manifest');
    if (!body || !locatorMap || !manifest || references.length !== 3) {
      throw new RegistryError('FILE_PROCESSING', '处理工件登记不完整，已拒绝继续。');
    }
    return { versionId, sourceHash, processingProfile, reused, body, locatorMap, manifest };
  }
}
