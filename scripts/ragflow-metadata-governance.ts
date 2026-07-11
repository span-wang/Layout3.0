import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  governDocumentMetadata,
  type ControlledMetadata,
  type GovernanceDataset,
  type GovernanceEntry,
  type RagflowGovernanceDocument,
} from './lib/ragflowMetadataGovernance';

interface BaselineFile {
  datasets: Array<{ id: string; name: string }>;
}

interface ApiResponse<T> {
  code: number;
  message?: string;
  data?: T;
}

interface DocumentListPayload {
  total: number;
  docs: RagflowGovernanceDocument[];
}

interface DatasetSnapshot {
  datasetId: string;
  datasetCode: GovernanceDataset['code'];
  documents: RagflowGovernanceDocument[];
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const evaluationDirectory = path.join(projectRoot, 'evaluation', 'ragflow');
const metadataDirectory = path.join(evaluationDirectory, 'metadata');
const apiKey = process.env.RAGFLOW_API_KEY?.trim();
const baseUrl = (process.env.RAGFLOW_BASE_URL || 'http://127.0.0.1:9380').replace(/\/$/, '');
const applyChanges = process.argv.includes('--apply');
const verifyOnly = process.argv.includes('--verify');

if (!apiKey) {
  throw new Error('请通过 RAGFLOW_API_KEY 环境变量提供 API Key；脚本不会读取或保存密钥。');
}

const baseline = await readJson<BaselineFile>(path.join(evaluationDirectory, 'baseline-config.v1.json'));
const datasets = buildGovernanceDatasets(baseline);
await mkdir(metadataDirectory, { recursive: true });

if (verifyOnly) {
  const manifest = await readJson<{ datasets: Array<{ datasetId: string; entries: GovernanceEntry[] }> }>(
    path.join(metadataDirectory, 'manifest.v1.json'),
  );
  await verifyAppliedMetadata(datasets, manifest.datasets.flatMap((dataset) => dataset.entries));
  console.log('元数据核验通过：远端文档数、文档 ID 和受控字段均与清单一致。');
  process.exit(0);
}

const snapshots = await Promise.all(datasets.map(async (dataset): Promise<DatasetSnapshot> => ({
  datasetId: dataset.id,
  datasetCode: dataset.code,
  documents: await listAllDocuments(dataset.id),
})));
const capturedAt = new Date().toISOString();
await writeJsonIfMissing(path.join(metadataDirectory, 'snapshot.before-apply.v1.json'), {
  schemaVersion: 1,
  taskId: 'PH3-12-metadata-governance-v1',
  capturedAt,
  datasets: snapshots,
});

const manifestDatasets = datasets.map((dataset) => {
  const snapshot = snapshots.find((item) => item.datasetId === dataset.id);
  const entries = (snapshot?.documents || []).map((document) => governDocumentMetadata(dataset, document));
  return { datasetId: dataset.id, datasetCode: dataset.code, entries };
});
const allEntries = manifestDatasets.flatMap((dataset) => dataset.entries);
const report = buildReport(allEntries);

await writeJson(path.join(metadataDirectory, 'manifest.v1.json'), {
  schemaVersion: 1,
  taskId: 'PH3-12-metadata-governance-v1',
  generatedAt: capturedAt,
  mode: applyChanges ? 'apply' : 'dry-run',
  datasets: manifestDatasets,
});
await writeJson(path.join(metadataDirectory, 'report.v1.json'), report);

console.log(`文档总数：${report.documentCount}`);
console.log(`待变更：${report.changedCount}`);
console.log(`待人工复核：${report.reviewCount}`);
console.log(`零切片/隔离：${report.statusDistribution.quarantine ?? 0}`);

if (!applyChanges) {
  console.log('dry-run 已完成；确认报告后使用 --apply 显式写回。');
  process.exit(0);
}

for (const dataset of manifestDatasets) {
  for (const entry of dataset.entries.filter((item) => item.changed)) {
    await updateDocumentMetadata(dataset.datasetId, entry.documentId, entry.governedMetadata);
  }
}
await verifyAppliedMetadata(datasets, allEntries);
console.log(`写回并核验完成：共更新 ${report.changedCount} 份文档。`);

function buildGovernanceDatasets(baselineFile: BaselineFile): GovernanceDataset[] {
  return baselineFile.datasets.map((dataset) => {
    if (dataset.name.includes('英语')) {
      return { ...dataset, code: 'english_grade7_rj_v1', domain: 'english_education', defaultSubject: 'english' };
    }
    if (dataset.name.includes('会计')) {
      return { ...dataset, code: 'intermediate_accounting_v1', domain: 'accounting_certification', defaultSubject: 'unknown' };
    }
    throw new Error(`数据集“${dataset.name}”尚未配置确定性治理规则。`);
  });
}

async function listAllDocuments(datasetId: string): Promise<RagflowGovernanceDocument[]> {
  const documents: RagflowGovernanceDocument[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (documents.length < total) {
    const payload = await request<DocumentListPayload>(
      `/api/v1/datasets/${datasetId}/documents?page=${page}&page_size=100&orderby=name&desc=false`,
    );
    total = payload.total;
    documents.push(...(payload.docs || []));
    if (!payload.docs?.length) break;
    page += 1;
  }
  if (documents.length !== total) {
    throw new Error(`数据集 ${datasetId} 快照不完整：期望 ${total} 份，实际 ${documents.length} 份。`);
  }
  return documents;
}

async function updateDocumentMetadata(
  datasetId: string,
  documentId: string,
  metadata: ControlledMetadata,
): Promise<void> {
  await request(`/api/v1/datasets/${datasetId}/documents/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ meta_fields: metadata }),
  });
}

async function verifyAppliedMetadata(datasets: GovernanceDataset[], entries: GovernanceEntry[]): Promise<void> {
  const expectedById = new Map(entries.map((entry) => [entry.documentId, entry.governedMetadata]));
  const actualDocuments = (await Promise.all(datasets.map((dataset) => listAllDocuments(dataset.id)))).flat();
  if (actualDocuments.length !== entries.length) {
    throw new Error(`核验文档总数不一致：清单 ${entries.length}，远端 ${actualDocuments.length}。`);
  }
  for (const document of actualDocuments) {
    const expected = expectedById.get(document.id);
    if (!expected || !metadataEquals(document.meta_fields ?? {}, expected)) {
      throw new Error(`文档 ${document.id} 元数据核验失败。`);
    }
  }
}

function buildReport(entries: GovernanceEntry[]) {
  const distributions = (field: keyof ControlledMetadata) => entries.reduce<Record<string, number>>((result, entry) => {
    const values = Array.isArray(entry.governedMetadata[field])
      ? entry.governedMetadata[field] as Array<string | number>
      : [entry.governedMetadata[field]];
    for (const value of values) result[String(value)] = (result[String(value)] || 0) + 1;
    return result;
  }, {});
  return {
    schemaVersion: 1,
    taskId: 'PH3-12-metadata-governance-v1',
    generatedAt: new Date().toISOString(),
    documentCount: entries.length,
    changedCount: entries.filter((entry) => entry.changed).length,
    reviewCount: entries.filter((entry) => entry.reviewReasons.length > 0).length,
    requiredFieldCoverage: Object.fromEntries(
      ['metadata_schema', 'domain', 'subject', 'unit', 'content_role', 'resource_type', 'status', 'canonical_id', 'pair_id']
        .map((field) => [field, 1]),
    ),
    subjectDistribution: distributions('subject'),
    unitDistribution: distributions('unit'),
    contentRoleDistribution: distributions('content_role'),
    statusDistribution: distributions('status'),
    reviewQueue: entries
      .filter((entry) => entry.reviewReasons.length > 0)
      .map((entry) => ({ documentId: entry.documentId, documentName: entry.documentName, reasons: entry.reviewReasons })),
  };
}

async function request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
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

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await access(filePath);
  } catch {
    await writeJson(filePath, value);
  }
}

function metadataEquals(left: Record<string, unknown>, right: ControlledMetadata): boolean {
  const sort = (value: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(value).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)));
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}
