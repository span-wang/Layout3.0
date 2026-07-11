import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertContractReportSanitized,
  assertExactDatasetDeleteIds,
  assertIsolatedDatasetName,
  assertOwnedDatasetId,
  assertOwnedDocumentIds,
  buildRagflowRetrievalBody,
  buildRouteARetrievalBody,
  CONTRACT_DATASET_PREFIX,
  CONTRACT_TASK_ID,
  CONTRACT_WRITE_CONFIRMATION,
  createIsolatedDatasetName,
  evaluateRouteACompatibility,
  FOUNDATION_CONTRACT_CHECK_IDS,
  isFailClosedDocumentZeroMatch,
  resolveRagflowContractConfig,
  ROUTE_A_KNOWN_LIMITATION_CHECK_IDS,
  sanitizeContractReport,
} from './ragflowContractProbe';

const validEnvironment = {
  RAGFLOW_BASE_URL: 'http://127.0.0.1:9380/',
  RAGFLOW_API_KEY: 'contract-secret-key',
  RAGFLOW_CONTRACT_ALLOW_WRITE: CONTRACT_WRITE_CONFIRMATION,
};

test('合同配置必须同时提供地址、密钥和精确写入确认值', () => {
  assert.throws(
    () => resolveRagflowContractConfig({ ...validEnvironment, RAGFLOW_BASE_URL: undefined }),
    /RAGFLOW_BASE_URL/,
  );
  assert.throws(
    () => resolveRagflowContractConfig({ ...validEnvironment, RAGFLOW_API_KEY: undefined }),
    /RAGFLOW_API_KEY/,
  );
  assert.throws(
    () => resolveRagflowContractConfig({ ...validEnvironment, RAGFLOW_CONTRACT_ALLOW_WRITE: 'true' }),
    /远端写入未确认/,
  );

  const config = resolveRagflowContractConfig(validEnvironment);
  assert.equal(config.baseUrl, 'http://127.0.0.1:9380');
  assert.equal(config.parseTimeoutMs, 600_000);
});

test('合同地址拒绝内嵌凭据、查询参数和非 HTTP 协议', () => {
  assert.throws(
    () => resolveRagflowContractConfig({ ...validEnvironment, RAGFLOW_BASE_URL: 'http://user:pass@127.0.0.1:9380' }),
    /禁止包含用户名或密码/,
  );
  assert.throws(
    () => resolveRagflowContractConfig({ ...validEnvironment, RAGFLOW_BASE_URL: 'http://127.0.0.1:9380?token=x' }),
    /查询参数或片段/,
  );
  assert.throws(
    () => resolveRagflowContractConfig({ ...validEnvironment, RAGFLOW_BASE_URL: 'file:///tmp/ragflow' }),
    /http 或 https/,
  );
});

test('隔离数据集名称必须使用唯一合同前缀', () => {
  const name = createIsolatedDatasetName(new Date('2026-07-10T01:02:03.000Z'), 'A-B_C-123456789');
  assert.equal(name, `${CONTRACT_DATASET_PREFIX}20260710010203-abc123456789`);
  assert.doesNotThrow(() => assertIsolatedDatasetName(name));
  assert.throws(() => assertIsolatedDatasetName('生产英语知识库'), /拒绝创建/);
});

test('远端变更守卫拒绝非本轮数据集和文档', () => {
  const datasetId = 'created-dataset-id';
  const documentIds = new Set(['document-a', 'document-b']);

  assert.doesNotThrow(() => assertOwnedDatasetId(datasetId, datasetId));
  assert.throws(() => assertOwnedDatasetId('production-dataset-id', datasetId), /非本轮创建/);
  assert.doesNotThrow(() => assertOwnedDocumentIds(['document-a'], documentIds));
  assert.throws(() => assertOwnedDocumentIds(['legacy-document'], documentIds), /非本轮上传/);
  assert.throws(() => assertOwnedDocumentIds([], documentIds), /非本轮上传/);
  assert.doesNotThrow(() => assertExactDatasetDeleteIds([datasetId], datasetId));
  assert.throws(
    () => assertExactDatasetDeleteIds(['production-dataset-id'], datasetId),
    /拒绝删除/,
  );
  assert.throws(
    () => assertExactDatasetDeleteIds([datasetId, 'production-dataset-id'], datasetId),
    /拒绝删除/,
  );
});

test('检索请求同时保留精确 document_ids 和 status 条件', () => {
  const body = buildRagflowRetrievalBody({
    datasetId: 'isolated-dataset',
    question: ' 琥珀齿轮协议 ',
    documentIds: ['pending-document', 'active-document'],
    status: 'pending',
  });

  assert.deepEqual(body.dataset_ids, ['isolated-dataset']);
  assert.deepEqual(body.document_ids, ['pending-document', 'active-document']);
  assert.equal(body.question, '琥珀齿轮协议');
  assert.deepEqual(body.metadata_condition, {
    logic: 'and',
    conditions: [{ name: 'status', comparison_operator: 'is', value: 'pending' }],
  });
  assert.throws(
    () => buildRagflowRetrievalBody({
      datasetId: 'isolated-dataset',
      question: 'test',
      documentIds: [],
    }),
    /不能为空数组/,
  );
});

