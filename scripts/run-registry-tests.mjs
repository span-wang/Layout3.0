import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testPaths = [
  ['electron', 'main', 'knowledge-ingestion', 'registry-store.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'publication-operation-repository.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'publication-service.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'intake-service.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'processing', 'basic-processing.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'pending-index-repository.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'processing-runner.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'ragflow-config-store.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'pending-index-service.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'ragflow', 'client.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'quality-evidence.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'quality-gate-repository.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'quality-gate-service.test.ts'],
  ['electron', 'main', 'knowledge-ingestion', 'quality-retrieval-service.test.ts'],
  ['electron', 'main', 'knowledge-ingestion-handlers.test.ts'],
  ['electron', 'main', 'protected-ragflow-dataset-guard.test.ts'],
  ['electron', 'main', 'ai-request-errors.test.ts'],
  ['src', 'store', 'slices', 'knowledgeIngestionSlice.test.ts'],
  ['src', 'components', 'knowledge-ingestion', 'KnowledgeIngestionWorkspace.test.tsx'],
].map((segments) => resolve(projectRoot, ...segments));

// better-sqlite3 已按 Electron 32 ABI 构建，测试也必须在同一 ABI 下运行。
const result = spawnSync(electronPath, ['--import', 'tsx', '--test', ...testPaths], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`资料登记库测试失败，退出码为 ${result.status ?? '未知'}。`);
}
