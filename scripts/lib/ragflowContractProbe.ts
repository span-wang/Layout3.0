export const CONTRACT_TASK_ID = 'PH3-13A-foundation-contract-spike-v1';
export const CONTRACT_DATASET_PREFIX = 'layout3-ph3-13a-contract-';
export const CONTRACT_WRITE_CONFIRMATION = 'PH3-13A_ISOLATED_WRITE';

export const FOUNDATION_CONTRACT_CHECK_IDS = [
  'dataset.create-isolated',
  'document.upload-adversarial-pair',
  'document.metadata-patch-roundtrip',
  'document.parse-trigger-poll',
  'retrieval.document-ids-nonempty',
  'retrieval.document-ids-forged-zero-match',
  'retrieval.document-ids-before-ranking',
  'retrieval.route-a-pending-exact-ids',
  'retrieval.route-a-active-exact-ids',
  'retrieval.metadata-pending-only',
  'retrieval.metadata-active-only',
  'retrieval.quality-pending-conjunction',
  'retrieval.formal-active-conjunction',
  'document.delete-exact-id',
  'dataset.cleanup-finally',
] as const;

export const ROUTE_A_REQUIRED_CHECK_IDS = [
  'dataset.create-isolated',
  'document.upload-adversarial-pair',
  'document.metadata-patch-roundtrip',
  'document.parse-trigger-poll',
  'retrieval.document-ids-nonempty',
  'retrieval.document-ids-forged-zero-match',
  'retrieval.document-ids-before-ranking',
  'retrieval.route-a-pending-exact-ids',
  'retrieval.route-a-active-exact-ids',
  'document.delete-exact-id',
  'dataset.cleanup-finally',
] as const;

export const ROUTE_A_KNOWN_LIMITATION_CHECK_IDS = [
  'retrieval.quality-pending-conjunction',
  'retrieval.formal-active-conjunction',
] as const;

interface FoundationContractCheckResult {
  id: string;
  passed: boolean;
  evidence: Record<string, unknown>;
}

export interface RouteADecisionReport {
  schemaVersion: 1;
  taskId: 'PH3-13A-route-a-decision-v1';
  generatedAt: string;
  source: {
    report: 'evaluation/ragflow/contracts/foundation-contract.v1.json';
    foundationSha256: string | null;
    schemaVersion: number | null;
    taskId: string | null;
    runId: string | null;
    mode: string | null;
    completedAt: string | null;
    evaluationErrorSummary: string | null;
    foundationErrorPresent: boolean;
    originalCheckCount: number;
    expectedOriginalCheckCount: 15;
    originalChecks: Array<{ id: string; passed: boolean }>;
    missingCheckIds: string[];
    unexpectedCheckIds: string[];
    duplicateCheckIds: string[];
  };
  selectedRoute: 'sqlite-active-document-ids';
  compatible: boolean;
  requiredChecks: {
    passed: number;
    total: 11;
    items: Array<{ id: string; passed: boolean }>;
  };
  knownLimitation: {
    id: 'ragflow-0.25.0-document-ids-status-conjunction-ignored';
    ragflowVersion: '0.25.0';
    accepted: true;
    observedInSource: boolean;
    additionalDefenseObserved: boolean;
    checks: Array<{
      id: string;
      passed: boolean | null;
      observation: 'known-limitation-observed' | 'additional-defense-observed' | 'unknown-failure' | 'missing';
      evidenceValid: boolean | null;
      evidenceSummary: {
        apiCode: number | null;
        documentIdFilterCount: number | null;
        returnedDocumentIdCount: number;
        distinctReturnedDocumentIdCount: number;
        chunkCount: number | null;
        expectedStatus: string | null;
        matchesUnrestrictedDocumentSet: boolean;
      };
    }>;
    mitigation: string;
  };
  safeguards: {
    explicitBaseUrl: boolean;
    explicitApiKey: boolean;
    explicitWriteConfirmation: boolean;
    uniqueDatasetPrefix: boolean;
    datasetCreated: boolean;
    productionDatasetIdsUsed: boolean;
    cleanupAttempted: boolean;
    cleanupSucceeded: boolean;
    absentOnReadback: boolean;
    reportContainsEndpointOrCredential: boolean;
    reportContainsAbsolutePath: boolean;
  };
  failures: string[];
}