test('路线 A 专用请求强制精确 document_ids 且拒绝发送 status', () => {
  const body = buildRouteARetrievalBody({
    datasetId: 'isolated-dataset',
    question: ' 琥珀齿轮协议 ',
    documentIds: ['active-document'],
  });

  assert.deepEqual(body.document_ids, ['active-document']);
  assert.equal(body.question, '琥珀齿轮协议');
  assert.equal('metadata_condition' in body, false);
  assert.throws(
    () => buildRouteARetrievalBody({
      datasetId: 'isolated-dataset',
      question: 'test',
      documentIds: [],
    }),
    /必须提供非空 document_ids/,
  );
  assert.throws(
    () => buildRouteARetrievalBody({
      datasetId: 'isolated-dataset',
      question: 'test',
    } as unknown as Parameters<typeof buildRouteARetrievalBody>[0]),
    /必须提供非空 document_ids/,
  );
  assert.throws(
    () => buildRouteARetrievalBody({
      datasetId: 'isolated-dataset',
      question: 'test',
      documentIds: ['active-document'],
      ...({ status: 'active' } as Record<string, unknown>),
    }),
    /不接受 status/,
  );
});

test('伪造 document ID 的空结果或明确归属拒绝都属于失败关闭', () => {
  assert.equal(isFailClosedDocumentZeroMatch({ apiCode: 0, message: '', chunkCount: 0 }), true);
  assert.equal(isFailClosedDocumentZeroMatch({
    apiCode: 102,
    message: "The datasets don't own the document forged-id",
    chunkCount: 0,
  }), true);
  assert.equal(isFailClosedDocumentZeroMatch({ apiCode: 102, message: 'unknown error', chunkCount: 0 }), false);
  assert.equal(isFailClosedDocumentZeroMatch({ apiCode: 102, message: "don't own the document", chunkCount: 1 }), false);
});

test('合同报告会脱敏地址、密钥和本机绝对路径', () => {
  const secrets = ['http://127.0.0.1:9380', 'contract-secret-key'];
  const unsafeReport = {
    error: '请求 http://127.0.0.1:9380 失败，key=contract-secret-key',
    windowsPath: 'C:\\Users\\tester\\layout3\\secret.json',
    unixPath: '/home/tester/layout3/secret.json',
  };
  const safeReport = sanitizeContractReport(unsafeReport, secrets);

  assert.doesNotMatch(JSON.stringify(safeReport), /contract-secret-key|127\.0\.0\.1|C:\\\\Users|\/home\/tester/);
  assert.doesNotThrow(() => assertContractReportSanitized(safeReport, secrets));
  assert.throws(() => assertContractReportSanitized(unsafeReport, secrets), /敏感配置/);
  assert.throws(
    () => assertContractReportSanitized({ path: 'C:\\Users\\tester\\secret.json' }, []),
    /绝对路径/,
  );
});

const validFoundationSha256 = 'a'.repeat(64);

function createRouteAFoundationSource() {
  const knownLimitationIds = new Set<string>(ROUTE_A_KNOWN_LIMITATION_CHECK_IDS);
  return {
    schemaVersion: 1,
    taskId: CONTRACT_TASK_ID,
    runId: 'contract-run-id',
    mode: 'isolated-write',
    completedAt: '2026-07-10T14:00:00.000Z',
    safeguards: {
      explicitBaseUrl: true,
      explicitApiKey: true,
      explicitWriteConfirmation: true,
      uniqueDatasetPrefix: true,
      productionDatasetIdsUsed: false,
      reportContainsEndpointOrCredential: false,
      reportContainsAbsolutePath: false,
    },
    dataset: {
      created: true,
      cleanupAttempted: true,
      cleanupSucceeded: true,
    },
    checks: FOUNDATION_CONTRACT_CHECK_IDS.map((id) => {
      const evidence: Record<string, unknown> = {};
      if (knownLimitationIds.has(id)) {
        Object.assign(evidence, {
          apiCode: 0,
          documentIdFilterCount: 2,
          returnedDocumentIds: ['pending-document', 'active-document'],
          chunkCount: 3,
          expectedStatus: id === 'retrieval.quality-pending-conjunction' ? 'pending' : 'active',
        });
      }
      if (id === 'retrieval.document-ids-nonempty') {
        evidence.returnedDocumentIds = ['pending-document', 'active-document'];
      }
      if (id === 'dataset.cleanup-finally') {
        evidence.absentOnReadback = true;
      }
      return {
        id,
        passed: !knownLimitationIds.has(id),
        evidence,
      };
    }),
  };
}

