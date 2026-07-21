import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { KnowledgeIngestionMetadata } from '../../../src/types/knowledgeIngestion';
import {
  parseKnowledgeIngestionConfirmPayload,
  parseKnowledgeIngestionItemActionPayload,
  parseKnowledgeIngestionRagflowConfigPayload,
} from './contract';
import {
  DOCX_EXTRACTOR_TOOL,
  LOCATOR_SCHEMA_VERSION,
  ProcessingArtifactService,
} from './processing';
import { RegistryDatabase } from './registry-database';
import { QualityGateRepository } from './quality-gate-repository';
import { RegistryStore } from './registry-store';
import { KnowledgeIngestionRuntime } from './runtime';
import { REGISTRY_SCHEMA_VERSION } from './schema';
import { RegistryError } from './types';
import { guardProtectedRagflowDatasetRequest } from '../protected-ragflow-dataset-guard';

const { Document, Packer, Paragraph } = createRequire(import.meta.url)('docx') as typeof import('docx');

const confirmedMetadata: KnowledgeIngestionMetadata = {
  stableTitle: '七年级英语第五单元讲义',
  domain: '教育',
  subject: '英语',
  materialType: '讲义',
  language: '中文',
  educationStage: '初中',
  grade: '七年级',
  semester: '上册',
  edition: '人教版',
  unit: 'Unit 5',
  parserProfile: 'education-textbook-v1',
};

const testCredentialCipher = {
  isAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
};

async function createDocx(filePath: string, text: string): Promise<void> {
  const document = new Document({
    sections: [{ children: [new Paragraph(text)] }],
  });
  writeFileSync(filePath, await Packer.toBuffer(document));
}

async function createDocxWithParagraphs(filePath: string, paragraphs: string[]): Promise<void> {
  const document = new Document({
    sections: [{ children: paragraphs.map((text) => new Paragraph(text)) }],
  });
  writeFileSync(filePath, await Packer.toBuffer(document));
}

function createPdf(filePath: string, encrypted = false): void {
  const encryptionMarker = encrypted ? '/Encrypt 9 0 R\n' : '';
  writeFileSync(
    filePath,
    `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n${encryptionMarker}trailer<</Root 1 0 R>>\n%%EOF\n`,
  );
}

function withTemporaryRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'layout3-intake-test-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function assertRegistryError(error: unknown, code: RegistryError['code']): boolean {
  return error instanceof RegistryError && error.code === code;
}

const runtimeQualityQuestions = [
  { question: '第一条质量要求是什么？', evidence: '第一条运行时唯一正文证据。' },
  { question: '第二条质量要求是什么？', evidence: '第二条运行时唯一正文证据。' },
  { question: '第三条质量要求是什么？', evidence: '第三条运行时唯一正文证据。' },
];

async function prepareRuntimeQualityItem(root: string, runtime: KnowledgeIngestionRuntime) {
  await runtime.saveRagflowConfig({
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'runtime-quality-key',
    stagingDatasetId: 'dataset-runtime-quality',
    indexGeneration: 'runtime-quality-v1',
  });
  const sourcePath = join(root, '运行时质量检查.docx');
  await createDocxWithParagraphs(
    sourcePath,
    runtimeQualityQuestions.map((question) => question.evidence),
  );
  const service = await runtime.getService();
  const item = await service.intakeFile(sourcePath);
  service.confirmMetadata({ itemId: item.itemId, metadata: confirmedMetadata });

  const databasePath = join(root, 'knowledge-ingestion', 'registry.sqlite');
  const connection = new Database(databasePath);
  connection.pragma('foreign_keys = ON');
  const registryDatabase = new RegistryDatabase(connection, databasePath, null);
  try {
    const bodyText = runtimeQualityQuestions.map((question) => question.evidence).join('\n');
    let nextOffset = 0;
    const blocks = runtimeQualityQuestions.map((question, index) => {
      const startOffset = nextOffset;
      const endOffset = startOffset + question.evidence.length;
      nextOffset = endOffset + 1;
      return {
        blockId: `paragraph-${index + 1}`,
        blockType: 'paragraph' as const,
        startOffset,
        endOffset,
        headingPath: ['运行时质量检查'],
        headingLevel: null,
        paragraphNumber: index + 1,
        tableNumber: null,
        rowCount: null,
        columnCount: null,
        explicitPageBreaks: [],
      };
    });
    // 用确定性测试抽取器生成真实工件结构，避免并行测试争用 worker 进程。
    const artifactService = new ProcessingArtifactService(
      registryDatabase,
      join(root, 'knowledge-ingestion'),
      {
        extractor: {
          extract: async ({ sourceHash }) => ({
            bodyText,
            locatorMap: {
              schemaVersion: LOCATOR_SCHEMA_VERSION,
              sourceFormat: 'docx',
              sourceHash,
              offsetEncoding: 'utf16-code-unit',
              physicalPageNumbersAvailable: false,
              blocks,
            },
            toolName: DOCX_EXTRACTOR_TOOL.name,
            toolVersion: DOCX_EXTRACTOR_TOOL.version,
          }),
        },
      },
    );
    await artifactService.processVersion({
      versionId: item.versionId,
      processingProfile: confirmedMetadata.parserProfile,
    });
    const timestamp = new Date().toISOString();
    connection.prepare(`
      UPDATE processing_jobs
      SET status = 'succeeded', updated_at = ?
      WHERE version_id = ? AND stage = 'extraction'
    `).run(timestamp, item.versionId);
    connection.prepare(`
      UPDATE material_versions
      SET workflow_status = 'quality_check', processing_health = 'healthy',
          index_publication_status = 'pending', error_message = NULL, updated_at = ?
      WHERE version_id = ?
    `).run(timestamp, item.versionId);
    connection.prepare(`
      INSERT INTO ragflow_bindings (
        binding_id, version_id, index_generation, dataset_id, document_id,
        remote_status, is_healthy, last_verified_at, created_at, updated_at,
        remote_run_status, chunk_count
      ) VALUES (
        'binding-runtime-quality', ?, 'runtime-quality-v1',
        'dataset-runtime-quality', 'document-runtime-quality',
        'pending', 1, ?, ?, ?, 'DONE', 3
      )
    `).run(item.versionId, timestamp, timestamp, timestamp);
    const version = connection.prepare(`
      SELECT managed_source_path FROM material_versions WHERE version_id = ?
    `).get(item.versionId) as { managed_source_path: string };
    return { databasePath, item, managedSourcePath: version.managed_source_path, service };
  } finally {
    registryDatabase.close();
  }
}

