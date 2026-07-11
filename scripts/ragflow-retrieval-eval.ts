import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  refineRagflowChunks,
  routeRagflowDatasetIds,
} from '../src/services/knowledgeRetrieval';
import { DEFAULT_RAGFLOW_CONFIG } from '../src/types/knowledge';
import type { RagflowChunk, RagflowDatasetSummary } from '../src/types/knowledge';

interface EvaluationCase {
  id: string;
  query: string;
  subject: string;
  expectedDataset: string | null;
  expectedDocumentNameIncludes: string[];
  expectedEvidenceIncludes?: string[];
  forbiddenDatasets: string[];
  shouldReturnEvidence: boolean;
}

interface EvaluationCaseFile {
  schemaVersion: number;
  cases: EvaluationCase[];
}

interface BaselineFile {
  datasets: Array<{
    id: string;
    name: string;
  }>;
}

interface RagflowApiChunk {
  id?: string;
  content?: string;
  dataset_id?: string;
  document_id?: string;
  document_keyword?: string;
  similarity?: number;
  term_similarity?: number;
  vector_similarity?: number;
}

interface RagflowApiResponse {
  code: number;
  message?: string;
  data?: {
    chunks?: RagflowApiChunk[];
    total?: number;
  };
}

interface CaseResult {
  id: string;
  passed: boolean;
  routedDatasets: string[];
  candidateCount: number;
  finalCount: number;
  firstRelevantRank: number | null;
  forbiddenHitCount: number;
  documents: string[];
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const evaluationDirectory = path.join(projectRoot, 'evaluation', 'ragflow');
const apiKey = process.env.RAGFLOW_API_KEY?.trim();
const baseUrl = (process.env.RAGFLOW_BASE_URL || DEFAULT_RAGFLOW_CONFIG.baseUrl).replace(/\/$/, '');

if (!apiKey) {
  throw new Error('请通过 RAGFLOW_API_KEY 环境变量提供评测专用 API Key，脚本不会读取或保存本机密钥。');
}

const [baseline, caseFile] = await Promise.all([
  readJson<BaselineFile>(path.join(evaluationDirectory, 'baseline-config.v1.json')),
  readJson<EvaluationCaseFile>(path.join(evaluationDirectory, 'retrieval-cases.v1.json')),
]);

const datasets: RagflowDatasetSummary[] = baseline.datasets.map((dataset) => ({
  id: dataset.id,
  name: dataset.name,
}));
const datasetNameById = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
const allDatasetIds = datasets.map((dataset) => dataset.id);
const caseResults: CaseResult[] = [];

for (const evaluationCase of caseFile.cases) {
  const routedDatasetIds = routeRagflowDatasetIds({
    datasets,
    selectedDatasetIds: allDatasetIds,
    subject: evaluationCase.subject,
  });
  const chunks = routedDatasetIds.length > 0
    ? await retrieveChunks(evaluationCase.query, routedDatasetIds)
    : [];
  const refined = refineRagflowChunks(chunks, DEFAULT_RAGFLOW_CONFIG);
  const forbiddenDatasetSet = new Set(evaluationCase.forbiddenDatasets);
  const forbiddenHitCount = refined.chunks.filter((chunk) =>
    forbiddenDatasetSet.has(datasetNameById.get(chunk.datasetId) || chunk.datasetId),
  ).length;
  const firstRelevantIndex = refined.chunks.findIndex((chunk) => isRelevantChunk(chunk, evaluationCase));
  const passed = evaluationCase.shouldReturnEvidence
    ? firstRelevantIndex >= 0 && forbiddenHitCount === 0
    : refined.chunks.length === 0;

  caseResults.push({
    id: evaluationCase.id,
    passed,
    routedDatasets: routedDatasetIds.map((id) => datasetNameById.get(id) || id),
    candidateCount: chunks.length,
    finalCount: refined.chunks.length,
    firstRelevantRank: firstRelevantIndex >= 0 ? firstRelevantIndex + 1 : null,
    forbiddenHitCount,
    documents: refined.chunks.map((chunk) => chunk.documentName || chunk.documentId),
  });
}

const positiveResults = caseResults.filter((_, index) => caseFile.cases[index].shouldReturnEvidence);
const noAnswerResults = caseResults.filter((_, index) => !caseFile.cases[index].shouldReturnEvidence);
const summary = {
  generatedAt: new Date().toISOString(),
  configuration: {
    resultLimit: DEFAULT_RAGFLOW_CONFIG.resultLimit,
    candidateLimit: DEFAULT_RAGFLOW_CONFIG.candidateLimit,
    recallTopK: DEFAULT_RAGFLOW_CONFIG.recallTopK,
    similarityThreshold: DEFAULT_RAGFLOW_CONFIG.similarityThreshold,
    vectorSimilarityWeight: DEFAULT_RAGFLOW_CONFIG.vectorSimilarityWeight,
    rerankId: DEFAULT_RAGFLOW_CONFIG.rerankId,
    keywordExpansion: DEFAULT_RAGFLOW_CONFIG.enableKeyword,
  },
  metrics: {
    casePassRate: divide(caseResults.filter((result) => result.passed).length, caseResults.length),
    positiveHitRate: divide(positiveResults.filter((result) => result.firstRelevantRank !== null).length, positiveResults.length),
    meanReciprocalRank: divide(
      positiveResults.reduce((sum, result) => sum + (result.firstRelevantRank ? 1 / result.firstRelevantRank : 0), 0),
      positiveResults.length,
    ),
    forbiddenDatasetViolationRate: divide(
      caseResults.filter((result) => result.forbiddenHitCount > 0).length,
      caseResults.length,
    ),
    noAnswerRejectionRate: divide(noAnswerResults.filter((result) => result.finalCount === 0).length, noAnswerResults.length),
  },
  cases: caseResults,
};

const outputPath = path.join(evaluationDirectory, 'latest-results.json');
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

for (const result of caseResults) {
  console.log(`${result.passed ? '通过' : '失败'}\t${result.id}\t候选 ${result.candidateCount}\t最终 ${result.finalCount}\t首个正确名次 ${result.firstRelevantRank ?? '-'}`);
}
console.log(JSON.stringify(summary.metrics, null, 2));
console.log(`评测结果已写入：${outputPath}`);

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function retrieveChunks(query: string, datasetIds: string[]): Promise<RagflowChunk[]> {
  const response = await fetch(`${baseUrl}/api/v1/retrieval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dataset_ids: datasetIds,
      question: query,
      page: 1,
      page_size: DEFAULT_RAGFLOW_CONFIG.candidateLimit,
      top_k: DEFAULT_RAGFLOW_CONFIG.recallTopK,
      similarity_threshold: DEFAULT_RAGFLOW_CONFIG.similarityThreshold,
      vector_similarity_weight: DEFAULT_RAGFLOW_CONFIG.vectorSimilarityWeight,
      keyword: false,
      highlight: false,
      use_kg: false,
      toc_enhance: false,
      rerank_id: DEFAULT_RAGFLOW_CONFIG.rerankId,
    }),
  });
  if (!response.ok) {
    throw new Error(`RAGFlow 评测请求失败：${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as RagflowApiResponse;
  if (payload.code !== 0) {
    throw new Error(payload.message || `RAGFlow 评测返回错误码：${payload.code}`);
  }

  return (payload.data?.chunks || []).flatMap((chunk, index) => {
    if (!chunk.id || !chunk.content || !chunk.dataset_id) {
      return [];
    }
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

function isRelevantChunk(chunk: RagflowChunk, evaluationCase: EvaluationCase): boolean {
  const datasetName = datasetNameById.get(chunk.datasetId) || chunk.datasetId;
  if (datasetName !== evaluationCase.expectedDataset) {
    return false;
  }
  const documentName = chunk.documentName || '';
  const evidenceText = `${documentName}\n${chunk.content}`;
  const expectedParts = evaluationCase.expectedEvidenceIncludes?.length
    ? evaluationCase.expectedEvidenceIncludes
    : evaluationCase.expectedDocumentNameIncludes;
  return expectedParts.every((part) => evidenceText.includes(part));
}

function divide(value: number, total: number): number {
  return total > 0 ? Number((value / total).toFixed(4)) : 0;
}
