import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ApiResponse<T> {
  code: number;
  message?: string;
  data?: T;
}

interface SnapshotDocument {
  id: string;
  name: string;
  size: number;
  chunk_count: number;
  meta_fields?: Record<string, unknown>;
}

interface SnapshotFile {
  datasets: Array<{
    datasetId: string;
    datasetCode: string;
    documents: SnapshotDocument[];
  }>;
}

interface DownloadAuditEntry {
  documentId: string;
  documentName: string;
  sourceSize: number;
  sourceChunkCount: number;
  localFile: string | null;
  sha256: string | null;
  status: 'downloaded' | 'verified' | 'empty_source';
}

interface RagflowChunk {
  id: string;
  content: string;
  positions?: number[][];
}

interface ChunkListPayload {
  total: number;
  chunks: RagflowChunk[];
}

interface RagflowDataset {
  id: string;
  name: string;
  description?: string;
  chunk_method: string;
  embedding_model: string;
  parser_config: Record<string, unknown>;
  permission?: 'me' | 'team';
  pagerank?: number;
  similarity_threshold?: number;
  vector_similarity_weight?: number;
}

interface RagflowDocument {
  id: string;
  name: string;
  chunk_count: number;
  run: string;
  progress: number;
  progress_msg?: string;
  meta_fields?: Record<string, unknown>;
}

interface DocumentListPayload {
  total: number;
  docs: RagflowDocument[];
}

interface CorpusManifestEntry {
  file: string;
  originDocumentId: string;
  originDocumentName: string;
  unit: string;
  contentRole: string;
  resourceType: string;
  year: number;
  pairId: string;
  treatment: string;
  sha256: string;
}

interface CorpusManifest {
  documentCount: number;
  entries: CorpusManifestEntry[];
}