export interface RouteAEvaluationOptions {
  generatedAt?: string;
  foundationSha256?: string | null;
  evaluationErrorSummary?: string | null;
}

export interface RagflowContractConfig {
  baseUrl: string;
  apiKey: string;
  parseTimeoutMs: number;
}

export interface RagflowRetrievalBody {
  dataset_ids: string[];
  question: string;
  page: number;
  page_size: number;
  top_k: number;
  similarity_threshold: number;
  vector_similarity_weight: number;
  keyword: false;
  highlight: false;
  use_kg: false;
  toc_enhance: false;
  document_ids?: string[];
  metadata_condition?: {
    logic: 'and';
    conditions: Array<{
      name: 'status';
      comparison_operator: 'is';
      value: 'pending' | 'active';
    }>;
  };
}

export type RagflowRouteARetrievalBody = Omit<
  RagflowRetrievalBody,
  'document_ids' | 'metadata_condition'
> & {
  document_ids: string[];
};

/**
 * 合同探针会写入并删除远端资源，因此地址、密钥和确认值三者都必须显式提供。
 */
export function resolveRagflowContractConfig(
  environment: Record<string, string | undefined>,
): RagflowContractConfig {
  const rawBaseUrl = environment.RAGFLOW_BASE_URL?.trim();
  const apiKey = environment.RAGFLOW_API_KEY?.trim();
  const writeConfirmation = environment.RAGFLOW_CONTRACT_ALLOW_WRITE?.trim();

  if (!rawBaseUrl) {
    throw new Error('请通过 RAGFLOW_BASE_URL 显式提供隔离合同测试地址。');
  }
  if (!apiKey) {
    throw new Error('请通过 RAGFLOW_API_KEY 提供合同测试专用 API Key。');
  }
  if (writeConfirmation !== CONTRACT_WRITE_CONFIRMATION) {
    throw new Error(
      `远端写入未确认：请设置 RAGFLOW_CONTRACT_ALLOW_WRITE=${CONTRACT_WRITE_CONFIRMATION}。`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error('RAGFLOW_BASE_URL 不是有效 URL。');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('RAGFLOW_BASE_URL 只允许 http 或 https 协议。');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('RAGFLOW_BASE_URL 禁止包含用户名或密码。');
  }
  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error('RAGFLOW_BASE_URL 禁止包含查询参数或片段。');
  }

  const rawTimeout = environment.RAGFLOW_CONTRACT_PARSE_TIMEOUT_MS?.trim();
  const parseTimeoutMs = rawTimeout ? Number(rawTimeout) : 10 * 60 * 1000;
  if (!Number.isFinite(parseTimeoutMs) || parseTimeoutMs <= 0) {
    throw new Error('RAGFLOW_CONTRACT_PARSE_TIMEOUT_MS 必须是正数。');
  }

  return {
    baseUrl: parsedUrl.toString().replace(/\/$/, ''),
    apiKey,
    parseTimeoutMs,
  };
}

export function createIsolatedDatasetName(
  now: Date,
  randomSuffix: string,
): string {
  const safeSuffix = randomSuffix.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (!safeSuffix) {
    throw new Error('隔离数据集随机后缀不能为空。');
  }
  return `${CONTRACT_DATASET_PREFIX}${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${safeSuffix}`;
}

export function assertIsolatedDatasetName(datasetName: string): void {
  if (!datasetName.startsWith(CONTRACT_DATASET_PREFIX) || datasetName.length <= CONTRACT_DATASET_PREFIX.length) {
    throw new Error('拒绝创建非合同探针前缀的数据集。');
  }
}

export function assertOwnedDatasetId(targetDatasetId: string, createdDatasetId: string): void {
  if (!createdDatasetId || targetDatasetId !== createdDatasetId) {
    throw new Error('拒绝操作非本轮创建的数据集。');
  }
}

export function assertOwnedDocumentIds(
  targetDocumentIds: string[],
  createdDocumentIds: Iterable<string>,
): void {
  const ownedIds = new Set(createdDocumentIds);
  if (targetDocumentIds.length === 0 || targetDocumentIds.some((documentId) => !ownedIds.has(documentId))) {
    throw new Error('拒绝操作非本轮上传的文档。');
  }
}