function evaluateValidRouteASource(source: unknown = createRouteAFoundationSource()) {
  return evaluateRouteACompatibility(source, {
    generatedAt: '2026-07-10T14:00:00.000Z',
    foundationSha256: validFoundationSha256,
  });
}

test('路线 A 接受证据吻合的两个联合门禁失败，并要求新的 11 项全部通过', () => {
  const decision = evaluateValidRouteASource();

  assert.equal(decision.selectedRoute, 'sqlite-active-document-ids');
  assert.equal(decision.compatible, true);
  assert.equal(decision.requiredChecks.passed, 11);
  assert.equal(decision.requiredChecks.total, 11);
  assert.ok(decision.requiredChecks.items.every((check) => check.passed));
  assert.ok(decision.requiredChecks.items.some((check) => check.id === 'retrieval.route-a-pending-exact-ids'));
  assert.ok(decision.requiredChecks.items.some((check) => check.id === 'retrieval.route-a-active-exact-ids'));
  assert.ok(decision.requiredChecks.items.every((check) => !check.id.startsWith('retrieval.metadata-')));
  assert.equal(decision.source.originalCheckCount, 15);
  assert.equal(decision.source.foundationSha256, validFoundationSha256);
  assert.equal(decision.knownLimitation.observedInSource, true);
  assert.equal(decision.knownLimitation.additionalDefenseObserved, false);
  assert.deepEqual(
    decision.knownLimitation.checks.map((check) => [check.id, check.passed, check.observation, check.evidenceValid]),
    [
      ['retrieval.quality-pending-conjunction', false, 'known-limitation-observed', true],
      ['retrieval.formal-active-conjunction', false, 'known-limitation-observed', true],
    ],
  );
  assert.deepEqual(decision.failures, []);
});

test('路线 A 决策会拒绝缺少原始合同检查的报告', () => {
  const source = createRouteAFoundationSource();
  source.checks = source.checks.filter((check) => check.id !== 'retrieval.route-a-pending-exact-ids');

  const decision = evaluateValidRouteASource(source);

  assert.equal(decision.compatible, false);
  assert.deepEqual(decision.source.missingCheckIds, ['retrieval.route-a-pending-exact-ids']);
  assert.match(decision.failures.join('\n'), /缺少检查/);
});

test('路线 A 决策会拒绝任一精确 ID 必需检查失败', () => {
  const source = createRouteAFoundationSource();
  const requiredCheck = source.checks.find((check) => check.id === 'retrieval.route-a-active-exact-ids');
  assert.ok(requiredCheck);
  requiredCheck.passed = false;

  const decision = evaluateValidRouteASource(source);

  assert.equal(decision.compatible, false);
  assert.equal(decision.requiredChecks.passed, 10);
  assert.match(decision.failures.join('\n'), /retrieval\.route-a-active-exact-ids/);
});

test('联合门禁失败只有证据精确吻合 0.25.0 现象时才可接受', () => {
  const source = createRouteAFoundationSource();
  const limitationCheck = source.checks.find((check) => check.id === 'retrieval.formal-active-conjunction');
  assert.ok(limitationCheck);
  limitationCheck.evidence = {
    apiCode: 102,
    documentIdFilterCount: 2,
    returnedDocumentIds: ['active-document'],
    chunkCount: 0,
  };

  const decision = evaluateValidRouteASource(source);
  const evaluatedCheck = decision.knownLimitation.checks.find((check) => check.id === limitationCheck.id);

  assert.equal(decision.compatible, false);
  assert.equal(evaluatedCheck?.observation, 'unknown-failure');
  assert.equal(evaluatedCheck?.evidenceValid, false);
  assert.match(decision.failures.join('\n'), /失败证据不符合/);
});

test('联合门禁已知限制必须返回本轮同一文档集合和正确状态证据', () => {
  const source = createRouteAFoundationSource();
  const limitationCheck = source.checks.find((check) => check.id === 'retrieval.formal-active-conjunction');
  assert.ok(limitationCheck);
  limitationCheck.evidence = {
    apiCode: 0,
    documentIdFilterCount: 2,
    returnedDocumentIds: ['unrelated-document-a', 'unrelated-document-b'],
    chunkCount: 2,
    expectedStatus: 'pending',
  };

  const decision = evaluateValidRouteASource(source);
  const evaluatedCheck = decision.knownLimitation.checks.find((check) => check.id === limitationCheck.id);

  assert.equal(decision.compatible, false);
  assert.equal(evaluatedCheck?.observation, 'unknown-failure');
  assert.equal(evaluatedCheck?.evidenceSummary.matchesUnrestrictedDocumentSet, false);
  assert.equal(evaluatedCheck?.evidenceSummary.expectedStatus, 'pending');
});