test('PH3-13C1 DOCX 接收、重复幂等、人工确认和重启恢复形成完整本地闭环', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const sourcePath = join(root, '英语讲义.docx');
  const databasePath = join(root, 'knowledge-ingestion', 'registry.sqlite');
  const runtime = new KnowledgeIngestionRuntime(root, { allowTestProcess: true });

  try {
    await createDocx(sourcePath, 'Unit 5 Do you have a soccer ball?');
    assert.equal((await runtime.getStatus()).state, 'ready');
    const service = await runtime.getService();
    const first = await service.intakeFile(sourcePath);
    assert.equal(first.status, 'pending_confirmation');
    assert.equal(first.isDuplicate, false);
    assert.deepEqual(first.lifecycle, {
      workflowStatus: 'pending_confirmation',
      processingHealth: 'pending',
      indexPublicationStatus: 'pending',
      currentStage: null,
      currentJobStatus: null,
      errorMessage: null,
      chunkCount: null,
      autoRetryScheduled: false,
      canCancel: false,
      canRetry: false,
      qualitySummary: {
        status: 'not_started',
        conclusion: null,
        startedAt: null,
        completedAt: null,
        expiresAt: null,
        questionCount: 0,
        results: [],
      },
    });

    const duplicate = await service.intakeFile(sourcePath);
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.versionId, first.versionId);
    assert.notEqual(duplicate.itemId, first.itemId);
    await assert.rejects(
      runtime.retryPublication(duplicate.itemId),
      (error) => assertRegistryError(error, 'INTAKE_STATE_CONFLICT'),
    );

    const confirmed = service.confirmMetadata({ itemId: first.itemId, metadata: confirmedMetadata });
    assert.equal(confirmed.status, 'processing');
    assert.equal(confirmed.lifecycle.workflowStatus, 'processing');
    assert.equal(confirmed.lifecycle.processingHealth, 'processing');
    assert.equal(confirmed.lifecycle.currentStage, 'extraction');
    assert.equal(confirmed.lifecycle.currentJobStatus, 'queued');
    assert.equal(confirmed.lifecycle.canCancel, true);
    rmSync(sourcePath);
    await runtime.close();

    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(Number(database.prepare('SELECT COUNT(*) FROM material_versions').pluck().get()), 1);
      assert.equal(Number(database.prepare('SELECT COUNT(*) FROM intake_items').pluck().get()), 2);
      assert.equal(Number(database.prepare('SELECT COUNT(*) FROM source_occurrences').pluck().get()), 2);
      assert.equal(Number(database.prepare('SELECT COUNT(*) FROM metadata_evidence').pluck().get()), 11);
      assert.equal(Number(database.prepare("SELECT COUNT(*) FROM processing_jobs WHERE stage = 'extraction'").pluck().get()), 1);
      const version = database
        .prepare('SELECT managed_source_path, workflow_status, processing_health FROM material_versions')
        .get() as { managed_source_path: string; workflow_status: string; processing_health: string };
      assert.equal(version.workflow_status, 'processing');
      assert.equal(version.processing_health, 'processing');
      assert.equal(existsSync(version.managed_source_path), true);
      const managedHash = createHash('sha256').update(readFileSync(version.managed_source_path)).digest('hex');
      assert.equal(managedHash, first.contentHash);
      assert.equal(
        Number(database.prepare("SELECT COUNT(*) FROM audit_events WHERE action = 'material_version.metadata_confirmed'").pluck().get()),
        1,
      );
    } finally {
      database.close();
    }

    const restartedRuntime = new KnowledgeIngestionRuntime(root, { allowTestProcess: true });
    try {
      const restartedItems = (await restartedRuntime.getService()).listItems();
      assert.equal(restartedItems.length, 2);
      assert.equal(restartedItems.find((item) => item.itemId === first.itemId)?.status, 'processing');
    } finally {
      await restartedRuntime.close();
    }
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C4 用户显式接收同分支新版，禁止分叉且完全重复只登记来源', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const parentPath = join(root, '已发布讲义.docx');
  const nextPath = join(root, '已发布讲义-修订版.docx');
  const forkPath = join(root, '已发布讲义-分叉版.docx');
  const runtime = new KnowledgeIngestionRuntime(root, { allowTestProcess: true });

  try {
    await createDocx(parentPath, '旧版正文内容');
    const service = await runtime.getService();
    const parent = await service.intakeFile(parentPath);
    service.confirmMetadata({ itemId: parent.itemId, metadata: confirmedMetadata });

    const databasePath = join(root, 'knowledge-ingestion', 'registry.sqlite');
    const timestamp = new Date().toISOString();
    const database = new Database(databasePath);
    try {
      database.prepare(`
        UPDATE processing_jobs
        SET status = 'succeeded', updated_at = ?
        WHERE version_id = ? AND stage = 'extraction'
      `).run(timestamp, parent.versionId);
      database.prepare(`
        UPDATE material_versions
        SET workflow_status = 'published', processing_health = 'healthy',
            index_publication_status = 'active', published_at = ?, updated_at = ?
        WHERE version_id = ?
      `).run(timestamp, timestamp, parent.versionId);
      const identity = database.prepare(`
        SELECT canonical_id, publication_branch_key
        FROM material_versions WHERE version_id = ?
      `).get(parent.versionId) as { canonical_id: string; publication_branch_key: string };
      database.prepare(`
        INSERT INTO ragflow_bindings (
          binding_id, version_id, index_generation, dataset_id, document_id,
          remote_status, is_healthy, last_verified_at, created_at, updated_at,
          remote_run_status, chunk_count
        ) VALUES (
          'binding-c4-parent', ?, 'generation-c4', 'dataset-c4', 'document-c4-parent',
          'active', 1, ?, ?, ?, 'DONE', 5
        )
      `).run(parent.versionId, timestamp, timestamp, timestamp);
      database.prepare(`
        INSERT INTO material_publications (
          publication_id, release_id, canonical_id, publication_branch_key, version_id,
          publication_status, created_at, updated_at
        ) VALUES ('publication-c4-parent', 'release-c4-parent', ?, ?, ?, 'active', ?, ?)
      `).run(
        identity.canonical_id,
        identity.publication_branch_key,
        parent.versionId,
        timestamp,
        timestamp,
      );
    } finally {
      database.close();
    }

    const parentBeforeNextVersion = service.listItems().find((candidate) => candidate.itemId === parent.itemId);
    assert.ok(parentBeforeNextVersion);
    assert.equal(parentBeforeNextVersion.publication.versionLabel, '第 1 版');
    assert.equal(parentBeforeNextVersion.publication.isCurrentVersion, true);
    assert.equal(parentBeforeNextVersion.publication.canReceiveNextVersion, true);
    assert.equal(parentBeforeNextVersion.publication.canRollback, false);

    await createDocx(nextPath, '新版正文内容');
    const next = await service.intakeFileAsNextVersion(parent.itemId, nextPath);
    assert.equal(next.isDuplicate, false);
    assert.equal(next.status, 'pending_confirmation');
    assert.deepEqual(next.metadata, confirmedMetadata);
    assert.equal(next.publication.versionLabel, '第 2 版');
    assert.equal(next.publication.previousVersionLabel, '第 1 版');
    assert.equal(
      service.listItems().find((candidate) => candidate.itemId === parent.itemId)?.publication.canReceiveNextVersion,
      false,
    );

    const verification = new Database(databasePath, { readonly: true });
    try {
      const parentVersion = verification.prepare(`
        SELECT canonical_id, publication_branch_key, version_no
        FROM material_versions WHERE version_id = ?
      `).get(parent.versionId) as {
        canonical_id: string;
        publication_branch_key: string;
        version_no: number;
      };
      const nextVersion = verification.prepare(`
        SELECT canonical_id, publication_branch_key, version_no, previous_version_id,
               workflow_status, processing_health, index_publication_status
        FROM material_versions WHERE version_id = ?
      `).get(next.versionId) as {
        canonical_id: string;
        publication_branch_key: string;
        version_no: number;
        previous_version_id: string;
        workflow_status: string;
        processing_health: string;
        index_publication_status: string;
      };
      assert.equal(nextVersion.canonical_id, parentVersion.canonical_id);
      assert.equal(nextVersion.publication_branch_key, parentVersion.publication_branch_key);
      assert.equal(nextVersion.version_no, parentVersion.version_no + 1);
      assert.equal(nextVersion.previous_version_id, parent.versionId);
      assert.equal(nextVersion.workflow_status, 'pending_confirmation');
      assert.equal(nextVersion.processing_health, 'pending');
      assert.equal(nextVersion.index_publication_status, 'pending');
    } finally {
      verification.close();
    }

    const duplicate = await service.intakeFileAsNextVersion(parent.itemId, nextPath);
    assert.equal(duplicate.isDuplicate, true);
    assert.equal(duplicate.versionId, next.versionId);

    await createDocx(forkPath, '不允许的并行分叉内容');
    await assert.rejects(
      service.intakeFileAsNextVersion(parent.itemId, forkPath),
      (error) => assertRegistryError(error, 'INTAKE_STATE_CONFLICT'),
    );
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C2 生命周期 DTO 安全展示错误，并支持 item 级取消和人工重试', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const sourcePath = join(root, '处理动作讲义.docx');
  const databasePath = join(root, 'knowledge-ingestion', 'registry.sqlite');
  const runtime = new KnowledgeIngestionRuntime(root, { allowTestProcess: true });

  try {
    await createDocx(sourcePath, '用于验证取消、失败和人工重试的正文。');
    const service = await runtime.getService();
    const item = await service.intakeFile(sourcePath);
    const duplicate = await service.intakeFile(sourcePath);
    service.confirmMetadata({ itemId: item.itemId, metadata: confirmedMetadata });

    const database = new Database(databasePath);
    try {
      const timestamp = new Date().toISOString();
      database.prepare(`
        UPDATE processing_jobs
        SET status = 'failed', error_code = 'REMOTE_CONTRACT:METADATA_MISMATCH',
            error_message = '远端文档 document-secret 位于 C:\\secret\\artifact.md',
            next_retry_at = ?, updated_at = ?
        WHERE version_id = ? AND stage = 'extraction'
      `).run(new Date(Date.now() + 60_000).toISOString(), timestamp, item.versionId);
      database.prepare(`
        UPDATE material_versions
        SET workflow_status = 'quarantined', processing_health = 'failed',
            error_message = '底层错误 document-secret', updated_at = ?
        WHERE version_id = ?
      `).run(timestamp, item.versionId);
    } finally {
      database.close();
    }

    const failed = service.listItems().find((candidate) => candidate.itemId === item.itemId);
    assert.ok(failed);
    assert.equal(failed.lifecycle.currentStage, 'extraction');
    assert.equal(failed.lifecycle.currentJobStatus, 'failed');
    assert.equal(failed.lifecycle.workflowStatus, 'quarantined');
    assert.equal(
      failed.lifecycle.errorMessage,
      'RAGFlow 返回结果不符合入库安全合同，请检查服务状态后人工重试。',
    );
    assert.doesNotMatch(failed.lifecycle.errorMessage ?? '', /document-secret|C:\\secret/);
    assert.equal(failed.lifecycle.autoRetryScheduled, true);
    assert.equal(failed.lifecycle.canCancel, true);
    assert.equal(failed.lifecycle.canRetry, true);

    const retried = service.retryProcessing(item.itemId);
    assert.equal(retried.lifecycle.workflowStatus, 'processing');
    assert.equal(retried.lifecycle.processingHealth, 'processing');
    assert.equal(retried.lifecycle.currentJobStatus, 'queued');
    assert.equal(retried.lifecycle.errorMessage, null);
    assert.equal(retried.lifecycle.autoRetryScheduled, false);
    assert.equal(retried.lifecycle.canRetry, false);

    const cancelled = service.cancelProcessing(item.itemId);
    assert.equal(cancelled.lifecycle.currentJobStatus, 'cancelled');
    assert.equal(cancelled.lifecycle.processingHealth, 'failed');
    assert.match(cancelled.lifecycle.errorMessage ?? '', /取消/);
    assert.equal(cancelled.lifecycle.canCancel, false);
    assert.equal(cancelled.lifecycle.canRetry, true);

    service.retryProcessing(item.itemId);
    const runningDatabase = new Database(databasePath);
    try {
      const timestamp = new Date().toISOString();
      runningDatabase.prepare(`
        UPDATE processing_jobs
        SET status = 'running', lease_owner = 'worker-test',
            lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
        WHERE version_id = ? AND stage = 'extraction'
      `).run(new Date(Date.now() + 60_000).toISOString(), timestamp, timestamp, item.versionId);
    } finally {
      runningDatabase.close();
    }
    const cancelRequested = service.cancelProcessing(item.itemId);
    assert.equal(cancelRequested.lifecycle.currentJobStatus, 'cancel_requested');
    assert.equal(cancelRequested.lifecycle.canCancel, false);
    assert.equal(cancelRequested.lifecycle.canRetry, false);

    assert.throws(
      () => service.cancelProcessing(duplicate.itemId),
      (error) => assertRegistryError(error, 'INTAKE_STATE_CONFLICT'),
    );

    const verificationDatabase = new Database(databasePath, { readonly: true });
    try {
      const version = verificationDatabase
        .prepare('SELECT processing_health, error_message FROM material_versions WHERE version_id = ?')
        .get(item.versionId) as { processing_health: string; error_message: string | null };
      assert.equal(version.processing_health, 'processing');
      assert.equal(version.error_message, null);
      assert.equal(
        Number(verificationDatabase.prepare(`
          SELECT COUNT(*) FROM audit_events
          WHERE entity_type = 'processing_job' AND action = 'processing_job.retried_by_user'
        `).pluck().get()),
        2,
      );
    } finally {
      verificationDatabase.close();
    }
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C2 健康 pending 绑定只向 Renderer DTO 提供切片数和质量检查状态', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const sourcePath = join(root, '健康暂存讲义.docx');
  const databasePath = join(root, 'knowledge-ingestion', 'registry.sqlite');
  const runtime = new KnowledgeIngestionRuntime(root, { allowTestProcess: true });

  try {
    await createDocx(sourcePath, '用于验证健康 pending 绑定和切片数量。');
    const service = await runtime.getService();
    const item = await service.intakeFile(sourcePath);
    service.confirmMetadata({ itemId: item.itemId, metadata: confirmedMetadata });

    const database = new Database(databasePath);
    try {
      const timestamp = new Date().toISOString();
      database.prepare(`
        UPDATE processing_jobs
        SET status = 'succeeded', updated_at = ?
        WHERE version_id = ? AND stage = 'extraction'
      `).run(timestamp, item.versionId);
      database.prepare(`
        UPDATE material_versions
        SET workflow_status = 'quality_check', processing_health = 'healthy',
            index_publication_status = 'pending', error_message = NULL, updated_at = ?
        WHERE version_id = ?
      `).run(timestamp, item.versionId);
      database.prepare(`
        INSERT INTO ragflow_bindings (
          binding_id, version_id, index_generation, dataset_id, document_id,
          remote_status, is_healthy, last_verified_at, created_at, updated_at,
          remote_run_status, chunk_count
        ) VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, 'DONE', 7)
      `).run(
        'binding-ui-safe',
        item.versionId,
        'staging-v1',
        'dataset-secret',
        'document-secret',
        timestamp,
        timestamp,
        timestamp,
      );
    } finally {
      database.close();
    }

    const completed = service.listItems().find((candidate) => candidate.itemId === item.itemId);
    assert.ok(completed);
    assert.deepEqual(completed.lifecycle, {
      workflowStatus: 'quality_check',
      processingHealth: 'healthy',
      indexPublicationStatus: 'pending',
      currentStage: 'quality_check',
      currentJobStatus: null,
      errorMessage: null,
      chunkCount: 7,
      autoRetryScheduled: false,
      canCancel: false,
      canRetry: false,
      qualitySummary: {
        status: 'not_started',
        conclusion: null,
        startedAt: null,
        completedAt: null,
        expiresAt: null,
        questionCount: 0,
        results: [],
      },
    });
    const rendererPayload = JSON.stringify(completed);
    assert.doesNotMatch(rendererPayload, /dataset-secret|document-secret|binding-ui-safe|managed_source_path/);

    const verificationDatabase = new Database(databasePath, { readonly: true });
    try {
      assert.equal(Number(verificationDatabase.prepare('SELECT COUNT(*) FROM material_publications').pluck().get()), 0);
    } finally {
      verificationDatabase.close();
    }
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C3 排队质量任务取消会原子收口运行并保留完整审计', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const sourcePath = join(root, '待取消质量检查.docx');
  const databasePath = join(root, 'knowledge-ingestion', 'registry.sqlite');
  const runtime = new KnowledgeIngestionRuntime(root, { allowTestProcess: true });

  try {
    await createDocx(sourcePath, '用于验证排队质量任务的取消审计。');
    const service = await runtime.getService();
    const item = await service.intakeFile(sourcePath);
    service.confirmMetadata({ itemId: item.itemId, metadata: confirmedMetadata });

    const database = new Database(databasePath);
    try {
      const timestamp = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      database.prepare(`
        UPDATE processing_jobs
        SET status = 'succeeded', updated_at = ?
        WHERE version_id = ? AND stage = 'extraction'
      `).run(timestamp, item.versionId);
      database.prepare(`
        UPDATE material_versions
        SET workflow_status = 'quality_check', processing_health = 'healthy',
            index_publication_status = 'pending', error_message = NULL, updated_at = ?
        WHERE version_id = ?
      `).run(timestamp, item.versionId);
      database.prepare(`
        INSERT INTO ragflow_bindings (
          binding_id, version_id, index_generation, dataset_id, document_id,
          remote_status, is_healthy, last_verified_at, created_at, updated_at,
          remote_run_status, chunk_count
        ) VALUES (?, ?, 'staging-v1', 'dataset-quality', 'document-quality',
          'pending', 1, ?, ?, ?, 'DONE', 3)
      `).run('binding-quality-cancel', item.versionId, timestamp, timestamp, timestamp);
      database.prepare(`
        INSERT INTO processing_jobs (
          job_id, version_id, stage, status, input_hash, profile_version,
          attempt_count, max_attempts, created_at, updated_at
        ) VALUES ('job-quality-cancel', ?, 'quality', 'queued', 'quality-input', ?, 0, 3, ?, ?)
      `).run(item.versionId, confirmedMetadata.parserProfile, timestamp, timestamp);
      database.prepare(`
        INSERT INTO quality_runs (
          quality_run_id, version_id, job_id, binding_id, status, conclusion,
          binding_snapshot_json, questions_snapshot_json, input_snapshot_json,
          profile_snapshot_json, config_snapshot_json, expires_at,
          created_at, updated_at
        ) VALUES (
          'quality-run-cancel', ?, 'job-quality-cancel', 'binding-quality-cancel',
          'queued', NULL, '{}', '[]', '{}', '{}', '{}', ?, ?, ?
        )
      `).run(item.versionId, expiresAt, timestamp, timestamp);
    } finally {
      database.close();
    }

    const cancelled = service.cancelProcessing(item.itemId);
    assert.equal(cancelled.lifecycle.currentStage, 'quality_check');
    assert.equal(cancelled.lifecycle.currentJobStatus, 'cancelled');
    assert.equal(cancelled.lifecycle.qualitySummary.status, 'cancelled');
    assert.match(cancelled.lifecycle.qualitySummary.conclusion ?? '', /取消/);
    assert.equal(cancelled.lifecycle.workflowStatus, 'quality_check');
    assert.equal(cancelled.lifecycle.indexPublicationStatus, 'pending');

    const verificationDatabase = new Database(databasePath, { readonly: true });
    try {
      const run = verificationDatabase.prepare(`
        SELECT status, conclusion, completed_at
        FROM quality_runs WHERE quality_run_id = 'quality-run-cancel'
      `).get() as { status: string; conclusion: string | null; completed_at: string | null };
      assert.deepEqual(
        { status: run.status, conclusion: run.conclusion },
        { status: 'cancelled', conclusion: 'cancelled' },
      );
      assert.ok(run.completed_at);
      assert.equal(Number(verificationDatabase.prepare(`
        SELECT COUNT(*) FROM audit_events
        WHERE entity_type = 'processing_job'
          AND entity_id = 'job-quality-cancel'
          AND action = 'processing_job.cancelled'
      `).pluck().get()), 1);
      assert.equal(Number(verificationDatabase.prepare(`
        SELECT COUNT(*) FROM audit_events
        WHERE entity_type = 'quality_run'
          AND entity_id = 'quality-run-cancel'
          AND action = 'quality_run.cancelled'
      `).pluck().get()), 1);
      assert.equal(Number(verificationDatabase.prepare('SELECT COUNT(*) FROM material_publications').pluck().get()), 0);
    } finally {
      verificationDatabase.close();
    }
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C3 Runtime 创建质量运行、锁定配置身份并只返回安全 DTO', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const runtime = new KnowledgeIngestionRuntime(root, {
    allowTestProcess: true,
    credentialCipher: testCredentialCipher,
  });

  try {
    const prepared = await prepareRuntimeQualityItem(root, runtime);
    const started = await runtime.startQualityCheck({
      itemId: prepared.item.itemId,
    });
    assert.equal(started.lifecycle.currentStage, 'quality_check');
    assert.equal(started.lifecycle.currentJobStatus, 'queued');
    assert.equal(started.lifecycle.qualitySummary.status, 'queued');
    assert.equal(started.lifecycle.qualitySummary.questionCount, 1);
    assert.equal(started.lifecycle.canCancel, true);

    const database = new Database(prepared.databasePath, { readonly: true });
    let internal: {
      quality_run_id: string;
      job_id: string;
      binding_id: string;
      dataset_id: string;
      document_id: string;
      run_status: string;
      job_status: string;
    };
    try {
      internal = database.prepare(`
        SELECT quality.quality_run_id, quality.job_id, quality.binding_id,
               binding.dataset_id, binding.document_id,
               quality.status AS run_status, job.status AS job_status
        FROM quality_runs quality
        JOIN processing_jobs job ON job.job_id = quality.job_id
        JOIN ragflow_bindings binding ON binding.binding_id = quality.binding_id
        WHERE quality.version_id = ?
      `).get(prepared.item.versionId) as typeof internal;
    } finally {
      database.close();
    }
    assert.equal(internal.run_status, 'queued');
    assert.equal(internal.job_status, 'queued');
    const rendererPayload = JSON.stringify(started);
    for (const secret of [
      internal.quality_run_id,
      internal.job_id,
      internal.binding_id,
      internal.dataset_id,
      internal.document_id,
      prepared.managedSourcePath,
    ]) {
      assert.equal(rendererPayload.includes(secret), false, `Renderer DTO 不应包含内部值：${secret}`);
    }

    const runningAt = new Date().toISOString();
    const runningLease = new Date(Date.now() + 60_000).toISOString();
    const runningDatabase = new Database(prepared.databasePath);
    try {
      runningDatabase.transaction(() => {
        runningDatabase.prepare(`
          UPDATE processing_jobs
          SET status = 'running', attempt_count = 1, lease_owner = 'worker-runtime-quality',
              lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
          WHERE job_id = ?
        `).run(runningLease, runningAt, runningAt, internal.job_id);
        runningDatabase.prepare(`
          UPDATE quality_runs
          SET status = 'running', started_at = ?, updated_at = ?
          WHERE quality_run_id = ?
        `).run(runningAt, runningAt, internal.quality_run_id);
      })();
    } finally {
      runningDatabase.close();
    }
    const running = prepared.service.listItems().find((candidate) => candidate.itemId === prepared.item.itemId);
    assert.ok(running);
    assert.equal(running.lifecycle.currentJobStatus, 'running');
    assert.equal(running.lifecycle.qualitySummary.status, 'running');

    await assert.rejects(
      runtime.saveRagflowConfig({
        baseUrl: 'http://127.0.0.1:9380',
        apiKey: 'rotated-key',
        stagingDatasetId: 'dataset-runtime-other',
        indexGeneration: 'runtime-quality-v2',
      }),
      (error) => assertRegistryError(error, 'REMOTE_AUTH_CONFIG'),
    );
    const sameIdentity = await runtime.saveRagflowConfig({
      baseUrl: 'http://127.0.0.1:9380',
      apiKey: 'rotated-key',
      stagingDatasetId: 'dataset-runtime-quality',
      indexGeneration: 'runtime-quality-v1',
    });
    assert.equal(sameIdentity.configured, true);

    const secretError = 'document-secret 位于 C:\\secret\\quality.log';
    const secretEvidence = 'binding-secret 位于 C:\\secret\\quality-result.log';
    const failedAt = new Date().toISOString();
    const writableDatabase = new Database(prepared.databasePath);
    try {
      writableDatabase.transaction(() => {
        writableDatabase.prepare(`
          UPDATE processing_jobs
          SET status = 'failed', error_code = 'REMOTE_CONTRACT', error_message = ?,
              next_retry_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = NULL, updated_at = ?
          WHERE job_id = ?
        `).run(secretError, failedAt, internal.job_id);
        writableDatabase.prepare(`
          UPDATE quality_runs
          SET status = 'failed', conclusion = 'technical_failure', completed_at = ?,
              error_code = 'REMOTE_CONTRACT', error_message = ?, updated_at = ?
          WHERE quality_run_id = ?
        `).run(failedAt, secretError, failedAt, internal.quality_run_id);
        writableDatabase.prepare(`
          INSERT INTO quality_results (
            quality_result_id, quality_run_id, check_key, result_key, blocking_level,
            passed, threshold_json, actual_json, evidence_json, created_at, updated_at
          ) VALUES (?, ?, 'metadata', 'metadata', 'blocking', 0, '{}', '{}', ?, ?, ?)
        `).run(
          'quality-result-renderer-safe',
          internal.quality_run_id,
          JSON.stringify({
            label: secretEvidence,
            message: secretEvidence,
            locatorLabel: secretEvidence,
          }),
          failedAt,
          failedAt,
        );
      })();
    } finally {
      writableDatabase.close();
    }

    const failed = prepared.service.listItems().find((candidate) => candidate.itemId === prepared.item.itemId);
    assert.ok(failed);
    assert.equal(failed.lifecycle.currentJobStatus, 'failed');
    assert.equal(failed.lifecycle.qualitySummary.status, 'failed');
    assert.equal(failed.lifecycle.qualitySummary.conclusion, '质量检查运行失败，未进入待发布。');
    assert.equal(failed.lifecycle.canCancel, false);
    assert.equal(failed.lifecycle.canRetry, false);
    assert.equal(JSON.stringify(failed).includes(secretError), false);
    assert.equal(JSON.stringify(failed).includes(secretEvidence), false);
    assert.equal(failed.lifecycle.qualitySummary.results[0]?.label, '必填元数据完整');

    const restarted = await runtime.startQualityCheck({
      itemId: prepared.item.itemId,
    });
    assert.equal(restarted.lifecycle.currentJobStatus, 'queued');
    const cancelledAgain = prepared.service.cancelProcessing(prepared.item.itemId);
    assert.equal(cancelledAgain.lifecycle.currentJobStatus, 'cancelled');
    assert.equal(cancelledAgain.lifecycle.qualitySummary.status, 'cancelled');
    assert.equal(cancelledAgain.lifecycle.errorMessage, null);
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C4 待发布质量结论到期后安全映射为过期并可重新排队', async () => {
  const { root, cleanup } = withTemporaryRoot();
  let nowMs = Date.parse('2026-07-11T08:00:00.000Z');
  const now = () => new Date(nowMs);
  const runtime = new KnowledgeIngestionRuntime(root, {
    allowTestProcess: true,
    credentialCipher: testCredentialCipher,
    now,
  });

  try {
    const prepared = await prepareRuntimeQualityItem(root, runtime);
    await runtime.startQualityCheck({
      itemId: prepared.item.itemId,
    });
    let firstExpiresAt = '';
    const database = new Database(prepared.databasePath);
    const registry = new RegistryDatabase(database, prepared.databasePath, null);
    try {
      const registryStore = new RegistryStore(registry, { now });
      const qualityRepository = new QualityGateRepository(registry, { now });
      const run = qualityRepository.getLatestRunForVersion(prepared.item.versionId);
      assert.ok(run);
      firstExpiresAt = run.expiresAt;
      const workerId = 'worker-quality-expiry-runtime';
      const claimed = registryStore.claimNextJob({
        workerId,
        leaseDurationMs: 60_000,
        stages: ['quality'],
        audit: { actorId: 'test:quality-expiry', reason: '领取待过期质量任务。' },
      });
      assert.equal(claimed?.jobId, run.jobId);
      qualityRepository.startRun({
        qualityRunId: run.qualityRunId,
        workerId,
        audit: { actorId: 'test:quality-expiry', reason: '开始待过期质量任务。' },
      });
      for (const [index, resultKey] of run.inputSnapshot.requiredBlockingResultKeys.entries()) {
        qualityRepository.recordResult({
          qualityRunId: run.qualityRunId,
          workerId,
          checkKey: `quality-expiry-${index + 1}`,
          resultKey,
          blockingLevel: 'blocking',
          passed: true,
          threshold: { required: true },
          actual: { passed: true },
          evidence: { message: '到期重检测试结论已通过。' },
          audit: { actorId: 'test:quality-expiry', reason: '记录待过期质量结论。' },
        });
      }
      qualityRepository.finalizePassed({
        qualityRunId: run.qualityRunId,
        workerId,
        audit: { actorId: 'test:quality-expiry', reason: '完成待过期质量结论。' },
      });
    } finally {
      registry.close();
    }

    nowMs = Date.parse(firstExpiresAt);
    const expired = prepared.service.listItems()
      .find((candidate) => candidate.itemId === prepared.item.itemId);
    assert.ok(expired);
    assert.equal(expired.lifecycle.workflowStatus, 'pending_publication');
    assert.equal(expired.lifecycle.qualitySummary.status, 'expired');
    assert.equal(expired.lifecycle.qualitySummary.expiresAt, firstExpiresAt);
    assert.equal(expired.publication.canPublish, false);

    const restarted = await runtime.startQualityCheck({
      itemId: prepared.item.itemId,
    });
    assert.equal(restarted.lifecycle.workflowStatus, 'quality_check');
    assert.equal(restarted.lifecycle.qualitySummary.status, 'queued');
    assert.ok(restarted.lifecycle.qualitySummary.expiresAt);
    assert.ok(restarted.lifecycle.qualitySummary.expiresAt > firstExpiresAt);

    const verification = new Database(prepared.databasePath, { readonly: true });
    try {
      assert.equal(
        Number(verification.prepare('SELECT COUNT(*) FROM quality_runs WHERE version_id = ?').pluck().get(prepared.item.versionId)),
        2,
      );
      assert.equal(
        Number(verification.prepare(
          "SELECT COUNT(*) FROM audit_events WHERE action = 'material_version.expired_quality_reopened'",
        ).pluck().get()),
        1,
      );
    } finally {
      verification.close();
    }
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C3 配置保存与质量启动串行，运行快照不会落在旧身份', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const runtime = new KnowledgeIngestionRuntime(root, {
    allowTestProcess: true,
    credentialCipher: testCredentialCipher,
  });
  let releaseSave: () => void = () => undefined;

  try {
    const prepared = await prepareRuntimeQualityItem(root, runtime);
    type SaveConfig = KnowledgeIngestionRuntime['saveRagflowConfig'];
    const internals = runtime as unknown as {
      ragflowConfigStore: { save: SaveConfig };
    };
    const originalSave = internals.ragflowConfigStore.save.bind(internals.ragflowConfigStore);
    let notifySaveEntered: (() => void) | null = null;
    const saveEntered = new Promise<void>((resolve) => {
      notifySaveEntered = resolve;
    });
    const saveReleased = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    internals.ragflowConfigStore.save = async (input) => {
      notifySaveEntered?.();
      await saveReleased;
      return originalSave(input);
    };

    const saving = runtime.saveRagflowConfig({
      baseUrl: 'http://127.0.0.1:9380',
      apiKey: 'runtime-quality-key-v2',
      stagingDatasetId: 'dataset-runtime-quality-v2',
      indexGeneration: 'runtime-quality-v2',
    });
    await saveEntered;

    let startSettled = false;
    const starting = runtime.startQualityCheck({
      itemId: prepared.item.itemId,
    });
    void starting.then(
      () => { startSettled = true; },
      () => { startSettled = true; },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledWhileSavePaused = startSettled;

    releaseSave();
    releaseSave = () => undefined;
    const saved = await saving;
    await assert.rejects(
      starting,
      (error) => assertRegistryError(error, 'REMOTE_AUTH_CONFIG'),
    );
    internals.ragflowConfigStore.save = originalSave;

    assert.equal(settledWhileSavePaused, false);
    assert.equal(saved.stagingDatasetId, 'dataset-runtime-quality-v2');

    const database = new Database(prepared.databasePath, { readonly: true });
    try {
      assert.equal(Number(database.prepare(`
        SELECT COUNT(*)
        FROM quality_runs
        WHERE version_id = ?
      `).pluck().get(prepared.item.versionId)), 0);
    } finally {
      database.close();
    }
  } finally {
    releaseSave();
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C4 配置切换并重启后仍保护历史 active 与 superseded 数据集', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const runtime = new KnowledgeIngestionRuntime(root, {
    allowTestProcess: true,
    credentialCipher: testCredentialCipher,
  });
  let restartedRuntime: KnowledgeIngestionRuntime | null = null;

  try {
    const prepared = await prepareRuntimeQualityItem(root, runtime);
    const switched = await runtime.saveRagflowConfig({
      baseUrl: 'http://127.0.0.1:9380',
      apiKey: 'runtime-quality-key-v2',
      stagingDatasetId: 'dataset-runtime-quality-v2',
      indexGeneration: 'runtime-quality-v2',
    });
    assert.equal(switched.stagingDatasetId, 'dataset-runtime-quality-v2');

    const timestamp = new Date().toISOString();
    const database = new Database(prepared.databasePath);
    try {
      database.prepare(`
        UPDATE ragflow_bindings
        SET remote_status = 'active', updated_at = ?
        WHERE binding_id = 'binding-runtime-quality'
      `).run(timestamp);
      database.prepare(`
        INSERT INTO ragflow_bindings (
          binding_id, version_id, index_generation, dataset_id, document_id,
          remote_status, is_healthy, last_verified_at, created_at, updated_at,
          remote_run_status, chunk_count
        ) VALUES (
          'binding-runtime-superseded', ?, 'runtime-quality-v0',
          'dataset-runtime-superseded', 'document-runtime-superseded',
          'superseded', 1, ?, ?, ?, 'DONE', 3
        )
      `).run(prepared.item.versionId, timestamp, timestamp, timestamp);
    } finally {
      database.close();
    }
    await runtime.close();

    restartedRuntime = new KnowledgeIngestionRuntime(root, {
      allowTestProcess: true,
      credentialCipher: testCredentialCipher,
    });
    const protectedDatasetIds = await restartedRuntime.getProtectedRagflowDatasetIds();
    assert.deepEqual(
      new Set(protectedDatasetIds),
      new Set([
        'dataset-runtime-quality',
        'dataset-runtime-superseded',
        'dataset-runtime-quality-v2',
      ]),
    );
    for (const datasetId of ['dataset-runtime-quality', 'dataset-runtime-superseded']) {
      const decision = guardProtectedRagflowDatasetRequest(
        {
          url: 'http://127.0.0.1:9380/api/v1/retrieval',
          body: { dataset_ids: [datasetId], question: '正式检索' },
        },
        protectedDatasetIds,
      );
      assert.equal(decision.allow, false);
    }
  } finally {
    await restartedRuntime?.close();
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C1 基础 PDF 可接收，加密 PDF 与损坏文件失败时不留下登记半成品', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const validPdfPath = join(root, '基础资料.pdf');
  const encryptedPdfPath = join(root, '加密资料.pdf');
  const invalidDocxPath = join(root, '伪造资料.docx');
  const emptyPdfPath = join(root, '空资料.pdf');
  const runtime = new KnowledgeIngestionRuntime(root, { allowTestProcess: true });

  try {
    createPdf(validPdfPath);
    createPdf(encryptedPdfPath, true);
    writeFileSync(invalidDocxPath, 'not-a-docx');
    writeFileSync(emptyPdfPath, '');
    const service = await runtime.getService();
    const valid = await service.intakeFile(validPdfPath);
    assert.equal(valid.extension, '.pdf');

    await assert.rejects(
      service.intakeFile(encryptedPdfPath),
      (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
    );
    await assert.rejects(
      service.intakeFile(invalidDocxPath),
      (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
    );
    await assert.rejects(
      service.intakeFile(emptyPdfPath),
      (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
    );

    await runtime.close();
    const database = new Database(join(root, 'knowledge-ingestion', 'registry.sqlite'), { readonly: true });
    try {
      assert.equal(Number(database.prepare('SELECT COUNT(*) FROM material_versions').pluck().get()), 1);
      assert.equal(Number(database.prepare('SELECT COUNT(*) FROM intake_items').pluck().get()), 1);
      assert.equal(Number(database.prepare("SELECT COUNT(*) FROM intake_batches WHERE status = 'failed'").pluck().get()), 0);
    } finally {
      database.close();
    }
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C1 元数据和 IPC 非法载荷在进入数据库前被拒绝', async () => {
  assert.throws(
    () => parseKnowledgeIngestionConfirmPayload({ itemId: 'item-1', metadata: { stableTitle: '缺字段' } }),
    (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
  );
  assert.throws(
    () => parseKnowledgeIngestionConfirmPayload({ itemId: '', metadata: confirmedMetadata }),
    (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
  );

  const parsed = parseKnowledgeIngestionConfirmPayload({
    itemId: ' intake-1 ',
    metadata: confirmedMetadata,
  });
  assert.equal(parsed.itemId, 'intake-1');
  assert.deepEqual(parsed.metadata, confirmedMetadata);

  assert.deepEqual(
    parseKnowledgeIngestionItemActionPayload({ itemId: ' intake-2 ' }),
    { itemId: 'intake-2' },
  );
  assert.throws(
    () => parseKnowledgeIngestionItemActionPayload({
      itemId: 'intake-2',
      jobId: 'job-secret',
      datasetId: 'dataset-secret',
    }),
    (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
  );
  assert.throws(
    () => parseKnowledgeIngestionItemActionPayload({ itemId: '' }),
    (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
  );
  assert.throws(
    () => parseKnowledgeIngestionRagflowConfigPayload({
      baseUrl: 'http://127.0.0.1:9380',
      apiKey: 'secret',
      stagingDatasetId: 'dataset-stage',
      indexGeneration: 'staging-v1',
      documentId: 'document-secret',
    }),
    (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
  );
});

test('PH3-13C1 登记库故障只返回中文不可用状态，不阻断普通应用启动', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const occupiedPath = join(root, 'occupied');
  writeFileSync(occupiedPath, 'not-a-directory');
  const runtime = new KnowledgeIngestionRuntime(occupiedPath, { allowTestProcess: true });

  try {
    const status = await runtime.getStatus();
    assert.equal(status.state, 'unavailable');
    assert.match(status.message, /资料登记库初始化失败/);
    assert.equal(status.schemaVersion, null);
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C2 Runtime 关闭会等待并发初始化，且重复关闭保持幂等', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const runtime = new KnowledgeIngestionRuntime(root, { allowTestProcess: true });
  try {
    const starting = runtime.start();
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await Promise.allSettled([starting, closing]);

    const status = await runtime.getStatus();
    assert.equal(status.state, 'unavailable');
    assert.match(status.message, /关闭/);

    // close 返回后 SQLite 已释放，可由独立只读连接重新打开。
    const database = new Database(join(root, 'knowledge-ingestion', 'registry.sqlite'), { readonly: true });
    try {
      assert.equal(
        Number(database.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()),
        REGISTRY_SCHEMA_VERSION,
      );
    } finally {
      database.close();
    }
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C2 未完成远端工作会锁定配置身份，但允许同身份更新密钥', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const sourcePath = join(root, '配置身份锁讲义.docx');
  const databasePath = join(root, 'knowledge-ingestion', 'registry.sqlite');
  const runtime = new KnowledgeIngestionRuntime(root, {
    allowTestProcess: true,
    credentialCipher: testCredentialCipher,
  });
  try {
    await runtime.saveRagflowConfig({
      baseUrl: 'http://127.0.0.1:9380',
      apiKey: 'first-key',
      stagingDatasetId: 'dataset-stage-a',
      indexGeneration: 'staging-v1',
    });
    await createDocx(sourcePath, '用于验证远端配置身份锁。');
    const service = await runtime.getService();
    const item = await service.intakeFile(sourcePath);
    service.confirmMetadata({ itemId: item.itemId, metadata: confirmedMetadata });

    const database = new Database(databasePath);
    try {
      const timestamp = new Date().toISOString();
      database.prepare(`
        INSERT INTO ragflow_bindings (
          binding_id, version_id, index_generation, dataset_id, document_id,
          remote_status, is_healthy, last_verified_at, created_at, updated_at,
          remote_run_status, chunk_count
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, NULL, NULL)
      `).run(
        'binding-config-lock',
        item.versionId,
        'staging-v1',
        'dataset-stage-a',
        'document-stage-a',
        timestamp,
        timestamp,
      );
    } finally {
      database.close();
    }

    await assert.rejects(
      runtime.saveRagflowConfig({
        baseUrl: 'http://127.0.0.1:9380',
        apiKey: 'second-key',
        stagingDatasetId: 'dataset-stage-b',
        indexGeneration: 'staging-v2',
      }),
      (error) => assertRegistryError(error, 'REMOTE_AUTH_CONFIG'),
    );
    const updated = await runtime.saveRagflowConfig({
      baseUrl: 'http://127.0.0.1:9380',
      apiKey: 'second-key',
      stagingDatasetId: 'dataset-stage-a',
      indexGeneration: 'staging-v1',
    });
    assert.equal(updated.configured, true);
    assert.equal(updated.stagingDatasetId, 'dataset-stage-a');
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C4 active 或 superseded 发布历史锁定远端身份但允许轮换密钥', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const runtime = new KnowledgeIngestionRuntime(root, {
    allowTestProcess: true,
    credentialCipher: testCredentialCipher,
  });

  try {
    const prepared = await prepareRuntimeQualityItem(root, runtime);
    await runtime.startQualityCheck({
      itemId: prepared.item.itemId,
    });
    const database = new Database(prepared.databasePath);
    try {
      const timestamp = new Date().toISOString();
      // 质量运行由 Runtime 正常创建，以下只模拟远端已完成后的持久结果，保留不可变配置快照。
      database.prepare(`
        UPDATE processing_jobs
        SET status = 'succeeded', updated_at = ?
        WHERE version_id = ? AND stage = 'quality'
      `).run(timestamp, prepared.item.versionId);
      database.prepare(`
        UPDATE quality_runs
        SET status = 'passed', conclusion = 'passed', started_at = ?, completed_at = ?, updated_at = ?
        WHERE version_id = ?
      `).run(timestamp, timestamp, timestamp, prepared.item.versionId);
      database.prepare(`
        UPDATE ragflow_bindings
        SET remote_status = 'active', updated_at = ?
        WHERE binding_id = 'binding-runtime-quality'
      `).run(timestamp);
      database.prepare(`
        UPDATE material_versions
        SET workflow_status = 'published', processing_health = 'healthy',
            index_publication_status = 'active', published_at = ?, updated_at = ?
        WHERE version_id = ?
      `).run(timestamp, timestamp, prepared.item.versionId);
      database.prepare(`
        INSERT INTO material_publications (
          publication_id, release_id, canonical_id, publication_branch_key, version_id,
          publication_status, created_at, updated_at
        )
        SELECT 'publication-runtime-quality', 'release-runtime-quality',
               canonical_id, publication_branch_key, version_id, 'active', ?, ?
        FROM material_versions WHERE version_id = ?
      `).run(timestamp, timestamp, prepared.item.versionId);
    } finally {
      database.close();
    }

    const identityChanges = [
      {
        baseUrl: 'http://127.0.0.1:9381',
        stagingDatasetId: 'dataset-runtime-quality',
        indexGeneration: 'runtime-quality-v1',
      },
      {
        baseUrl: 'http://127.0.0.1:9380',
        stagingDatasetId: 'dataset-runtime-other',
        indexGeneration: 'runtime-quality-v1',
      },
      {
        baseUrl: 'http://127.0.0.1:9380',
        stagingDatasetId: 'dataset-runtime-quality',
        indexGeneration: 'runtime-quality-v2',
      },
    ];
    for (const identity of identityChanges) {
      await assert.rejects(
        runtime.saveRagflowConfig({
          ...identity,
          apiKey: 'rotated-key',
        }),
        (error) => error instanceof RegistryError
          && error.code === 'REMOTE_AUTH_CONFIG'
          && /发布历史/.test(error.message),
      );
    }

    const supersededDatabase = new Database(prepared.databasePath);
    try {
      supersededDatabase.prepare(`
        UPDATE ragflow_bindings
        SET remote_status = 'superseded', updated_at = ?
        WHERE binding_id = 'binding-runtime-quality'
      `).run(new Date().toISOString());
    } finally {
      supersededDatabase.close();
    }
    await assert.rejects(
      runtime.saveRagflowConfig({
        baseUrl: 'http://127.0.0.1:9380',
        apiKey: 'rotated-key',
        stagingDatasetId: 'dataset-runtime-other',
        indexGeneration: 'runtime-quality-v1',
      }),
      (error) => error instanceof RegistryError
        && error.code === 'REMOTE_AUTH_CONFIG'
        && /发布历史/.test(error.message),
    );

    const rotated = await runtime.saveRagflowConfig({
      baseUrl: 'HTTP://127.0.0.1:9380/',
      apiKey: 'rotated-key',
      stagingDatasetId: 'dataset-runtime-quality',
      indexGeneration: 'runtime-quality-v1',
    });
    assert.equal(rotated.configured, true);
    assert.equal(rotated.stagingDatasetId, 'dataset-runtime-quality');
    assert.equal(rotated.indexGeneration, 'runtime-quality-v1');

    const internals = runtime as unknown as {
      ragflowConfigStore: {
        save: (input: {
          baseUrl: string;
          apiKey: string;
          stagingDatasetId: string;
          indexGeneration: string;
        }) => Promise<unknown>;
      };
    };
    // 模拟配置文件被外部错误覆盖，Runtime 必须先以历史快照拒绝该不一致状态。
    await internals.ragflowConfigStore.save({
      baseUrl: 'http://127.0.0.1:9380',
      apiKey: 'incorrect-key',
      stagingDatasetId: 'dataset-runtime-other',
      indexGeneration: 'runtime-quality-v1',
    });
    await assert.rejects(
      runtime.saveRagflowConfig({
        baseUrl: 'http://127.0.0.1:9380',
        apiKey: 'rotated-key',
        stagingDatasetId: 'dataset-runtime-quality',
        indexGeneration: 'runtime-quality-v1',
      }),
      (error) => assertRegistryError(error, 'REMOTE_AUTH_CONFIG'),
    );

    rmSync(join(root, 'knowledge-ingestion', 'ragflow-ingestion.json'), { force: true });
    assert.equal((await runtime.getRagflowConfigStatus()).configured, false);
    await assert.rejects(
      runtime.saveRagflowConfig({
        baseUrl: 'http://127.0.0.1:9480',
        apiKey: 'replacement-key',
        stagingDatasetId: 'dataset-after-config-loss',
        indexGeneration: 'runtime-quality-after-loss',
      }),
      (error) => error instanceof RegistryError
        && error.code === 'REMOTE_AUTH_CONFIG'
        && /发布历史/.test(error.message),
    );
    const recovered = await runtime.saveRagflowConfig({
      baseUrl: 'HTTP://127.0.0.1:9380/',
      apiKey: 'replacement-key',
      stagingDatasetId: 'dataset-runtime-quality',
      indexGeneration: 'runtime-quality-v1',
    });
    assert.equal(recovered.baseUrl, 'http://127.0.0.1:9380');
    assert.equal(recovered.stagingDatasetId, 'dataset-runtime-quality');

    const corruptSnapshotDatabase = new Database(prepared.databasePath);
    try {
      // 一条相关快照缺字段时，不能借助其他历史记录猜测远端身份。
      corruptSnapshotDatabase.prepare(`
        UPDATE quality_runs SET config_snapshot_json = '{}' WHERE version_id = ?
      `).run(prepared.item.versionId);
    } finally {
      corruptSnapshotDatabase.close();
    }
    await assert.rejects(
      runtime.saveRagflowConfig({
        baseUrl: 'http://127.0.0.1:9380',
        apiKey: 'replacement-key',
        stagingDatasetId: 'dataset-runtime-quality',
        indexGeneration: 'runtime-quality-v1',
      }),
      (error) => assertRegistryError(error, 'REMOTE_AUTH_CONFIG'),
    );
  } finally {
    await runtime.close();
    cleanup();
  }
});

test('PH3-13C4 抽取、上传或解析任务未完成时锁定身份，显式取消后才允许切换', async () => {
  for (const stage of ['extraction', 'upload', 'parse_wait'] as const) {
    for (const status of ['queued', 'failed'] as const) {
      const { root, cleanup } = withTemporaryRoot();
      const runtime = new KnowledgeIngestionRuntime(root, {
        allowTestProcess: true,
        credentialCipher: testCredentialCipher,
      });
      try {
        await runtime.saveRagflowConfig({
          baseUrl: 'http://127.0.0.1:9380',
          apiKey: 'first-key',
          stagingDatasetId: 'dataset-stage-a',
          indexGeneration: 'staging-v1',
        });
        const sourcePath = join(root, `${stage}-${status}-配置锁.docx`);
        await createDocx(sourcePath, '用于验证抽取、上传和解析任务的配置身份锁。');
        const service = await runtime.getService();
        const item = await service.intakeFile(sourcePath);
        service.confirmMetadata({ itemId: item.itemId, metadata: confirmedMetadata });

        const database = new Database(join(root, 'knowledge-ingestion', 'registry.sqlite'));
        try {
          database.prepare(`
            UPDATE processing_jobs
            SET stage = ?, status = ?, updated_at = ?
            WHERE version_id = ? AND stage = 'extraction'
          `).run(stage, status, new Date().toISOString(), item.versionId);
        } finally {
          database.close();
        }

        await assert.rejects(
          runtime.saveRagflowConfig({
            baseUrl: 'http://127.0.0.1:9381',
            apiKey: 'second-key',
            stagingDatasetId: 'dataset-stage-b',
            indexGeneration: 'staging-v2',
          }),
          (error) => assertRegistryError(error, 'REMOTE_AUTH_CONFIG'),
          `${stage}/${status} 必须锁定远端身份`,
        );
        const cancelled = service.cancelProcessing(item.itemId);
        assert.equal(cancelled.lifecycle.currentJobStatus, 'cancelled');
        const switched = await runtime.saveRagflowConfig({
          baseUrl: 'http://127.0.0.1:9381',
          apiKey: 'second-key',
          stagingDatasetId: 'dataset-stage-b',
          indexGeneration: 'staging-v2',
        });
        assert.equal(switched.stagingDatasetId, 'dataset-stage-b');
      } finally {
        await runtime.close();
        cleanup();
      }
    }
  }
});

test('PH3-13C4 发布摘要与 publication job 独立于处理 DTO，且不泄漏内部身份', async () => {
  const { root, cleanup } = withTemporaryRoot();
  const runtime = new KnowledgeIngestionRuntime(root, {
    allowTestProcess: true,
    credentialCipher: testCredentialCipher,
  });

  try {
    const prepared = await prepareRuntimeQualityItem(root, runtime);
    await runtime.startQualityCheck({
      itemId: prepared.item.itemId,
    });

    const database = new Database(prepared.databasePath);
    const registry = new RegistryDatabase(database, prepared.databasePath, null);
    try {
      const registryStore = new RegistryStore(registry);
      const qualityRepository = new QualityGateRepository(registry);
      const run = qualityRepository.getLatestRunForVersion(prepared.item.versionId);
      assert.ok(run);
      const workerId = 'worker-publication-dto';
      const claimed = registryStore.claimNextJob({
        workerId,
        leaseDurationMs: 60_000,
        stages: ['quality'],
        audit: { actorId: 'test:publication-dto', reason: '准备发布摘要测试质量结论。' },
      });
      assert.equal(claimed?.jobId, run.jobId);
      qualityRepository.startRun({
        qualityRunId: run.qualityRunId,
        workerId,
        audit: { actorId: 'test:publication-dto', reason: '开始发布摘要测试质量结论。' },
      });
      for (const [index, resultKey] of run.inputSnapshot.requiredBlockingResultKeys.entries()) {
        qualityRepository.recordResult({
          qualityRunId: run.qualityRunId,
          workerId,
          checkKey: `publication-dto-${index + 1}`,
          resultKey,
          blockingLevel: 'blocking',
          passed: true,
          threshold: { required: true },
          actual: { passed: true },
          evidence: { message: '发布摘要测试结论已通过。' },
          audit: { actorId: 'test:publication-dto', reason: '记录发布摘要测试质量结论。' },
        });
      }
      qualityRepository.finalizePassed({
        qualityRunId: run.qualityRunId,
        workerId,
        audit: { actorId: 'test:publication-dto', reason: '完成发布摘要测试质量结论。' },
      });
    } finally {
      registry.close();
    }

    const publishable = (await runtime.getService()).listItems()
      .find((candidate) => candidate.itemId === prepared.item.itemId);
    assert.ok(publishable);
    assert.equal(publishable.publication.operationStatus, 'not_started');
    assert.equal(publishable.publication.canPublish, true);

    const queued = await runtime.startPublication(prepared.item.itemId);
    assert.equal(queued.publication.operationStatus, 'queued');
    assert.equal(queued.publication.canPublish, false);
    const operationDatabase = new Database(prepared.databasePath);
    let internals: {
      operation_id: string;
      job_id: string;
      quality_run_id: string;
      target_publication_id: string;
      target_binding_id: string;
      canonical_id: string;
      publication_branch_key: string;
      dataset_id: string;
      document_id: string;
      managed_source_path: string;
    };
    try {
      internals = operationDatabase.prepare(`
        SELECT operation.operation_id, operation.job_id, operation.quality_run_id,
               operation.target_publication_id, operation.target_binding_id,
               version.canonical_id, version.publication_branch_key,
               binding.dataset_id, binding.document_id, version.managed_source_path
        FROM publication_operations operation
        JOIN material_versions version ON version.version_id = operation.target_version_id
        JOIN ragflow_bindings binding ON binding.binding_id = operation.target_binding_id
        WHERE operation.target_version_id = ?
      `).get(prepared.item.versionId) as typeof internals;
      const internalText = 'document-secret C:\\secret\\managed http://private.example/ragflow';
      operationDatabase.prepare(`
        UPDATE processing_jobs
        SET status = 'failed', next_retry_at = NULL, error_code = 'REMOTE_CONTRACT',
            error_message = ?, updated_at = ?
        WHERE job_id = ?
      `).run(internalText, new Date().toISOString(), internals.job_id);
      operationDatabase.prepare(`
        UPDATE publication_operations
        SET error_code = 'REMOTE_CONTRACT', error_message = ?, updated_at = ?
        WHERE operation_id = ?
      `).run(internalText, new Date().toISOString(), internals.operation_id);
    } finally {
      operationDatabase.close();
    }

    const item = (await runtime.getService()).listItems().find((candidate) => candidate.itemId === prepared.item.itemId);
    assert.ok(item);
    assert.equal(item.lifecycle.processingHealth, 'healthy');
    assert.equal(item.lifecycle.currentStage, null);
    assert.equal(item.lifecycle.currentJobStatus, null);
    assert.equal(item.publication.operationStatus, 'attention_required');
    assert.equal(item.publication.canRetry, true);
    assert.equal(item.publication.canPublish, false);
    assert.deepEqual(Object.keys(item.publication).sort(), [
      'canPublish',
      'canReceiveNextVersion',
      'canRetry',
      'canRollback',
      'isCurrentVersion',
      'operationMessage',
      'operationStatus',
      'operationType',
      'operationUpdatedAt',
      'previousVersionLabel',
      'versionLabel',
    ].sort());
    const rendererPayload = JSON.stringify(item);
    for (const secret of [
      internals.operation_id,
      internals.job_id,
      internals.quality_run_id,
      internals.target_publication_id,
      internals.target_binding_id,
      internals.canonical_id,
      internals.publication_branch_key,
      internals.dataset_id,
      internals.document_id,
      internals.managed_source_path,
      'http://127.0.0.1:9380',
      'document-secret',
      'private.example',
    ]) {
      assert.equal(rendererPayload.includes(secret), false, `Renderer DTO 不应包含内部值：${secret}`);
    }
  } finally {
    await runtime.close();
    cleanup();
  }
});
