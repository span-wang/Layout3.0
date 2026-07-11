import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertContractReportSanitized,
  evaluateRouteACompatibility,
} from './lib/ragflowContractProbe';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const reportDirectory = path.join(projectRoot, 'evaluation', 'ragflow', 'contracts');
const sourcePath = path.join(reportDirectory, 'foundation-contract.v1.json');
const outputPath = path.join(reportDirectory, 'route-a-decision.v1.json');

// 本脚本只读取已脱敏的基础合同，不访问 RAGFlow，也不触碰任何远端数据。
let source: unknown = {};
let foundationSha256: string | null = null;
let evaluationErrorSummary: string | null = null;
try {
  const sourceText = await readFile(sourcePath, 'utf8');
  foundationSha256 = createHash('sha256').update(sourceText, 'utf8').digest('hex');
  try {
    source = JSON.parse(sourceText) as unknown;
  } catch {
    evaluationErrorSummary = 'foundation-contract.v1.json 不是有效 JSON。';
  }
} catch {
  evaluationErrorSummary = 'foundation-contract.v1.json 不存在或无法读取。';
}

const decision = evaluateRouteACompatibility(source, {
  foundationSha256,
  evaluationErrorSummary,
});
assertContractReportSanitized(decision, []);

await mkdir(reportDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');

if (!decision.compatible) {
  throw new Error(`路线 A 机器判定不兼容：${decision.failures.join('；')}`);
}

console.log('路线 A 机器判定通过：必需检查 11/11，决策报告已写入 evaluation/ragflow/contracts/route-a-decision.v1.json。');