interface ShadowDescriptor {
  shadowDatasetId: string;
  shadowDatasetName: string;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const evaluationDirectory = path.join(projectRoot, 'evaluation', 'ragflow', 'data-cleaning');
const workRoot = path.resolve(process.env.RAGFLOW_CLEANING_WORKDIR || path.join(projectRoot, '.ragflow-work', 'english-shadow-v1'));
const originalsDirectory = path.join(workRoot, 'originals');
const baseUrl = (process.env.RAGFLOW_BASE_URL || 'http://127.0.0.1:9380').replace(/\/$/, '');
const apiKey = process.env.RAGFLOW_API_KEY?.trim();
const mode = process.argv.find((argument) => argument.startsWith('--')) || '--download';
const shadowDatasetName = '七年级上册英语（人教版）-清洗影子-V1';

if (!apiKey) {
  throw new Error('请通过 RAGFLOW_API_KEY 环境变量提供 API Key；脚本不会读取、输出或保存密钥。');
}

if (!['--download', '--chunk-boundaries', '--create-shadow', '--upload-shadow', '--parse-shadow'].includes(mode)) {
  throw new Error(`暂不支持执行模式：${mode}`);
}

const snapshot = await readJson<SnapshotFile>(
  path.join(projectRoot, 'evaluation', 'ragflow', 'metadata', 'snapshot.before-apply.v1.json'),
);
const englishDataset = snapshot.datasets.find((dataset) => dataset.datasetCode === 'english_grade7_rj_v1');
if (!englishDataset || englishDataset.documents.length !== 90) {
  throw new Error(`英语快照数量异常：期望 90 份，实际 ${englishDataset?.documents.length ?? 0} 份。`);
}

if (mode === '--chunk-boundaries') {
  await analyzeChunkBoundaries(englishDataset.datasetId, englishDataset.documents);
  process.exit(0);
}

if (mode === '--create-shadow') {
  await createShadowDataset(englishDataset.datasetId);
  process.exit(0);
}

if (mode === '--upload-shadow') {
  await uploadShadowCorpus();
  process.exit(0);
}

if (mode === '--parse-shadow') {
  await parseShadowCorpus();
  process.exit(0);
}

await Promise.all([mkdir(originalsDirectory, { recursive: true }), mkdir(evaluationDirectory, { recursive: true })]);
const entries: DownloadAuditEntry[] = [];

for (const [index, document] of englishDataset.documents.entries()) {
  const safeName = sanitizeFileName(document.name || `unnamed-${document.id}`);
  const localFileName = `${document.id}__${safeName}`;
  const localPath = path.join(originalsDirectory, localFileName);
  if (document.size === 0) {
    entries.push({
      documentId: document.id,
      documentName: document.name,
      sourceSize: 0,
      sourceChunkCount: document.chunk_count,
      localFile: null,
      sha256: null,
      status: 'empty_source',
    });
    console.log(`[${index + 1}/90] 跳过空源文件：${document.name}`);
    continue;
  }

  let status: DownloadAuditEntry['status'] = 'downloaded';
  try {
    const localStat = await stat(localPath);
    if (localStat.size === document.size) {
      status = 'verified';
    } else {
      await downloadDocument(englishDataset.datasetId, document.id, localPath);
    }
  } catch {
    await downloadDocument(englishDataset.datasetId, document.id, localPath);
  }

  const localStat = await stat(localPath);
  if (localStat.size !== document.size) {
    throw new Error(`下载大小不一致：${document.name}，远端 ${document.size}，本地 ${localStat.size}。`);
  }
  entries.push({
    documentId: document.id,
    documentName: document.name,
    sourceSize: document.size,
    sourceChunkCount: document.chunk_count,
    localFile: path.relative(workRoot, localPath).replaceAll('\\', '/'),
    sha256: await sha256(localPath),
    status,
  });
  console.log(`[${index + 1}/90] ${status === 'verified' ? '已校验' : '已下载'}：${document.name}`);
}

const audit = {
  schemaVersion: 1,
  taskId: 'PH3-12-data-cleaning-shadow-kb-v1',
  generatedAt: new Date().toISOString(),
  productionDatasetId: englishDataset.datasetId,
  productionDatasetCode: englishDataset.datasetCode,
  documentCount: entries.length,
  downloadedFileCount: entries.filter((entry) => entry.localFile).length,
  emptySourceCount: entries.filter((entry) => entry.status === 'empty_source').length,
  legacyDocCount: entries.filter((entry) => /\.doc$/i.test(entry.documentName)).length,
  zeroChunkCount: entries.filter((entry) => entry.sourceChunkCount === 0).length,
  workRoot,
  entries,
};

await Promise.all([
  writeJson(path.join(workRoot, 'source-audit.json'), audit),
  writeJson(path.join(evaluationDirectory, 'english-source-audit.v1.json'), {
    ...audit,
    workRoot: '<local-workdir>',
  }),
]);

console.log(`英语资料审计完成：${audit.documentCount} 份记录，${audit.downloadedFileCount} 份本地文件，旧 DOC ${audit.legacyDocCount} 份，零切片 ${audit.zeroChunkCount} 份。`);

async function downloadDocument(datasetId: string, documentId: string, targetPath: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/datasets/${datasetId}/documents/${documentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`文档下载失败：${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json() as ApiResponse<unknown>;
    throw new Error(payload.message || `文档 ${documentId} 未返回文件内容。`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, bytes);
}

async function analyzeChunkBoundaries(datasetId: string, documents: SnapshotDocument[]): Promise<void> {
  const candidateIds = new Set([
    'd0ca17707b8c11f1b1eacb449d41f0c3',
    '43cff4027b8c11f1b1eacb449d41f0c3',
    '43e1004e7b8c11f1b1eacb449d41f0c3',
    '443f38267b8c11f1b1eacb449d41f0c3',
    '444550f87b8c11f1b1eacb449d41f0c3',
    '444ba52a7b8c11f1b1eacb449d41f0c3',
    '4459ec167b8c11f1b1eacb449d41f0c3',
    'd0fde9ec7b8c11f1b1eacb449d41f0c3',
    '5846140c7b8c11f1b1eacb449d41f0c3',
    '447ecab87b8c11f1b1eacb449d41f0c3',
    '448f711a7b8c11f1b1eacb449d41f0c3',
    'a0e83e6a79f711f1a93a9523fdaa939b',
    '58dd3cce7b8c11f1b1eacb449d41f0c3',
    'ce5dac7279f711f1a93a9523fdaa939b',
    'cefdd4ae79f711f1a93a9523fdaa939b',
    'cf246d9e79f711f1a93a9523fdaa939b',
    '5877b70a7b8c11f1b1eacb449d41f0c3',
  ]);
  const unitPatterns: Record<string, RegExp> = {
    starter_unit_1: /starter\s*unit\s*1\b/i,
    starter_unit_2: /starter\s*unit\s*2\b/i,
    starter_unit_3: /starter\s*unit\s*3\b/i,
    unit_1: /unit\s*1\s*(?:you\s*and\s*me)?/i,
    unit_2: /unit\s*2\s*(?:we.?re\s*family)?/i,
    unit_3: /unit\s*3\s*(?:my\s*school)?/i,
    unit_4: /unit\s*4\s*(?:my\s*favou?rite\s*subject)?/i,
    unit_5: /unit\s*5\s*(?:fun\s*clubs)?/i,
    unit_6: /unit\s*6\s*(?:a\s*day\s*in\s*the\s*life)?/i,
    unit_7: /unit\s*7\s*(?:happy\s*birthday)?/i,
  };
  const candidates = documents.filter((document) => candidateIds.has(document.id));
  const reports = [];
  for (const [index, document] of candidates.entries()) {
    const occurrences = Object.fromEntries(Object.keys(unitPatterns).map((unit) => [unit, [] as unknown[]]));
    const payload = document.chunk_count > 0
      ? await requestJson<ChunkListPayload>(
        `/api/v1/datasets/${datasetId}/documents/${document.id}/chunks?page=1&page_size=1000`,
      )
      : { total: 0, chunks: [] };
    for (const chunk of payload.chunks || []) {
      const content = chunk.content.replaceAll('’', "'").replace(/\s+/g, ' ').trim();
      for (const [unit, pattern] of Object.entries(unitPatterns)) {
        const match = pattern.exec(content);
        if (!match || occurrences[unit].length >= 30) continue;
        const pages = (chunk.positions || []).map((position) => Number(position[0])).filter(Number.isFinite);
        occurrences[unit].push({
          chunkId: chunk.id,
          page: pages.length > 0 ? Math.min(...pages) : null,
          preview: content.slice(Math.max(0, match.index - 45), match.index + match[0].length + 95),
        });
      }
    }
    reports.push({
      documentId: document.id,
      documentName: document.name,
      sourceChunkCount: document.chunk_count,
      returnedChunkCount: payload.chunks?.length || 0,
      occurrences,
    });
    console.log(`[${index + 1}/${candidates.length}] OCR 边界扫描：${document.name}，切片 ${payload.chunks?.length || 0}`);
  }
  await mkdir(evaluationDirectory, { recursive: true });
  await writeJson(path.join(evaluationDirectory, 'english-ocr-unit-boundaries.v1.json'), {
    schemaVersion: 1,
    taskId: 'PH3-12-data-cleaning-shadow-kb-v1',
    generatedAt: new Date().toISOString(),
    candidateCount: reports.length,
    documents: reports,
  });
}

async function requestJson<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`RAGFlow 请求失败：${response.status} ${response.statusText}`);
  const payload = await response.json() as ApiResponse<T>;
  if (payload.code !== 0 || payload.data === undefined) {
    throw new Error(payload.message || `RAGFlow 返回错误码：${payload.code}`);
  }
  return payload.data;
}

async function createShadowDataset(productionDatasetId: string): Promise<void> {
  const datasets = await requestJson<RagflowDataset[]>('/api/v1/datasets?page=1&page_size=100');
  const production = datasets.find((dataset) => dataset.id === productionDatasetId);
  if (!production) throw new Error('未找到生产英语数据集，停止创建影子库。');
  const parserConfig = sanitizeParserConfig(production.parser_config);
  let shadow = datasets.find((dataset) => dataset.name === shadowDatasetName);
  if (!shadow) {
    shadow = await requestJson<RagflowDataset>('/api/v1/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: shadowDatasetName,
        description: 'PH3-12 英语清洗影子库 V1；达标前不替换生产库。',
        embedding_model: production.embedding_model,
        permission: production.permission || 'me',
        chunk_method: production.chunk_method,
        parser_config: parserConfig,
        ext: {
          pagerank: production.pagerank ?? 0,
          similarity_threshold: production.similarity_threshold ?? 0.2,
          vector_similarity_weight: production.vector_similarity_weight ?? 0.3,
        },
      }),
    });
    console.log(`已创建独立英语影子库：${shadow.name} (${shadow.id})`);
  } else {
    console.log(`已复用独立英语影子库：${shadow.name} (${shadow.id})`);
  }

  const comparableFields = ['chunk_method', 'embedding_model', 'pagerank', 'similarity_threshold', 'vector_similarity_weight'] as const;
  const differences: string[] = comparableFields.filter((field) => JSON.stringify(shadow?.[field]) !== JSON.stringify(production[field]));
  if (JSON.stringify(projectLike(shadow.parser_config, parserConfig)) !== JSON.stringify(parserConfig)) {
    differences.push('parser_config');
  }
  if (differences.length > 0) {
    throw new Error(`影子库参数与生产英语库不一致：${differences.join(', ')}`);
  }
  await mkdir(evaluationDirectory, { recursive: true });
  await writeJson(path.join(evaluationDirectory, 'english-shadow-dataset.v1.json'), {
    schemaVersion: 1,
    taskId: 'PH3-12-data-cleaning-shadow-kb-v1',
    createdAt: new Date().toISOString(),
    productionDatasetId,
    productionDatasetName: production.name,
    shadowDatasetId: shadow.id,
    shadowDatasetName: shadow.name,
    productionUntouched: true,
    comparableFields,
    parserConfigComparedFields: Object.keys(parserConfig),
    parserConfigIgnoredInternalFields: Object.keys(production.parser_config).filter((field) => !(field in parserConfig)),
    parameterDifferences: differences,
    configuration: {
      ...Object.fromEntries(comparableFields.map((field) => [field, shadow?.[field]])),
      parser_config: projectLike(shadow.parser_config, parserConfig),
    },
  });
}

function sanitizeParserConfig(config: Record<string, unknown>): Record<string, unknown> {
  const allowedFields = new Set([
    'auto_keywords', 'auto_questions', 'chunk_token_num', 'delimiter', 'graphrag', 'html4excel',
    'layout_recognize', 'parent_child', 'raptor', 'tag_kb_ids', 'topn_tags', 'filename_embd_weight',
    'task_page_size', 'pages',
  ]);
  return Object.fromEntries(Object.entries(config).filter(([field]) => allowedFields.has(field)));
}

function projectLike(actual: unknown, expectedShape: unknown): unknown {
  if (Array.isArray(expectedShape)) return actual;
  if (!expectedShape || typeof expectedShape !== 'object') return actual;
  const actualRecord = actual && typeof actual === 'object' ? actual as Record<string, unknown> : {};
  return Object.fromEntries(
    Object.entries(expectedShape as Record<string, unknown>)
      .map(([field, expectedValue]) => [field, projectLike(actualRecord[field], expectedValue)]),
  );
}

async function uploadShadowCorpus(): Promise<void> {
  const [descriptor, corpus] = await Promise.all([
    readJson<ShadowDescriptor>(path.join(evaluationDirectory, 'english-shadow-dataset.v1.json')),
    readJson<CorpusManifest>(path.join(evaluationDirectory, 'english-shadow-corpus-manifest.v1.json')),
  ]);
  const corpusDirectory = path.join(workRoot, 'shadow-corpus');
  let remoteDocuments = await listAllDocuments(descriptor.shadowDatasetId);
  const corpusNames = new Set(corpus.entries.map((entry) => entry.file));
  const unexpectedNames = remoteDocuments.filter((document) => !corpusNames.has(document.name)).map((document) => document.name);
  if (unexpectedNames.length > 0) {
    throw new Error(`影子库存在清单外文件，停止上传：${unexpectedNames.join('、')}`);
  }
  const existingNames = new Set(remoteDocuments.map((document) => document.name));
  const pendingEntries = corpus.entries.filter((entry) => !existingNames.has(entry.file));

  for (let index = 0; index < pendingEntries.length; index += 4) {
    const batch = pendingEntries.slice(index, index + 4);
    const form = new FormData();
    for (const entry of batch) {
      const bytes = await readFile(path.join(corpusDirectory, entry.file));
      form.append('file', new Blob([bytes]), entry.file);
    }
    await requestJson<RagflowDocument[]>(`/api/v1/datasets/${descriptor.shadowDatasetId}/documents`, {
      method: 'POST',
      body: form,
    });
    console.log(`影子库上传进度：${Math.min(index + batch.length, pendingEntries.length)}/${pendingEntries.length}（已存在 ${existingNames.size}）`);
  }

  remoteDocuments = await listAllDocuments(descriptor.shadowDatasetId);
  if (remoteDocuments.length !== corpus.documentCount) {
    throw new Error(`影子库文档数不一致：清单 ${corpus.documentCount}，远端 ${remoteDocuments.length}。`);
  }
  const remoteByName = new Map(remoteDocuments.map((document) => [document.name, document]));
  for (const entry of corpus.entries) {
    const document = remoteByName.get(entry.file);
    if (!document) throw new Error(`影子库缺少文件：${entry.file}`);
    const metadata = {
      metadata_schema: 'layout3_ragflow_v1',
      domain: 'english_education',
      subject: 'english',
      unit: entry.unit,
      chapter: 'unknown',
      content_role: entry.contentRole,
      resource_type: entry.resourceType,
      year: entry.year,
      status: 'ready',
      canonical_id: `english_shadow_clean_v1:${document.id}`,
      pair_id: entry.pairId,
      source_document_id: entry.originDocumentId,
      source_treatment: entry.treatment,
      source_sha256: entry.sha256,
    };
    await requestJson(`/api/v1/datasets/${descriptor.shadowDatasetId}/documents/${document.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta_fields: metadata }),
    });
  }

  const verifiedDocuments = await listAllDocuments(descriptor.shadowDatasetId);
  const mapping = corpus.entries.map((entry) => {
    const document = verifiedDocuments.find((item) => item.name === entry.file);
    if (!document || document.meta_fields?.unit !== entry.unit || document.meta_fields?.source_sha256 !== entry.sha256) {
      throw new Error(`影子库元数据核验失败：${entry.file}`);
    }
    return {
      remoteDocumentId: document.id,
      remoteDocumentName: document.name,
      originDocumentId: entry.originDocumentId,
      unit: entry.unit,
      treatment: entry.treatment,
      sha256: entry.sha256,
    };
  });
  await writeJson(path.join(evaluationDirectory, 'english-shadow-remote-manifest.v1.json'), {
    schemaVersion: 1,
    taskId: 'PH3-12-data-cleaning-shadow-kb-v1',
    generatedAt: new Date().toISOString(),
    shadowDatasetId: descriptor.shadowDatasetId,
    documentCount: mapping.length,
    metadataVerifiedCount: mapping.length,
    documents: mapping,
  });
  console.log(`影子库上传与元数据核验完成：${mapping.length}/${corpus.documentCount}。`);
}