export function assertExactDatasetDeleteIds(ids: string[], createdDatasetId: string): void {
  if (ids.length !== 1 || ids[0] !== createdDatasetId) {
    throw new Error('拒绝删除本轮隔离数据集以外的目标。');
  }
}

export function buildRagflowRetrievalBody(params: {
  datasetId: string;
  question: string;
  pageSize?: number;
  documentIds?: string[];
  status?: 'pending' | 'active';
}): RagflowRetrievalBody {
  if (!params.datasetId.trim()) {
    throw new Error('检索数据集 ID 不能为空。');
  }
  if (!params.question.trim()) {
    throw new Error('检索问题不能为空。');
  }
  if (params.documentIds && params.documentIds.length === 0) {
    throw new Error('显式 document_ids 不能为空数组。');
  }

  return {
    dataset_ids: [params.datasetId],
    question: params.question.trim(),
    page: 1,
    page_size: params.pageSize ?? 20,
    top_k: 64,
    similarity_threshold: 0,
    vector_similarity_weight: 0.3,
    keyword: false,
    highlight: false,
    use_kg: false,
    toc_enhance: false,
    ...(params.documentIds ? { document_ids: [...params.documentIds] } : {}),
    ...(params.status
      ? {
          metadata_condition: {
            logic: 'and' as const,
            conditions: [{
              name: 'status' as const,
              comparison_operator: 'is' as const,
              value: params.status,
            }],
          },
        }
      : {}),
  };
}

/**
 * 路线 A 的正式门禁只允许 SQLite 给出的精确 document_ids，禁止混入远端 status 条件。
 */
export function buildRouteARetrievalBody(params: {
  datasetId: string;
  question: string;
  pageSize?: number;
  documentIds: string[];
  status?: never;
}): RagflowRouteARetrievalBody {
  if ('status' in params) {
    throw new Error('路线 A 请求不接受 status，必须只使用 SQLite 生成的精确 document_ids。');
  }
  if (!Array.isArray(params.documentIds)
    || params.documentIds.length === 0
    || params.documentIds.some((documentId) => !documentId.trim())) {
    throw new Error('路线 A 请求必须提供非空 document_ids。');
  }

  return {
    ...buildRagflowRetrievalBody({
      datasetId: params.datasetId,
      question: params.question,
      pageSize: params.pageSize,
      documentIds: params.documentIds,
    }),
    document_ids: [...params.documentIds],
  };
}

/**
 * 当前 RAGFlow 0.25.0 对不属于数据集的 document ID 返回 102，而不是 code=0 的空数组。
 * 只要它明确拒绝该 ID 且没有返回片段，就属于稳定失败关闭，不应误记为资料泄漏。
 */
export function isFailClosedDocumentZeroMatch(observation: {
  apiCode: number;
  message: string;
  chunkCount: number;
}): boolean {
  if (observation.chunkCount !== 0) {
    return false;
  }
  return observation.apiCode === 0
    || (observation.apiCode === 102 && /don't own the document/i.test(observation.message));
}

/**
 * 报告只保留合同证据；密钥、服务地址和本机绝对路径统一替换。
 */
export function sanitizeContractReport<T>(value: T, secrets: string[]): T {
  const sanitizedSecrets = secrets.filter(Boolean).sort((left, right) => right.length - left.length);

  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      let result = item;
      for (const secret of sanitizedSecrets) {
        result = result.replaceAll(secret, '<redacted>');
      }
      return result
        .replace(/[A-Za-z]:[\\/][^\r\n,;]*/g, '<absolute-path>')
        .replace(/\/(?:Users|home|tmp|var|opt|workspace)\/[^\s,;]*/g, '<absolute-path>');
    }
    if (Array.isArray(item)) {
      return item.map(visit);
    }
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, entry]) => [key, visit(entry)]),
      );
    }
    return item;
  };

  return visit(value) as T;
}

export function assertContractReportSanitized(value: unknown, secrets: string[]): void {
  const serialized = JSON.stringify(value);
  for (const secret of secrets.filter(Boolean)) {
    if (serialized.includes(secret)) {
      throw new Error('合同报告仍包含敏感配置。');
    }
  }
  if (/[A-Za-z]:\\\\/.test(serialized) || /\/(?:Users|home|tmp|var|opt|workspace)\//.test(serialized)) {
    throw new Error('合同报告仍包含本机绝对路径。');
  }
}