test('路线 A 决策会独立拒绝清理失败或删除后仍可回读', () => {
  const source = createRouteAFoundationSource();
  source.dataset.cleanupSucceeded = false;
  const cleanupCheck = source.checks.find((check) => check.id === 'dataset.cleanup-finally');
  assert.ok(cleanupCheck);
  cleanupCheck.evidence = { absentOnReadback: false };

  const decision = evaluateValidRouteASource(source);

  assert.equal(decision.compatible, false);
  assert.equal(decision.safeguards.cleanupSucceeded, false);
  assert.equal(decision.safeguards.absentOnReadback, false);
  assert.match(decision.failures.join('\n'), /清理未成功/);
  assert.match(decision.failures.join('\n'), /未确认回读缺席/);
});

test('路线 A 决策强制校验源合同身份、显式守卫与隔离数据集创建', () => {
  const source = createRouteAFoundationSource();
  source.schemaVersion = 2;
  source.taskId = 'wrong-task';
  source.mode = 'read-only';
  source.safeguards.explicitBaseUrl = false;
  source.safeguards.explicitApiKey = false;
  source.safeguards.explicitWriteConfirmation = false;
  source.safeguards.uniqueDatasetPrefix = false;
  source.dataset.created = false;
  source.dataset.cleanupAttempted = false;
  source.runId = '';
  source.completedAt = '';

  const decision = evaluateValidRouteASource(source);
  const failures = decision.failures.join('\n');

  assert.equal(decision.compatible, false);
  assert.match(failures, /schemaVersion/);
  assert.match(failures, /taskId/);
  assert.match(failures, /isolated-write/);
  assert.match(failures, /RAGFLOW_BASE_URL/);
  assert.match(failures, /RAGFLOW_API_KEY/);
  assert.match(failures, /写入授权/);
  assert.match(failures, /唯一隔离数据集前缀/);
  assert.match(failures, /未确认创建成功/);
  assert.match(failures, /未确认执行清理/);
  assert.match(failures, /runId/);
  assert.match(failures, /completedAt/);
});

test('路线 A 决策要求 foundation SHA-256，且读取错误或原始错误摘要均失败', () => {
  const source = createRouteAFoundationSource();
  const missingHashDecision = evaluateRouteACompatibility(source);
  const invalidHashDecision = evaluateRouteACompatibility(source, { foundationSha256: 'invalid' });
  const readErrorDecision = evaluateRouteACompatibility(source, {
    foundationSha256: validFoundationSha256,
    evaluationErrorSummary: 'foundation 文件无法读取。',
  });
  const sourceErrorDecision = evaluateValidRouteASource({ ...source, error: '远端探针失败。' });

  assert.match(missingHashDecision.failures.join('\n'), /SHA-256 缺失/);
  assert.match(invalidHashDecision.failures.join('\n'), /SHA-256 格式错误/);
  assert.match(readErrorDecision.failures.join('\n'), /文件评估失败/);
  assert.match(sourceErrorDecision.failures.join('\n'), /包含错误摘要/);
  assert.equal(missingHashDecision.compatible, false);
  assert.equal(invalidHashDecision.compatible, false);
  assert.equal(readErrorDecision.compatible, false);
  assert.equal(sourceErrorDecision.compatible, false);
});

test('路线 A 决策要求生产隔离标记与报告脱敏同时成立', () => {
  const source = createRouteAFoundationSource();
  source.safeguards.productionDatasetIdsUsed = true;
  const unsafeSource = {
    ...source,
    endpoint: 'http://127.0.0.1:9380',
    apiKey: 'contract-secret-key',
    localPath: 'C:\\Users\\tester\\layout3\\contract.json',
  };

  const decision = evaluateValidRouteASource(unsafeSource);

  assert.equal(decision.compatible, false);
  assert.equal(decision.safeguards.productionDatasetIdsUsed, true);
  assert.equal(decision.safeguards.reportContainsEndpointOrCredential, true);
  assert.equal(decision.safeguards.reportContainsAbsolutePath, true);
});

test('联合门禁未来通过时记录为额外防御，不反向阻塞路线 A', () => {
  const source = createRouteAFoundationSource();
  for (const check of source.checks) {
    if (ROUTE_A_KNOWN_LIMITATION_CHECK_IDS.some((id) => id === check.id)) {
      check.passed = true;
      check.evidence = {};
    }
  }

  const decision = evaluateValidRouteASource(source);

  assert.equal(decision.compatible, true);
  assert.equal(decision.knownLimitation.observedInSource, false);
  assert.equal(decision.knownLimitation.additionalDefenseObserved, true);
  assert.ok(decision.knownLimitation.checks.every((check) => check.observation === 'additional-defense-observed'));
});
