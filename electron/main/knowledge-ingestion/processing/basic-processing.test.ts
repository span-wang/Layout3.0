import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { openRegistryDatabase, type RegistryDatabase } from '../registry-database';
import { RegistryStore } from '../registry-store';
import { REGISTRY_SCHEMA_VERSION } from '../schema';
import { RegistryError } from '../types';
import { ProcessingArtifactService } from './artifact-service';
import type { DocxLocatorMap, PdfLocatorMap, ProcessingManifest } from './types';
import { WorkerDocumentExtractorBridge } from './worker-extractor-bridge';

const {
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} = createRequire(import.meta.url)('docx') as typeof import('docx');

const audit = { actorId: 'test:processing', reason: 'PH3-13C2 基础处理定向验收' };
const fixedNow = () => new Date('2026-07-11T08:00:00.000Z');

function createExtractorBridge(): WorkerDocumentExtractorBridge {
  const builtWorkerPath = process.env.LAYOUT3_TEST_EXTRACTOR_WORKER_PATH;
  return new WorkerDocumentExtractorBridge(
    builtWorkerPath ? { workerUrl: pathToFileURL(resolve(builtWorkerPath)) } : undefined,
  );
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function createDocxFixture(filePath: string): Promise<void> {
  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ text: '第一章 入门', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: '这是标题下的第一段正文。' }),
        new Paragraph({
          children: [
            new TextRun('显式分页之前'),
            new PageBreak(),
            new TextRun('显式分页之后'),
          ],
        }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('单元格 A')] }),
                new TableCell({ children: [new Paragraph('单元格 B')] }),
              ],
            }),
          ],
        }),
      ],
    }],
  });
  writeFileSync(filePath, await Packer.toBuffer(document));
}

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function createTextPdf(filePath: string, pageTexts: string[]): void {
  const fontObjectId = 3 + pageTexts.length * 2;
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageObjectIds = pageTexts.map((_text, index) => 3 + index * 2);
  objects.set(
    2,
    `<< /Type /Pages /Count ${pageTexts.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );
  pageTexts.forEach((text, index) => {
    const pageObjectId = pageObjectIds[index]!;
    const contentObjectId = pageObjectId + 1;
    const stream = text
      ? `BT\n/F1 18 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET\n`
      : 'BT\nET\n';
    objects.set(
      pageObjectId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    objects.set(
      contentObjectId,
      `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    );
  });
  objects.set(fontObjectId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let objectId = 1; objectId <= fontObjectId; objectId += 1) {
    offsets[objectId] = Buffer.byteLength(pdf, 'ascii');
    pdf += `${objectId} 0 obj\n${objects.get(objectId)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${fontObjectId + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let objectId = 1; objectId <= fontObjectId; objectId += 1) {
    pdf += `${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${fontObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  writeFileSync(filePath, Buffer.from(pdf, 'ascii'));
}

async function createContext(): Promise<{
  root: string;
  managedRoot: string;
  registry: RegistryDatabase;
  store: RegistryStore;
  service: ProcessingArtifactService;
  cleanup: () => void;
}> {
  const root = mkdtempSync(join(tmpdir(), 'layout3-processing-test-'));
  const managedRoot = join(root, 'knowledge-ingestion');
  const registry = await openRegistryDatabase({
    databasePath: join(managedRoot, 'registry.sqlite'),
    backupDirectory: join(managedRoot, 'backups'),
    allowTestProcess: true,
    now: fixedNow,
  });
  const store = new RegistryStore(registry, { now: fixedNow });
  return {
    root,
    managedRoot,
    registry,
    store,
    service: new ProcessingArtifactService(registry, managedRoot, {
      now: fixedNow,
      extractor: createExtractorBridge(),
    }),
    cleanup: () => {
      registry.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function registerSource(input: {
  store: RegistryStore;
  versionId: string;
  managedPath: string;
  parserProfile: string;
}): string {
  const canonicalId = `mat-${input.versionId}`;
  input.store.createMaterial({
    canonicalId,
    stableTitle: `${input.versionId} 测试资料`,
    domain: '教育',
    audit,
  });
  input.store.createPublicationBranch({
    canonicalId,
    branchKey: 'default',
    branchType: 'default',
    displayName: '默认版本',
    isDefault: true,
    audit,
  });
  const contentHash = sha256File(input.managedPath);
  input.store.createMaterialVersion({
    versionId: input.versionId,
    canonicalId,
    publicationBranchKey: 'default',
    contentHash,
    sourcePath: input.managedPath,
    managedSourcePath: input.managedPath,
    parserProfile: input.parserProfile,
    audit,
  });
  return contentHash;
}

function assertRegistryError(error: unknown, code: RegistryError['code']): boolean {
  return error instanceof RegistryError && error.code === code;
}

test('PH3-13C2 schema V3 建立处理工件表并持久化远端解析证据列', async () => {
  const context = await createContext();
  try {
    assert.equal(REGISTRY_SCHEMA_VERSION, 5);
    assert.equal(
      Number(context.registry.connection.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()),
      REGISTRY_SCHEMA_VERSION,
    );
    const artifactTable = context.registry.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'processing_artifacts'")
      .pluck()
      .get();
    assert.equal(artifactTable, 'processing_artifacts');
    const bindingColumns = context.registry.connection
      .prepare('PRAGMA table_info(ragflow_bindings)')
      .all() as Array<{ name: string }>;
    assert.equal(bindingColumns.some((column) => column.name === 'remote_run_status'), true);
    assert.equal(bindingColumns.some((column) => column.name === 'chunk_count'), true);
  } finally {
    context.cleanup();
  }
});

test('PH3-13C2 DOCX 生成正文、标题路径、段落/表格序号和显式分页工件并可幂等接管', async () => {
  const context = await createContext();
  const managedPath = join(context.managedRoot, 'objects', 'docx', 'fixture.docx');
  mkdirSync(dirname(managedPath), { recursive: true });

  try {
    await createDocxFixture(managedPath);
    const sourceHash = registerSource({
      store: context.store,
      versionId: 'ver-docx-basic',
      managedPath,
      parserProfile: 'education-textbook-v1',
    });
    const first = await context.service.processVersion({ versionId: 'ver-docx-basic' });
    assert.equal(first.reused, false);
    assert.equal(first.sourceHash, sourceHash);
    assert.equal(existsSync(first.body.absolutePath), true);
    assert.equal(sha256File(first.body.absolutePath), first.body.sha256);
    assert.equal(sha256File(first.locatorMap.absolutePath), first.locatorMap.sha256);
    assert.equal(sha256File(first.manifest.absolutePath), first.manifest.sha256);

    const bodyText = readFileSync(first.body.absolutePath, 'utf8');
    assert.match(bodyText, /第一章 入门/);
    assert.match(bodyText, /这是标题下的第一段正文/);
    assert.match(bodyText, /单元格 A\t单元格 B/);
    const locator = JSON.parse(readFileSync(first.locatorMap.absolutePath, 'utf8')) as DocxLocatorMap;
    assert.equal(locator.sourceFormat, 'docx');
    assert.equal(locator.physicalPageNumbersAvailable, false);
    assert.equal('pageNumber' in locator, false);
    const paragraph = locator.blocks.find((block) => block.paragraphNumber === 2);
    assert.deepEqual(paragraph?.headingPath, ['第一章 入门']);
    const pageBreakParagraph = locator.blocks.find((block) => block.paragraphNumber === 3);
    assert.equal(pageBreakParagraph?.explicitPageBreaks.some((item) => item.kind === 'page_break'), true);
    const table = locator.blocks.find((block) => block.tableNumber === 1);
    assert.equal(table?.blockType, 'table');
    assert.deepEqual(table?.headingPath, ['第一章 入门']);
    assert.equal(table?.rowCount, 1);
    assert.equal(table?.columnCount, 2);

    const manifest = JSON.parse(readFileSync(first.manifest.absolutePath, 'utf8')) as ProcessingManifest;
    assert.equal(manifest.source.sha256, sourceHash);
    assert.equal(manifest.versionId, 'ver-docx-basic');
    assert.equal(manifest.artifacts.length, 2);
    assert.equal(
      Number(context.registry.connection
        .prepare('SELECT COUNT(*) FROM processing_artifacts WHERE version_id = ?')
        .pluck()
        .get('ver-docx-basic')),
      3,
    );

    const firstModifiedAt = statSync(first.body.absolutePath).mtimeMs;
    const second = await context.service.processVersion({ versionId: 'ver-docx-basic' });
    assert.equal(second.reused, true);
    assert.equal(second.body.absolutePath, first.body.absolutePath);
    assert.equal(statSync(second.body.absolutePath).mtimeMs, firstModifiedAt);

    // 模拟进程在三件工件完整落盘后、SQLite 登记提交前退出；重启应直接接管磁盘清单。
    context.registry.connection
      .prepare('DELETE FROM processing_artifacts WHERE version_id = ?')
      .run('ver-docx-basic');
    const recovered = await context.service.processVersion({ versionId: 'ver-docx-basic' });
    assert.equal(recovered.reused, true);
    assert.equal(recovered.body.sha256, first.body.sha256);
    assert.equal(
      Number(context.registry.connection
        .prepare('SELECT COUNT(*) FROM processing_artifacts WHERE version_id = ?')
        .pluck()
        .get('ver-docx-basic')),
      3,
    );
  } finally {
    context.cleanup();
  }
});

test('PH3-13C2 两页文本 PDF 保留 1-based 原始页码和页内文字定位', async () => {
  const context = await createContext();
  const managedPath = join(context.managedRoot, 'objects', 'pdf', 'two-pages.pdf');
  mkdirSync(dirname(managedPath), { recursive: true });

  try {
    createTextPdf(managedPath, ['First page source text', 'Second page source text']);
    const sourceHash = registerSource({
      store: context.store,
      versionId: 'ver-pdf-basic',
      managedPath,
      parserProfile: 'basic-pdf-v1',
    });
    const result = await context.service.processVersion({ versionId: 'ver-pdf-basic' });
    const bodyText = readFileSync(result.body.absolutePath, 'utf8');
    assert.match(bodyText, /First page source text/);
    assert.match(bodyText, /Second page source text/);
    const locator = JSON.parse(readFileSync(result.locatorMap.absolutePath, 'utf8')) as PdfLocatorMap;
    assert.equal(locator.sourceHash, sourceHash);
    assert.equal(locator.pageCount, 2);
    assert.deepEqual(locator.pages.map((page) => page.pageNumber), [1, 2]);
    assert.equal(locator.pages.every((page) => page.items.length > 0), true);
    assert.match(
      bodyText.slice(locator.pages[0]!.startOffset, locator.pages[0]!.endOffset),
      /First page source text/,
    );
    assert.match(
      bodyText.slice(locator.pages[1]!.startOffset, locator.pages[1]!.endOffset),
      /Second page source text/,
    );
    assert.equal(result.body.sizeBytes > 0, true);
    assert.equal(result.locatorMap.sizeBytes > 0, true);
    assert.equal(result.manifest.sizeBytes > 0, true);
  } finally {
    context.cleanup();
  }
});

test('PH3-13C2 无文本层 PDF 明确失败且不登记空处理工件', async () => {
  const context = await createContext();
  const managedPath = join(context.managedRoot, 'objects', 'pdf', 'scanned-empty.pdf');
  mkdirSync(dirname(managedPath), { recursive: true });

  try {
    createTextPdf(managedPath, ['']);
    registerSource({
      store: context.store,
      versionId: 'ver-pdf-empty',
      managedPath,
      parserProfile: 'basic-pdf-v1',
    });
    await assert.rejects(
      context.service.processVersion({ versionId: 'ver-pdf-empty' }),
      (error) => {
        assert.equal(assertRegistryError(error, 'FILE_PROCESSING'), true);
        assert.match((error as Error).message, /扫描件|OCR|可提取正文/);
        return true;
      },
    );
    assert.equal(
      Number(context.registry.connection
        .prepare('SELECT COUNT(*) FROM processing_artifacts WHERE version_id = ?')
        .pluck()
        .get('ver-pdf-empty')),
      0,
    );
  } finally {
    context.cleanup();
  }
});

test('PH3-13C2 AbortSignal 会终止独立抽取 worker 并返回中文取消错误', async () => {
  const root = mkdtempSync(join(tmpdir(), 'layout3-processing-worker-cancel-'));
  const filePath = join(root, 'cancel.docx');
  try {
    await createDocxFixture(filePath);
    const controller = new AbortController();
    const promise = createExtractorBridge().extract({
      filePath,
      sourceFormat: 'docx',
      sourceHash: sha256File(filePath),
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(
      promise,
      (error) => {
        assert.equal(assertRegistryError(error, 'CANCELLED'), true);
        assert.match((error as Error).message, /取消/);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