/**
 * 路线 A 只把精确 document_ids 作为远端前置门禁；RAGFlow 0.25.0 的联合 status 失效
 * 被记录为已知限制，并由 SQLite active 集合与返回后二次校验补足。
 */
export function evaluateRouteACompatibility(
  sourceValue: unknown,
  options: RouteAEvaluationOptions = {},
): RouteADecisionReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const foundationSha256 = options.foundationSha256 ?? null;
  const evaluationErrorSummary = options.evaluationErrorSummary?.trim() || null;
  const source = toRecord(sourceValue);
  const rawChecks = Array.isArray(source.checks) ? source.checks : [];
  const checks = rawChecks.flatMap((item): FoundationContractCheckResult[] => {
    const check = toRecord(item);
    if (typeof check.id !== 'string' || typeof check.passed !== 'boolean') {
      return [];
    }
    return [{
      id: check.id,
      passed: check.passed,
      evidence: toRecord(check.evidence),
    }];
  });
  const checkCounts = new Map<string, number>();
  for (const check of checks) {
    checkCounts.set(check.id, (checkCounts.get(check.id) ?? 0) + 1);
  }
  const checksById = new Map(checks.map((check) => [check.id, check]));
  const expectedIds = new Set<string>(FOUNDATION_CONTRACT_CHECK_IDS);
  const missingCheckIds = FOUNDATION_CONTRACT_CHECK_IDS.filter((id) => !checksById.has(id));
  const unexpectedCheckIds = [...checkCounts.keys()].filter((id) => !expectedIds.has(id));
  const duplicateCheckIds = [...checkCounts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  const requiredItems = ROUTE_A_REQUIRED_CHECK_IDS.map((id) => ({
    id,
    passed: checksById.get(id)?.passed === true,
  }));
  const requiredPassed = requiredItems.filter((item) => item.passed).length;
  const unrestrictedDocumentIds = readEvidenceDocumentIds(
    checksById.get('retrieval.document-ids-nonempty')?.evidence,
  );
  const limitationChecks: RouteADecisionReport['knownLimitation']['checks'] = ROUTE_A_KNOWN_LIMITATION_CHECK_IDS.map((id) => {
    const check = checksById.get(id);
    const expectedStatus = id === 'retrieval.quality-pending-conjunction' ? 'pending' : 'active';
    const evidenceSummary = summarizeKnownLimitationEvidence(
      check?.evidence,
      unrestrictedDocumentIds,
      expectedStatus,
    );
    const observation = !check
      ? 'missing' as const
      : check.passed
        ? 'additional-defense-observed' as const
        : evidenceSummary.valid
          ? 'known-limitation-observed' as const
          : 'unknown-failure' as const;
    return {
      id,
      passed: check?.passed ?? null,
      observation,
      evidenceValid: !check || check.passed ? null : evidenceSummary.valid,
      evidenceSummary: evidenceSummary.summary,
    };
  });

  const sourceSafeguards = toRecord(source.safeguards);
  const sourceDataset = toRecord(source.dataset);
  const cleanupEvidence = checksById.get('dataset.cleanup-finally')?.evidence ?? {};
  const explicitBaseUrl = sourceSafeguards.explicitBaseUrl === true;
  const explicitApiKey = sourceSafeguards.explicitApiKey === true;
  const explicitWriteConfirmation = sourceSafeguards.explicitWriteConfirmation === true;
  const uniqueDatasetPrefix = sourceSafeguards.uniqueDatasetPrefix === true;
  const datasetCreated = sourceDataset.created === true;
  const productionDatasetIdsUsed = sourceSafeguards.productionDatasetIdsUsed !== false;
  const cleanupAttempted = sourceDataset.cleanupAttempted === true;
  const cleanupSucceeded = sourceDataset.cleanupSucceeded === true;
  const absentOnReadback = cleanupEvidence.absentOnReadback === true;
  const foundationErrorPresent = source.error !== undefined && source.error !== null;
  const reportContainsEndpointOrCredential = sourceSafeguards.reportContainsEndpointOrCredential !== false
    || containsEndpointOrCredential(sourceValue);
  let reportContainsAbsolutePath = sourceSafeguards.reportContainsAbsolutePath !== false;
  try {
    assertContractReportSanitized(sourceValue, []);
  } catch {
    reportContainsAbsolutePath = true;
  }

  const failures: string[] = [];
  if (!/^[a-f0-9]{64}$/.test(foundationSha256 ?? '')) {
    failures.push(foundationSha256 ? 'foundation 文件 SHA-256 格式错误。' : 'foundation 文件 SHA-256 缺失。');
  }
  if (evaluationErrorSummary) {
    failures.push(`foundation 文件评估失败：${evaluationErrorSummary}`);
  }
  if (source.schemaVersion !== 1) {
    failures.push('原始合同 schemaVersion 必须精确为 1。');
  }
  if (source.taskId !== CONTRACT_TASK_ID) {
    failures.push(`原始合同 taskId 必须精确为 ${CONTRACT_TASK_ID}。`);
  }
  if (source.mode !== 'isolated-write') {
    failures.push('原始合同 mode 必须精确为 isolated-write。');
  }
  if (typeof source.runId !== 'string' || !source.runId.trim()) {
    failures.push('原始合同 runId 不能为空。');
  }
  if (typeof source.completedAt !== 'string'
    || !source.completedAt.trim()
    || Number.isNaN(Date.parse(source.completedAt))) {
    failures.push('原始合同 completedAt 必须是有效时间。');
  }
  if (foundationErrorPresent) {
    failures.push('原始合同包含错误摘要，不能冻结路线 A。');
  }
  if (rawChecks.length !== FOUNDATION_CONTRACT_CHECK_IDS.length || checks.length !== rawChecks.length) {
    failures.push(`原始合同必须包含 ${FOUNDATION_CONTRACT_CHECK_IDS.length} 项有效检查。`);
  }
  if (missingCheckIds.length > 0) {
    failures.push(`原始合同缺少检查：${missingCheckIds.join('、')}。`);
  }
  if (unexpectedCheckIds.length > 0) {
    failures.push(`原始合同包含未知检查：${unexpectedCheckIds.join('、')}。`);
  }
  if (duplicateCheckIds.length > 0) {
    failures.push(`原始合同包含重复检查：${duplicateCheckIds.join('、')}。`);
  }
  for (const item of requiredItems.filter((check) => !check.passed)) {
    failures.push(`路线 A 必需检查未通过：${item.id}。`);
  }
  for (const check of limitationChecks.filter((item) => item.observation === 'unknown-failure')) {
    failures.push(`联合门禁失败证据不符合 RAGFlow 0.25.0 已知限制：${check.id}。`);
  }
  if (!explicitBaseUrl) {
    failures.push('原始合同未确认显式 RAGFLOW_BASE_URL。');
  }
  if (!explicitApiKey) {
    failures.push('原始合同未确认显式 RAGFLOW_API_KEY。');
  }
  if (!explicitWriteConfirmation) {
    failures.push('原始合同未确认显式远端写入授权。');
  }
  if (!uniqueDatasetPrefix) {
    failures.push('原始合同未确认唯一隔离数据集前缀。');
  }
  if (!datasetCreated) {
    failures.push('隔离数据集未确认创建成功。');
  }
  if (productionDatasetIdsUsed) {
    failures.push('合同探针使用了生产数据集 ID，不能冻结路线 A。');
  }
  if (!cleanupAttempted) {
    failures.push('隔离数据集未确认执行清理。');
  }
  if (!cleanupSucceeded) {
    failures.push('隔离数据集清理未成功。');
  }
  if (!absentOnReadback) {
    failures.push('隔离数据集删除后未确认回读缺席。');
  }
  if (reportContainsEndpointOrCredential) {
    failures.push('原始合同报告包含端点或凭据。');
  }
  if (reportContainsAbsolutePath) {
    failures.push('原始合同报告包含本机绝对路径。');
  }

  return {
    schemaVersion: 1,
    taskId: 'PH3-13A-route-a-decision-v1',
    generatedAt,
    source: {
      report: 'evaluation/ragflow/contracts/foundation-contract.v1.json',
      foundationSha256,
      schemaVersion: typeof source.schemaVersion === 'number' ? source.schemaVersion : null,
      taskId: typeof source.taskId === 'string' ? source.taskId : null,
      runId: typeof source.runId === 'string' ? source.runId : null,
      mode: typeof source.mode === 'string' ? source.mode : null,
      completedAt: typeof source.completedAt === 'string' ? source.completedAt : null,
      evaluationErrorSummary,
      foundationErrorPresent,
      originalCheckCount: rawChecks.length,
      expectedOriginalCheckCount: 15,
      originalChecks: checks.map(({ id, passed }) => ({ id, passed })),
      missingCheckIds,
      unexpectedCheckIds,
      duplicateCheckIds,
    },
    selectedRoute: 'sqlite-active-document-ids',
    compatible: failures.length === 0,
    requiredChecks: {
      passed: requiredPassed,
      total: 11,
      items: requiredItems,
    },
    knownLimitation: {
      id: 'ragflow-0.25.0-document-ids-status-conjunction-ignored',
      ragflowVersion: '0.25.0',
      accepted: true,
      observedInSource: limitationChecks.every((check) => check.observation === 'known-limitation-observed'),
      additionalDefenseObserved: limitationChecks.some((check) => check.observation === 'additional-defense-observed'),
      checks: limitationChecks,
      mitigation: '由 SQLite 生成精确 active document_ids，远端 status 仅用于审计与漂移检查，返回结果再经 SQLite 二次校验。',
    },
    safeguards: {
      explicitBaseUrl,
      explicitApiKey,
      explicitWriteConfirmation,
      uniqueDatasetPrefix,
      datasetCreated,
      productionDatasetIdsUsed,
      cleanupAttempted,
      cleanupSucceeded,
      absentOnReadback,
      reportContainsEndpointOrCredential,
      reportContainsAbsolutePath,
    },
    failures,
  };
}

