import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refineRagflowChunks } from '../src/services/knowledgeRetrieval';
import { DEFAULT_RAGFLOW_CONFIG, type RagflowChunk } from '../src/types/knowledge';
import type { GovernanceEntry } from './lib/ragflowMetadataGovernance';

interface ManifestFile {
  datasets: Array<{
    datasetId: string;
    datasetCode: string;
    entries: GovernanceEntry[];
  }>;
}

interface ApiChunk {
  id?: string;
  content?: string;
  dataset_id?: string;
  document_id?: string;
  document_keyword?: string;
  similarity?: number;
  term_similarity?: number;
  vector_similarity?: number;
}

interface ApiResponse {
  code: number;
  message?: string;
  data?: { chunks?: ApiChunk[]; total?: number };
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const metadataDirectory = path.join(projectRoot, 'evaluation', 'ragflow', 'metadata');
const apiKey = process.env.RAGFLOW_API_KEY?.trim();
const baseUrl = (process.env.RAGFLOW_BASE_URL || DEFAULT_RAGFLOW_CONFIG.baseUrl).replace(/\/$/, '');

if (!apiKey) {
  throw new Error('请通过 RAGFLOW_API_KEY 环境变量提供 API Key；脚本不会读取或保存密钥。');
}

const manifest = JSON.parse(
  await readFile(path.join(metadataDirectory, 'manifest.v1.json'), 'utf8'),
) as ManifestFile;
const englishDataset = manifest.datasets.find((dataset) => dataset.datasetCode === 'english_grade7_rj_v1');
if (!englishDataset) throw new Error('治理清单中缺少英语数据集。');

const unit5DocumentIds = new Set(
  englishDataset.entries
    .filter((entry) => includesMetadataValue(entry.governedMetadata.unit, 'unit_5'))
    .map((entry) => entry.documentId),
);
const cases = [
  { id: 'EN-U05-METADATA-001', unit: 'unit_5', shouldReturn: true },
  { id: 'NO-ANSWER-EN-U08-METADATA-001', unit: 'unit_8', shouldReturn: false },
];
const results = [];

for (const testCase of cases) {
  const rawChunks = await retrieve(testCase.unit, englishDataset.datasetId);
  const refined = refineRagflowChunks(rawChunks, DEFAULT_RAGFLOW_CONFIG);
  const unexpectedDocumentIds = testCase.unit === 'unit_5'
    ? [...new Set(rawChunks.map((chunk) => chunk.documentId).filter((id) => !unit5DocumentIds.has(id)))]
    : [...new Set(rawChunks.map((chunk) => chunk.documentId))];
  const passed = testCase.shouldReturn
    ? rawChunks.length > 0 && refined.chunks.length > 0 && unexpectedDocumentIds.length === 0
    : rawChunks.length === 0 && refined.chunks.length === 0;

  results.push({
    id: testCase.id,
    unit: testCase.unit,
    passed,
    governedDocumentCount: testCase.unit === 'unit_5' ? unit5DocumentIds.size : 0,
    candidateCount: rawChunks.length,
    finalCount: refined.chunks.length,
    unexpectedDocumentIds,
    documents: [...new Set(refined.chunks.map((chunk) => chunk.documentName || chunk.documentId))],
  });
}

const output = {
  schemaVersion: 1,
  taskId: 'PH3-12-metadata-governance-v1',
  generatedAt: new Date().toISOString(),
  passed: results.every((result) => result.passed),
  note: 'RAGFlow 0.25.0 retrieval 在 metadata_condition 无匹配时返回 0；应用侧仍继续执行阈值、去重和同文档上限过滤。',
  results,
};
await writeFile(
  path.join(metadataDirectory, 'filter-verification.v1.json'),
  `${JSON.stringify(output, null, 2)}\n`,
  'utf8',
);

for (const result of results) {
  console.log(`${result.passed ? '通过' : '失败'}\t${result.unit}\t候选 ${result.candidateCount}\t最终 ${result.finalCount}`);
}
if (!output.passed) throw new Error('metadata_condition 真实检索验证失败。');

async function retrieve(unit: string, datasetId: string): Promise<RagflowChunk[]> {
  const response = await fetch(`${baseUrl}/api/v1/retrieval`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_ids: [datasetId],
      question: unit === 'unit_5'
        ? '七年级上册英语 人教版 Unit 5 Fun Clubs can 语法'
        : '七年级上册英语 人教版 Unit 8 语法',
      page: 1,
      page_size: DEFAULT_RAGFLOW_CONFIG.candidateLimit,
      top_k: DEFAULT_RAGFLOW_CONFIG.recallTopK,
      similarity_threshold: DEFAULT_RAGFLOW_CONFIG.similarityThreshold,
      vector_similarity_weight: DEFAULT_RAGFLOW_CONFIG.vectorSimilarityWeight,
      keyword: false,
      highlight: false,
      use_kg: false,
      toc_enhance: false,
      metadata_condition: {
        logic: 'and',
        conditions: [{ name: 'unit', comparison_operator: 'contains', value: unit }],
      },
    }),
  });
  if (!response.ok) throw new Error(`RAGFlow 检索请求失败：${response.status} ${response.statusText}`);
  const payload = await response.json() as ApiResponse;
  if (payload.code !== 0) throw new Error(payload.message || `RAGFlow 返回错误码：${payload.code}`);
  return (payload.data?.chunks || []).flatMap((chunk, index) => {
    if (!chunk.id || !chunk.content || !chunk.dataset_id) return [];
    return [{
      id: chunk.id,
      content: chunk.content,
      datasetId: chunk.dataset_id,
      documentId: chunk.document_id || `unknown-${index}`,
      documentName: chunk.document_keyword,
      similarity: chunk.similarity,
      termSimilarity: chunk.term_similarity,
      vectorSimilarity: chunk.vector_similarity,
    }];
  });
}

function includesMetadataValue(value: unknown, expected: string): boolean {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}