async function parseShadowCorpus(): Promise<void> {
  const descriptor = await readJson<ShadowDescriptor>(path.join(evaluationDirectory, 'english-shadow-dataset.v1.json'));
  let documents = await listAllDocuments(descriptor.shadowDatasetId);
  if (documents.length === 0) throw new Error('影子库尚未上传文档。');
  const pendingIds = documents.filter((document) => document.run !== 'DONE' || document.chunk_count === 0).map((document) => document.id);
  if (pendingIds.length > 0) {
    await requestJson(`/api/v1/datasets/${descriptor.shadowDatasetId}/chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: pendingIds }),
    });
    console.log(`已启动影子库解析：${pendingIds.length} 份。`);
  }

  const timeoutMs = Number(process.env.RAGFLOW_PARSE_TIMEOUT_MS || 4 * 60 * 60 * 1000);
  const startedAt = Date.now();
  while (true) {
    documents = await listAllDocuments(descriptor.shadowDatasetId);
    const failed = documents.filter((document) => document.run === 'FAIL');
    const done = documents.filter((document) => document.run === 'DONE');
    const zeroChunks = done.filter((document) => document.chunk_count === 0);
    console.log(`影子库解析状态：完成 ${done.length}/${documents.length}，失败 ${failed.length}，已完成但零切片 ${zeroChunks.length}。`);
    if (failed.length > 0) {
      await writeParseReport(descriptor.shadowDatasetId, documents);
      throw new Error(`影子库解析失败 ${failed.length} 份：${failed.map((document) => document.name).join('、')}`);
    }
    if (done.length === documents.length) {
      await writeParseReport(descriptor.shadowDatasetId, documents);
      if (zeroChunks.length > 0) {
        throw new Error(`影子库仍有零切片文档 ${zeroChunks.length} 份：${zeroChunks.map((document) => document.name).join('、')}`);
      }
      console.log(`影子库解析完成：${documents.length} 份，零切片 0。`);
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      await writeParseReport(descriptor.shadowDatasetId, documents);
      throw new Error(`影子库解析等待超过 ${Math.round(timeoutMs / 60000)} 分钟。`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

async function listAllDocuments(datasetId: string): Promise<RagflowDocument[]> {
  const documents: RagflowDocument[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (documents.length < total) {
    const payload = await requestJson<DocumentListPayload>(
      `/api/v1/datasets/${datasetId}/documents?page=${page}&page_size=100&orderby=name&desc=false`,
    );
    total = payload.total;
    documents.push(...(payload.docs || []));
    if (!payload.docs?.length) break;
    page += 1;
  }
  return documents;
}

async function writeParseReport(datasetId: string, documents: RagflowDocument[]): Promise<void> {
  await writeJson(path.join(evaluationDirectory, 'english-shadow-parse-report.v1.json'), {
    schemaVersion: 1,
    taskId: 'PH3-12-data-cleaning-shadow-kb-v1',
    generatedAt: new Date().toISOString(),
    shadowDatasetId: datasetId,
    documentCount: documents.length,
    doneCount: documents.filter((document) => document.run === 'DONE').length,
    failedCount: documents.filter((document) => document.run === 'FAIL').length,
    zeroChunkCount: documents.filter((document) => document.run === 'DONE' && document.chunk_count === 0).length,
    chunkCount: documents.reduce((sum, document) => sum + document.chunk_count, 0),
    documents: documents.map((document) => ({
      id: document.id,
      name: document.name,
      run: document.run,
      progress: document.progress,
      progressMessage: document.progress_msg || '',
      chunkCount: document.chunk_count,
    })),
  });
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'unnamed';
}

async function sha256(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