function summarizeKnownLimitationEvidence(
  evidenceValue: unknown,
  unrestrictedDocumentIds: string[],
  requiredStatus: 'pending' | 'active',
): {
  valid: boolean;
  summary: RouteADecisionReport['knownLimitation']['checks'][number]['evidenceSummary'];
} {
  const evidence = toRecord(evidenceValue);
  const returnedDocumentIds = Array.isArray(evidence.returnedDocumentIds)
    ? evidence.returnedDocumentIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  const summary = {
    apiCode: typeof evidence.apiCode === 'number' ? evidence.apiCode : null,
    documentIdFilterCount: typeof evidence.documentIdFilterCount === 'number'
      ? evidence.documentIdFilterCount
      : null,
    returnedDocumentIdCount: returnedDocumentIds.length,
    distinctReturnedDocumentIdCount: new Set(returnedDocumentIds).size,
    chunkCount: typeof evidence.chunkCount === 'number' ? evidence.chunkCount : null,
    expectedStatus: typeof evidence.expectedStatus === 'string' ? evidence.expectedStatus : null,
    matchesUnrestrictedDocumentSet: hasExactStringSet(returnedDocumentIds, unrestrictedDocumentIds),
  };
  return {
    valid: summary.apiCode === 0
      && summary.documentIdFilterCount === 2
      && summary.returnedDocumentIdCount === 2
      && summary.distinctReturnedDocumentIdCount === 2
      && summary.expectedStatus === requiredStatus
      && unrestrictedDocumentIds.length === 2
      && new Set(unrestrictedDocumentIds).size === 2
      && summary.matchesUnrestrictedDocumentSet
      && (summary.chunkCount ?? 0) > 0,
    summary,
  };
}

function readEvidenceDocumentIds(evidenceValue: unknown): string[] {
  const evidence = toRecord(evidenceValue);
  return Array.isArray(evidence.returnedDocumentIds)
    ? evidence.returnedDocumentIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
}

function hasExactStringSet(actualValues: string[], expectedValues: string[]): boolean {
  const actual = new Set(actualValues);
  const expected = new Set(expectedValues);
  return actual.size === expected.size && [...expected].every((value) => actual.has(value));
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function containsEndpointOrCredential(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return /https?:\/\/[^\s"]+/i.test(serialized)
    || /"(?:apiKey|api_key|authorization|password|token|secret)"\s*:\s*"(?!<redacted>)[^"]+"/i.test(serialized);
}
