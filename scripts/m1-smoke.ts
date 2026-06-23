import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  applyAnswerAnnotationToBlock,
  applyBlockStyleOverridesToBlock,
  applyTextStyleToBlock,
  buildTocItems,
  createLayoutDocumentFromMarkdown,
  insertTableBlockAfterNode,
  updateTableColumnAlignByCell,
  updateTableHeaderRowByCell,
  updateTableStructureByCell,
  type LayoutBlock,
  parseLayoutProjectFile,
  serializeLayoutProjectFile,
  toggleTextMarkOnBlock,
  updateLayoutImageAttributes,
  updateLayoutBlockText,
  updateLayoutListItemText,
  updateLayoutTableCellText,
} from '../src/engine/document-model/index.ts';
import { defaultStyleSettings } from '../src/engine/style/presets.ts';
import { resolveStyleContract } from '../src/engine/style/resolveContract.ts';
import { cloneStyleSettings } from '../src/engine/style/styleSettings.ts';
import { buildExportHtml } from '../src/services/exportHtml.ts';
import {
  ESTIMATED_GREEDY_BALANCED_PAGINATION_ALGORITHM_ID,
  ESTIMATED_GREEDY_BALANCED_V2_PAGINATION_ALGORITHM_ID,
  ESTIMATED_GREEDY_PAGINATION_ALGORITHM_ID,
  DEFAULT_CODE_CHAR_WIDTH_FACTOR,
  listPaginationAlgorithms,
  estimateTextLines,
  resolveEstimatedTextCharWidthFactor,
  paginateBlocks,
} from '../src/engine/typesetting/index.ts';
import { useAppStore } from '../src/store/index.ts';
import { resolveAssetSrc } from '../src/utils/filePath.ts';
import { defaultBlockStyles } from '../src/engine/style/presets.ts';

const outputDir = path.resolve('out', 'm1-smoke');
const outputPath = path.join(outputDir, 'm1-smoke.pdf');
const electronCliPath = path.resolve('node_modules', 'electron', 'cli.js');
const exportScriptPath = path.join(outputDir, 'm1-smoke-export.cjs');

async function runElectronExport(html: string): Promise<void> {
  const script = [
    'const { app, BrowserWindow } = require(\'electron\');',
    "const fs = require('node:fs/promises');",
    "const path = require('node:path');",
    `const outputPath = ${JSON.stringify(outputPath)};`,
    `const html = ${JSON.stringify(html)};`,
    `const outputDir = path.dirname(outputPath);`,
    'async function main() {',
    '  await app.whenReady();',
    '  await fs.mkdir(outputDir, { recursive: true });',
    '  const win = new BrowserWindow({ show: false, autoHideMenuBar: true, webPreferences: { sandbox: false } });',
    '  try {',
    "    await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));",
    "    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready : Promise.resolve()');",
    "    const pdfBuffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });",
    '    await fs.writeFile(outputPath, pdfBuffer);',
    '  } finally {',
    '    if (!win.isDestroyed()) {',
    '      win.destroy();',
    '    }',
    '  }',
    '  app.exit(0);',
    '}',
    'main().catch((error) => {',
    '  console.error(error.stack || error.message || String(error));',
    '  app.exit(1);',
    '});',
  ].join('\n');

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(exportScriptPath, script, 'utf8');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [electronCliPath, exportScriptPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
    });

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Electron 导出失败，退出码：${code ?? 'unknown'}`));
    });
  });

  await fs.rm(exportScriptPath, { force: true });
}

async function main(): Promise<void> {
  const source = [
    '# M1 Smoke Test',
    '',
    '这是第一页的内容，用于验证手动分页符前的排版结果。',
    '',
    '- 第一项',
    '- 第二项',
    '',
    '/pagebreak',
    '',
    '## 第二页标题',
    '',
    '> 引用块用于验证手动分页后内容进入下一页。',
    '',
    '```ts',
    '/pagebreak',
    "const code = 'hello';",
    '```',
    '',
  ].join('\n');

  const layoutDocument = await createLayoutDocumentFromMarkdown(source);
  const recreatedDocument = await createLayoutDocumentFromMarkdown(source);
  const tocItems = buildTocItems(layoutDocument);
  const contract = resolveStyleContract(defaultStyleSettings);
  const pages = paginateBlocks(layoutDocument.blocks, contract);
  const html = buildExportHtml({ pages, title: layoutDocument.title });
  const pageBreakBlockCount = layoutDocument.blocks.filter((block) => block.type === 'pageBreak').length;

  // 冒烟脚本额外覆盖手动分页符主链路，避免后续改动把断页语义悄悄破坏掉。
  if (pages.length !== 2) {
    throw new Error(`手动分页符验证失败：期望 2 页，实际得到 ${pages.length} 页`);
  }

  if (pageBreakBlockCount !== 1) {
    throw new Error(`手动分页符验证失败：期望只识别 1 个分页命令，实际识别 ${pageBreakBlockCount} 个`);
  }

  if (pages.some((page) => page.blocks.some((block) => block.type === 'pageBreak'))) {
    throw new Error('手动分页符验证失败：分页符不应作为可见内容残留在分页结果中');
  }

  if (html.includes('LAYOUT_PAGEBREAK_FORCED_9F4E')) {
    throw new Error('手动分页符验证失败：导出 HTML 泄漏了内部分页占位标记');
  }

  if (tocItems.length !== 2) {
    throw new Error(`文档大纲验证失败：期望识别 2 个标题，实际得到 ${tocItems.length} 个`);
  }

  const currentBlockIds = layoutDocument.blocks.map((block) => block.id).join('|');
  const recreatedBlockIds = recreatedDocument.blocks.map((block) => block.id).join('|');
  if (currentBlockIds !== recreatedBlockIds) {
    throw new Error('结构化模型验证失败：同一份 Markdown 二次转换后块 ID 不稳定');
  }

  const customizedStyleSettings = cloneStyleSettings(defaultStyleSettings);
  customizedStyleSettings.pageSize = 'B5';
  customizedStyleSettings.orientation = 'landscape';
  customizedStyleSettings.customMarginsMm.top = 26;
  customizedStyleSettings.customMarginsMm.right = 18;
  customizedStyleSettings.templateId = 'lecture';
  const serializedProjectFile = serializeLayoutProjectFile({
    document: layoutDocument,
    styleSettings: customizedStyleSettings,
  });
  const restoredProject = parseLayoutProjectFile(serializedProjectFile);

  if (restoredProject.document.title !== layoutDocument.title) {
    throw new Error('layout 工程文件验证失败：文档标题没有被正确恢复');
  }

  if (restoredProject.document.blocks.length !== layoutDocument.blocks.length) {
    throw new Error('layout 工程文件验证失败：结构块数量没有被正确恢复');
  }

  if (restoredProject.document.blocks.map((block) => block.id).join('|') !== currentBlockIds) {
    throw new Error('layout 工程文件验证失败：结构块 ID 在恢复后发生了变化');
  }

  if (restoredProject.styleSettings.pageSize !== 'B5') {
    throw new Error('layout 工程文件验证失败：页面尺寸没有被正确恢复');
  }

  if (restoredProject.styleSettings.orientation !== 'landscape') {
    throw new Error('layout 工程文件验证失败：页面方向没有被正确恢复');
  }

  if (restoredProject.styleSettings.templateId !== 'lecture') {
    throw new Error('layout 工程文件验证失败：模板设置没有被正确恢复');
  }

  if (restoredProject.styleSettings.customMarginsMm.top !== 26) {
    throw new Error('layout 工程文件验证失败：自定义页边距没有被正确恢复');
  }

  if (restoredProject.styleSettings.paginationAlgorithmId !== customizedStyleSettings.paginationAlgorithmId) {
    throw new Error('layout 工程文件验证失败：分页算法选择没有被正确恢复');
  }

  const algorithmIds = listPaginationAlgorithms().map((algorithm) => algorithm.id);
  if (
    !algorithmIds.includes(ESTIMATED_GREEDY_PAGINATION_ALGORITHM_ID) ||
    !algorithmIds.includes(ESTIMATED_GREEDY_BALANCED_PAGINATION_ALGORITHM_ID) ||
    !algorithmIds.includes(ESTIMATED_GREEDY_BALANCED_V2_PAGINATION_ALGORITHM_ID)
  ) {
    throw new Error('分页算法注册验证失败：内置算法没有正确注册到算法列表');
  }

  const pureCjkFactor = resolveEstimatedTextCharWidthFactor('纯中文分页校准');
  const latinFactor = resolveEstimatedTextCharWidthFactor('pagination');
  const mixedFactor = resolveEstimatedTextCharWidthFactor('纯中文 pagination 混排');

  if (pureCjkFactor !== 1) {
    throw new Error(`文本估算验证失败：纯中文字符宽度系数应为 1，实际得到 ${pureCjkFactor}`);
  }

  if (latinFactor >= mixedFactor || mixedFactor >= 1) {
    throw new Error(
      `文本估算验证失败：中英混排字符宽度系数应介于纯英文与纯中文之间，实际得到英文 ${latinFactor}、混排 ${mixedFactor}`,
    );
  }

  const pureCjkLines = estimateTextLines('纯中文内容纯中文内容', 96, 16);
  const latinLines = estimateTextLines('pagination', 96, 16);

  if (pureCjkLines !== 2) {
    throw new Error(`文本估算验证失败：纯中文示例应换成 2 行，实际得到 ${pureCjkLines} 行`);
  }

  if (latinLines !== 1) {
    throw new Error(`文本估算验证失败：英文示例应保持 1 行，实际得到 ${latinLines} 行`);
  }

  if (Math.abs(defaultBlockStyles.code.charWidth - DEFAULT_CODE_CHAR_WIDTH_FACTOR) > 1e-9) {
    throw new Error('文本估算验证失败：代码块字符宽度来源没有收口到命名常量');
  }

  const textRunDocument = await createLayoutDocumentFromMarkdown('这是重要答案');
  const textRunParagraph = textRunDocument.blocks.find(
    (block) => block.type === 'paragraph' && block.textRuns.length > 0,
  );
  if (!textRunParagraph) {
    throw new Error('结构化模型验证失败：未找到可用于 TextRun 拆分的段落块');
  }

  const styledParagraph = applyTextStyleToBlock(textRunParagraph, { start: 2, end: 4 }, {
    color: '#d92d20',
    highlightColor: '#fff3a3',
  });
  const answeredParagraph = applyAnswerAnnotationToBlock(styledParagraph, { start: 4, end: 6 });

  if (answeredParagraph.textRuns.length < 3) {
    throw new Error(`结构化模型验证失败：期望 TextRun 被拆分，实际仅得到 ${answeredParagraph.textRuns.length} 段`);
  }

  if (!answeredParagraph.textRuns.some((run) => run.styleOverrides.color === '#d92d20')) {
    throw new Error('结构化模型验证失败：局部文字样式未成功写入 TextRun');
  }

  if (
    !answeredParagraph.textRuns.some((run) =>
      run.annotations.some((annotation) => annotation.type === 'answer'),
    )
  ) {
    throw new Error('结构化模型验证失败：答案语义标记未成功写入 TextRun');
  }

  const styleEditingDocument = await createLayoutDocumentFromMarkdown([
    '这是样式验证段落内容，用于检查文字和段落样式写回。',
    '',
    '这是第二段，用于验证分页估算会跟随段落样式变化。',
  ].join('\n'));
  const styleParagraph = styleEditingDocument.blocks.find((block) => block.type === 'paragraph');

  if (!styleParagraph) {
    throw new Error('样式编辑验证失败：未找到可用于验证的段落块');
  }

  const markedStyleParagraph = toggleTextMarkOnBlock(styleParagraph, { start: 0, end: 4 }, 'bold');
  const textStyledParagraph = applyTextStyleToBlock(markedStyleParagraph, { start: 0, end: 4 }, {
    fontSize: 20,
    color: '#c81e1e',
    highlightColor: '#fde68a',
  });
  const blockStyledParagraph = applyBlockStyleOverridesToBlock(textStyledParagraph, {
    textAlign: 'center',
    lineHeight: 38,
    firstLineIndent: 24,
    spaceBefore: 18,
    spaceAfter: 26,
  });

  if (!blockStyledParagraph.textRuns.some((run) => run.marks.some((mark) => mark.type === 'bold'))) {
    throw new Error('样式编辑验证失败：加粗标记没有写回 TextRun');
  }

  if (!blockStyledParagraph.textRuns.some((run) => run.styleOverrides.fontSize === 20)) {
    throw new Error('样式编辑验证失败：字号没有写回 TextRun');
  }

  if (blockStyledParagraph.blockStyleOverrides.textAlign !== 'center') {
    throw new Error('样式编辑验证失败：段落对齐没有写回 blockStyleOverrides');
  }

  if (blockStyledParagraph.blockStyleOverrides.firstLineIndent !== 24) {
    throw new Error('样式编辑验证失败：首行缩进没有写回 blockStyleOverrides');
  }

  const styledDocument = {
    ...styleEditingDocument,
    blocks: styleEditingDocument.blocks.map((block) =>
      block.id === blockStyledParagraph.id ? blockStyledParagraph : block,
    ),
  };
  const styledPages = paginateBlocks(styledDocument.blocks, contract);
  const styledHtml = buildExportHtml({ pages: styledPages, title: styledDocument.title });
  const restoredStyledProject = parseLayoutProjectFile(
    serializeLayoutProjectFile({
      document: styledDocument,
      styleSettings: customizedStyleSettings,
    }),
  );

  if (!styledHtml.includes('font-size:20px')) {
    throw new Error('样式编辑验证失败：导出 HTML 没有消费文字字号样式');
  }

  if (!styledHtml.includes('text-align:center')) {
    throw new Error('样式编辑验证失败：导出 HTML 没有消费段落对齐样式');
  }

  if (!styledHtml.includes('text-indent:24px')) {
    throw new Error('样式编辑验证失败：导出 HTML 没有消费首行缩进样式');
  }

  const restoredStyledParagraph = restoredStyledProject.document.blocks.find(
    (block) => block.id === blockStyledParagraph.id,
  );
  if (!restoredStyledParagraph || restoredStyledParagraph.blockStyleOverrides.spaceAfter !== 26) {
    throw new Error('样式编辑验证失败：`.layout` 工程文件没有恢复段后距样式');
  }

  const canvasEditDocument = await createLayoutDocumentFromMarkdown([
    '# 原标题',
    '',
    '原段落',
    '',
    '```txt',
    '旧代码',
    '```',
  ].join('\n'));
  const editableHeading = canvasEditDocument.blocks.find((block) => block.type === 'heading');
  const editableParagraph = canvasEditDocument.blocks.find((block) => block.type === 'paragraph');
  const editableCode = canvasEditDocument.blocks.find((block) => block.type === 'code');

  if (!editableHeading || !editableParagraph || !editableCode) {
    throw new Error('画布文字编辑验证失败：未找到标题、段落或代码块');
  }

  const updatedHeading = updateLayoutBlockText(editableHeading, '新标题');
  const updatedParagraph = updateLayoutBlockText(editableParagraph, '新段落内容');
  const updatedCode = updateLayoutBlockText(editableCode, 'const answer = 42;');

  if (updatedHeading.metadata.kind !== 'heading' || updatedHeading.metadata.text !== '新标题') {
    throw new Error('画布文字编辑验证失败：标题块文字没有写回 metadata');
  }

  if (updatedParagraph.metadata.kind !== 'paragraph' || updatedParagraph.metadata.text !== '新段落内容') {
    throw new Error('画布文字编辑验证失败：段落块文字没有写回 metadata');
  }

  if (updatedCode.metadata.kind !== 'code' || updatedCode.metadata.value !== 'const answer = 42;') {
    throw new Error('画布文字编辑验证失败：代码块文字没有写回 metadata');
  }

  if (updatedHeading.sourceRange !== null || updatedParagraph.sourceRange !== null || updatedCode.sourceRange !== null) {
    throw new Error('画布文字编辑验证失败：画布编辑后应清空过期源码范围');
  }

  const canvasNodeEditDocument = await createLayoutDocumentFromMarkdown([
    '![旧图片说明](example.png)',
    '',
    '- 旧列表项',
    '',
    '| 标题 |',
    '| --- |',
    '| 旧单元格 |',
  ].join('\n'));
  const editableImage = canvasNodeEditDocument.blocks.find((block) => block.type === 'image');
  const editableList = canvasNodeEditDocument.blocks.find(
    (block): block is LayoutBlock & { metadata: { kind: 'list'; items: NonNullable<LayoutBlock['metadata']>[] } } =>
      block.type === 'list' && block.metadata.kind === 'list',
  );
  const editableTable = canvasNodeEditDocument.blocks.find(
    (block): block is LayoutBlock & { metadata: { kind: 'table'; rows: Array<{ cells: Array<{ id: string }> }> } } =>
      block.type === 'table' && block.metadata.kind === 'table',
  );

  if (!editableImage || !editableList || !editableTable) {
    throw new Error('画布文字编辑验证失败：未找到图片、列表或表格块');
  }

  const updatedImage = updateLayoutBlockText(editableImage, '新图片说明');
  const updatedListItem = updateLayoutListItemText(editableList.metadata.items[0], '新列表项');
  const updatedTableCell = updateLayoutTableCellText(editableTable.metadata.rows[1].cells[0], '新单元格');

  if (updatedImage.metadata.kind !== 'image' || updatedImage.metadata.alt !== '新图片说明') {
    throw new Error('画布文字编辑验证失败：图片说明没有写回 metadata');
  }

  const updatedImageAttributes = updateLayoutImageAttributes(editableImage, {
    src: 'updated.png',
    alt: '更新后的图片说明',
    title: '图片标题',
  });
  if (
    updatedImageAttributes.metadata.kind !== 'image' ||
    updatedImageAttributes.metadata.src !== 'updated.png' ||
    updatedImageAttributes.metadata.alt !== '更新后的图片说明' ||
    updatedImageAttributes.metadata.title !== '图片标题'
  ) {
    throw new Error('图片属性编辑验证失败：图片路径、替代文本或标题没有写回 metadata');
  }

  useAppStore.getState().loadDocument({
    title: canvasNodeEditDocument.title,
    filePath: null,
    source: canvasNodeEditDocument.source,
    documentFormat: 'layout',
    layoutDocument: canvasNodeEditDocument,
  });
  useAppStore.getState().updateLayoutImageAttributes({
    nodeId: editableImage.id,
    src: 'store-updated.png',
    alt: 'store 图片说明',
    title: 'store 图片标题',
  });
  const storeImageResource = useAppStore
    .getState()
    .layoutDocument?.resources.find((resource) => resource.blockId === editableImage.id);
  if (
    !storeImageResource ||
    storeImageResource.src !== 'store-updated.png' ||
    storeImageResource.alt !== 'store 图片说明' ||
    storeImageResource.title !== 'store 图片标题'
  ) {
    throw new Error('图片属性编辑验证失败：store 写回后 resources 没有同步更新');
  }

  const insertedImageBlockId = useAppStore.getState().insertLayoutImageBlock({
    src: 'C:\\测试图片\\插入图片.png',
    alt: '插入图片',
    title: null,
    insertAfterNodeId: editableImage.id,
  });
  const insertedImageDocument = useAppStore.getState().layoutDocument;
  const insertedImageIndex =
    insertedImageDocument?.blocks.findIndex((block) => block.id === insertedImageBlockId) ?? -1;
  const previousImageIndex =
    insertedImageDocument?.blocks.findIndex((block) => block.id === editableImage.id) ?? -1;
  const insertedImageBlock = insertedImageDocument?.blocks.find((block) => block.id === insertedImageBlockId);
  const insertedImageResource = insertedImageDocument?.resources.find(
    (resource) => resource.blockId === insertedImageBlockId,
  );

  if (!insertedImageBlockId || insertedImageIndex !== previousImageIndex + 1) {
    throw new Error('图片插入验证失败：新图片块没有插入到当前选中块之后');
  }

  if (
    !insertedImageBlock ||
    insertedImageBlock.type !== 'image' ||
    insertedImageBlock.metadata.kind !== 'image' ||
    insertedImageBlock.metadata.src !== 'C:\\测试图片\\插入图片.png' ||
    insertedImageBlock.metadata.alt !== '插入图片'
  ) {
    throw new Error('图片插入验证失败：新图片块 metadata 不正确');
  }

  if (
    !insertedImageResource ||
    insertedImageResource.src !== 'C:\\测试图片\\插入图片.png' ||
    insertedImageResource.alt !== '插入图片'
  ) {
    throw new Error('图片插入验证失败：新图片资源没有同步写入 resources');
  }

  if (insertedImageDocument?.viewState.selectedNodeId !== insertedImageBlockId) {
    throw new Error('图片插入验证失败：插入后没有自动选中新图片块');
  }

  const resolvedLocalImageSrc = resolveAssetSrc('C:\\测试图片\\插入图片.png');
  if (!resolvedLocalImageSrc.startsWith('layout-asset://local/')) {
    throw new Error('图片渲染验证失败：本地图片路径没有转换为自定义资源协议');
  }

  const directTableInsertResult = insertTableBlockAfterNode(insertedImageDocument?.blocks ?? [], {
    rowCount: 3,
    columnCount: 3,
    insertAfterNodeId: insertedImageBlockId,
  });
  const directInsertedTable = directTableInsertResult.blocks.find(
    (block) => block.id === directTableInsertResult.insertedBlockId,
  );

  if (
    !directInsertedTable ||
    directInsertedTable.type !== 'table' ||
    directInsertedTable.metadata.kind !== 'table' ||
    directInsertedTable.metadata.rows.length !== 3 ||
    directInsertedTable.metadata.rows.some((row) => row.cells.length !== 3)
  ) {
    throw new Error('表格插入验证失败：模型层没有生成默认 3 x 3 表格');
  }

  const resourcesBeforeTableInsert = insertedImageDocument?.resources.length ?? 0;
  const selectedTableNodeId = useAppStore.getState().insertLayoutTableBlock({
    rowCount: 3,
    columnCount: 3,
    insertAfterNodeId: insertedImageBlockId,
  });
  const insertedTableDocument = useAppStore.getState().layoutDocument;
  const insertedTableBlock = insertedTableDocument?.blocks.find(
    (block) =>
      block.type === 'table' &&
      block.metadata.kind === 'table' &&
      block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === selectedTableNodeId)),
  );
  const insertedTableIndex =
    insertedTableDocument?.blocks.findIndex((block) => block.id === insertedTableBlock?.id) ?? -1;
  const tablePreviousImageIndex =
    insertedTableDocument?.blocks.findIndex((block) => block.id === insertedImageBlockId) ?? -1;

  if (!selectedTableNodeId || !insertedTableBlock || insertedTableIndex !== tablePreviousImageIndex + 1) {
    throw new Error('表格插入验证失败：新表格没有插入到当前选中块之后');
  }

  if (
    insertedTableBlock.metadata.kind !== 'table' ||
    insertedTableBlock.metadata.align.length !== 3 ||
    insertedTableBlock.metadata.rows.length !== 3 ||
    insertedTableBlock.metadata.rows.some((row) => row.cells.length !== 3)
  ) {
    throw new Error('表格插入验证失败：store 写回的默认表格结构不正确');
  }

  if (
    insertedTableBlock.metadata.kind === 'table' &&
    insertedTableBlock.metadata.rows.some((row) =>
      row.cells.some((cell) => cell.isHeader || cell.textRuns.length !== 0),
    )
  ) {
    throw new Error('表格插入验证失败：默认表格应保持无表头、空单元格');
  }

  if (insertedTableDocument?.viewState.selectedNodeId !== selectedTableNodeId) {
    throw new Error('表格插入验证失败：插入后没有自动选中新表格的第一个单元格');
  }

  if (insertedTableDocument?.resources.length !== resourcesBeforeTableInsert) {
    throw new Error('表格插入验证失败：默认表格不应写入 resources');
  }

  const firstInsertedTableCell =
    insertedTableBlock.metadata.kind === 'table' ? insertedTableBlock.metadata.rows[0]?.cells[0] : null;
  if (!firstInsertedTableCell || firstInsertedTableCell.id !== selectedTableNodeId) {
    throw new Error('表格插入验证失败：插入后应选中新表格的第一个单元格');
  }

  const directHeaderRowResult = updateTableHeaderRowByCell(
    directInsertedTable,
    directInsertedTable.metadata.kind === 'table' ? directInsertedTable.metadata.rows[1].cells[1].id : '',
    true,
  );
  if (
    !directHeaderRowResult.didUpdate ||
    directHeaderRowResult.block.metadata.kind !== 'table' ||
    !directHeaderRowResult.block.metadata.rows[0].cells.every((cell) => cell.isHeader) ||
    directHeaderRowResult.block.metadata.rows.slice(1).some((row) => row.cells.some((cell) => cell.isHeader))
  ) {
    throw new Error('表格属性编辑验证失败：模型层没有正确设置首行为表头');
  }

  const directColumnAlignResult = updateTableColumnAlignByCell(
    directHeaderRowResult.block,
    directHeaderRowResult.block.metadata.kind === 'table' ? directHeaderRowResult.block.metadata.rows[0].cells[1].id : '',
    'center',
  );
  if (
    !directColumnAlignResult.didUpdate ||
    directColumnAlignResult.block.metadata.kind !== 'table' ||
    directColumnAlignResult.block.metadata.align[1] !== 'center'
  ) {
    throw new Error('表格属性编辑验证失败：模型层没有正确设置当前列对齐');
  }

  const tablePropertyHtml = buildExportHtml({
    pages: paginateBlocks([directColumnAlignResult.block], contract),
    title: '表格属性导出验证',
  });
  if (!tablePropertyHtml.includes('<th') || !tablePropertyHtml.includes('text-align:center')) {
    throw new Error('表格属性导出验证失败：HTML 没有输出表头或列对齐样式');
  }

  const selectedAfterHeaderRowToggle = useAppStore.getState().updateLayoutTableHeaderRow({
    cellId: firstInsertedTableCell.id,
    enabled: true,
  });
  const headerEnabledTableBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === insertedTableBlock.id);
  if (
    selectedAfterHeaderRowToggle !== firstInsertedTableCell.id ||
    !headerEnabledTableBlock ||
    headerEnabledTableBlock.metadata.kind !== 'table' ||
    !headerEnabledTableBlock.metadata.rows[0].cells.every((cell) => cell.isHeader) ||
    headerEnabledTableBlock.metadata.rows.slice(1).some((row) => row.cells.some((cell) => cell.isHeader))
  ) {
    throw new Error('表格属性编辑验证失败：store 没有正确设置首行为表头');
  }

  const selectedAfterColumnAlign = useAppStore.getState().updateLayoutTableColumnAlign({
    cellId: firstInsertedTableCell.id,
    align: 'right',
  });
  const alignedTableBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === insertedTableBlock.id);
  if (
    selectedAfterColumnAlign !== firstInsertedTableCell.id ||
    !alignedTableBlock ||
    alignedTableBlock.metadata.kind !== 'table' ||
    alignedTableBlock.metadata.align[0] !== 'right'
  ) {
    throw new Error('表格属性编辑验证失败：store 没有正确设置当前列对齐');
  }

  const directTableStructureResult = updateTableStructureByCell(
    directInsertedTable,
    directInsertedTable.metadata.kind === 'table' ? directInsertedTable.metadata.rows[0].cells[0].id : '',
    'insertRowBelow',
  );
  if (
    !directTableStructureResult.didUpdate ||
    directTableStructureResult.block.metadata.kind !== 'table' ||
    directTableStructureResult.block.metadata.rows.length !== 4 ||
    directTableStructureResult.block.metadata.rows[1].cells.some((cell) => cell.textRuns.length !== 0)
  ) {
    throw new Error('表格结构编辑验证失败：模型层没有正确插入空行');
  }

  const directDeleteColumnResult = updateTableStructureByCell(
    directTableStructureResult.block,
    directTableStructureResult.selectedNodeId ?? '',
    'deleteColumn',
  );
  if (
    !directDeleteColumnResult.didUpdate ||
    directDeleteColumnResult.block.metadata.kind !== 'table' ||
    directDeleteColumnResult.block.metadata.align.length !== 2 ||
    directDeleteColumnResult.block.metadata.rows.some((row) => row.cells.length !== 2)
  ) {
    throw new Error('表格结构编辑验证失败：模型层没有同步删除列和 align');
  }

  useAppStore.getState().updateLayoutNodeText({
    nodeId: firstInsertedTableCell.id,
    text: '保留内容',
  });
  const selectedAfterInsertRowBelow = useAppStore.getState().updateLayoutTableStructure({
    cellId: firstInsertedTableCell.id,
    action: 'insertRowBelow',
  });
  const rowInsertedTableDocument = useAppStore.getState().layoutDocument;
  const rowInsertedTableBlock = rowInsertedTableDocument?.blocks.find(
    (block) => block.id === insertedTableBlock.id,
  );

  if (
    !selectedAfterInsertRowBelow ||
    !rowInsertedTableBlock ||
    rowInsertedTableBlock.metadata.kind !== 'table' ||
    rowInsertedTableBlock.metadata.rows.length !== 4 ||
    rowInsertedTableBlock.metadata.rows[1].cells.some((cell) => cell.textRuns.length !== 0)
  ) {
    throw new Error('表格结构编辑验证失败：store 没有正确插入空行');
  }

  const preservedCellAfterRowInsert =
    rowInsertedTableBlock.metadata.kind === 'table' ? rowInsertedTableBlock.metadata.rows[0].cells[0] : null;
  if (preservedCellAfterRowInsert?.textRuns[0]?.text !== '保留内容') {
    throw new Error('表格结构编辑验证失败：插入行时没有保留原单元格文字');
  }

  const selectedAfterInsertColumnRight = useAppStore.getState().updateLayoutTableStructure({
    cellId: preservedCellAfterRowInsert.id,
    action: 'insertColumnRight',
  });
  const columnInsertedTableDocument = useAppStore.getState().layoutDocument;
  const columnInsertedTableBlock = columnInsertedTableDocument?.blocks.find(
    (block) => block.id === insertedTableBlock.id,
  );

  if (
    !selectedAfterInsertColumnRight ||
    !columnInsertedTableBlock ||
    columnInsertedTableBlock.metadata.kind !== 'table' ||
    columnInsertedTableBlock.metadata.align.length !== 4 ||
    columnInsertedTableBlock.metadata.rows.some((row) => row.cells.length !== 4)
  ) {
    throw new Error('表格结构编辑验证失败：store 没有正确插入列');
  }

  const preservedCellAfterColumnInsert =
    columnInsertedTableBlock.metadata.kind === 'table' ? columnInsertedTableBlock.metadata.rows[0].cells[0] : null;
  if (preservedCellAfterColumnInsert?.textRuns[0]?.text !== '保留内容') {
    throw new Error('表格结构编辑验证失败：插入列时没有保留原单元格文字');
  }

  const selectedAfterDeleteRow = useAppStore.getState().updateLayoutTableStructure({
    cellId: selectedAfterInsertColumnRight,
    action: 'deleteRow',
  });
  const rowDeletedTableBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === insertedTableBlock.id);
  if (
    !selectedAfterDeleteRow ||
    !rowDeletedTableBlock ||
    rowDeletedTableBlock.metadata.kind !== 'table' ||
    rowDeletedTableBlock.metadata.rows.length !== 3
  ) {
    throw new Error('表格结构编辑验证失败：store 没有正确删除当前行');
  }

  const selectedAfterDeleteColumn = useAppStore.getState().updateLayoutTableStructure({
    cellId: selectedAfterDeleteRow,
    action: 'deleteColumn',
  });
  const columnDeletedTableBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === insertedTableBlock.id);
  if (
    !selectedAfterDeleteColumn ||
    !columnDeletedTableBlock ||
    columnDeletedTableBlock.metadata.kind !== 'table' ||
    columnDeletedTableBlock.metadata.align.length !== 3 ||
    columnDeletedTableBlock.metadata.rows.some((row) => row.cells.length !== 3)
  ) {
    throw new Error('表格结构编辑验证失败：store 没有正确删除当前列');
  }

  const singleCellTable = insertTableBlockAfterNode([], {
    rowCount: 1,
    columnCount: 1,
  });
  const singleCellBlock = singleCellTable.blocks[0];
  const singleCellId =
    singleCellBlock.metadata.kind === 'table' ? singleCellBlock.metadata.rows[0].cells[0].id : '';
  const protectedRowDelete = updateTableStructureByCell(singleCellBlock, singleCellId, 'deleteRow');
  const protectedColumnDelete = updateTableStructureByCell(singleCellBlock, singleCellId, 'deleteColumn');
  if (protectedRowDelete.didUpdate || protectedColumnDelete.didUpdate) {
    throw new Error('表格结构编辑验证失败：不应允许删除最后一行或最后一列');
  }

  const splitTableDocument = await createLayoutDocumentFromMarkdown([
    '| 表头一 | 表头二 |',
    '| :--- | :---: |',
    ...Array.from({ length: 12 }, (_, index) => `| 第 ${index + 1} 行 | 内容 ${index + 1} |`),
  ].join('\n'));
  const splitTableBlock = splitTableDocument.blocks.find(
    (block) => block.type === 'table' && block.metadata.kind === 'table',
  );

  if (!splitTableBlock || splitTableBlock.metadata.kind !== 'table') {
    throw new Error('表格分页验证失败：未找到可用于分页的长表格');
  }

  const originalSplitTableRowCount = splitTableBlock.metadata.rows.length;
  const tinyTableContract = {
    ...contract,
    contentHeightPx: 150,
  };
  const splitTablePages = paginateBlocks(splitTableDocument.blocks, tinyTableContract);
  const splitTableFragments = splitTablePages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'table' && block.metadata.kind === 'table');
  const secondTableFragment = splitTableFragments[1];
  const secondFragmentHeaderText =
    secondTableFragment?.metadata.kind === 'table'
      ? secondTableFragment.metadata.rows[0]?.cells
          .map((cell) => cell.textRuns.map((run) => run.text).join(''))
          .join('|')
      : '';

  if (splitTableFragments.length < 2) {
    throw new Error(`表格分页验证失败：长表格应拆成多个分页片段，实际得到 ${splitTableFragments.length} 个`);
  }

  if (
    !secondTableFragment ||
    secondTableFragment.metadata.kind !== 'table' ||
    !secondTableFragment.metadata.rows[0]?.cells.every((cell) => cell.isHeader) ||
    secondFragmentHeaderText !== '表头一|表头二'
  ) {
    throw new Error('表格分页验证失败：续页表格没有自动补上首行表头');
  }

  if (splitTableBlock.metadata.rows.length !== originalSplitTableRowCount) {
    throw new Error('表格分页验证失败：分页运行时不应改写原始表格行数');
  }

  if (updatedListItem.sourceRange !== null || updatedListItem.textRuns[0]?.text !== '新列表项') {
    throw new Error('画布文字编辑验证失败：列表项文字没有写回 TextRun');
  }

  if (updatedTableCell.sourceRange !== null || updatedTableCell.textRuns[0]?.text !== '新单元格') {
    throw new Error('画布文字编辑验证失败：表格单元格文字没有写回 TextRun');
  }

  const equationBlock: LayoutBlock = {
    id: 'equation-smoke',
    type: 'equation',
    sourceRange: null,
    blockStyleRef: 'equation',
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'equation',
      value: 'x=1',
    },
  };
  const updatedEquation = updateLayoutBlockText(equationBlock, 'E=mc^2');

  if (updatedEquation.metadata.kind !== 'equation' || updatedEquation.metadata.value !== 'E=mc^2') {
    throw new Error('画布文字编辑验证失败：公式文本没有写回 metadata');
  }

  const legacySyntaxDocument = await createLayoutDocumentFromMarkdown('第一页\n\n<!-- pagebreak -->\n\n第二页');
  if (legacySyntaxDocument.blocks.some((block) => block.type === 'pageBreak')) {
    throw new Error('手动分页符验证失败：旧注释语法不应再触发分页');
  }

  const oversizedSource = [
    '```txt',
    ...Array.from({ length: 60 }, (_, index) => `第 ${index + 1} 行超长代码内容，用于触发超高块排版告警`),
    '```',
    '',
  ].join('\n');
  const oversizedDocument = await createLayoutDocumentFromMarkdown(oversizedSource);
  const oversizedPages = paginateBlocks(oversizedDocument.blocks, contract);
  const oversizedWarnings = oversizedPages.flatMap((page) => page.warnings);

  if (oversizedWarnings.length < 2) {
    throw new Error(`排版告警验证失败：期望至少 2 条告警，实际得到 ${oversizedWarnings.length} 条`);
  }

  if (!oversizedWarnings.some((warning) => warning.type === 'oversizedBlock')) {
    throw new Error('排版告警验证失败：缺少“超高块”告警');
  }

  if (!oversizedWarnings.some((warning) => warning.type === 'forcedOverflow')) {
    throw new Error('排版告警验证失败：缺少“强制溢出”告警');
  }

  const balancedPages = paginateBlocks(layoutDocument.blocks, contract, {
    algorithmId: ESTIMATED_GREEDY_BALANCED_PAGINATION_ALGORITHM_ID,
  });
  if (balancedPages.length < 2) {
    throw new Error('分页算法切换验证失败：平衡算法未能正常输出分页结果');
  }

  const balancingStyleSettings = cloneStyleSettings(defaultStyleSettings);
  balancingStyleSettings.pageSize = 'B5';
  balancingStyleSettings.marginMode = 'custom';
  balancingStyleSettings.customMarginsMm = { top: 36, right: 24, bottom: 36, left: 24 };
  balancingStyleSettings.headerFooterMode = 'custom';
  balancingStyleSettings.customHeaderReservedMm = 24;
  balancingStyleSettings.customFooterReservedMm = 24;
  const balancingContract = resolveStyleContract(balancingStyleSettings);
  const balancingTestDocument = await createLayoutDocumentFromMarkdown([
    '# 页尾平衡测试',
    '',
    '这是一段比较长的中文文本，用来让分页算法进入页尾平衡判断。'.repeat(4),
    '',
    '这是一段比较长的中文文本，用来让分页算法进入页尾平衡判断。'.repeat(4),
    '',
    '这是一段比较长的中文文本，用来让分页算法进入页尾平衡判断。'.repeat(4),
    '',
    '这是一段比较长的中文文本，用来让分页算法进入页尾平衡判断。'.repeat(4),
  ].join('\n'));
  const greedyPages = paginateBlocks(balancingTestDocument.blocks, balancingContract, {
    algorithmId: ESTIMATED_GREEDY_PAGINATION_ALGORITHM_ID,
  });
  const balancedV1Pages = paginateBlocks(balancingTestDocument.blocks, balancingContract, {
    algorithmId: ESTIMATED_GREEDY_BALANCED_PAGINATION_ALGORITHM_ID,
  });
  const balancedV2Pages = paginateBlocks(balancingTestDocument.blocks, balancingContract, {
    algorithmId: ESTIMATED_GREEDY_BALANCED_V2_PAGINATION_ALGORITHM_ID,
  });

  if (balancedV2Pages.length < 2) {
    throw new Error('页尾平衡 V2 验证失败：未能正常输出分页结果');
  }

  if (balancedV2Pages.length > greedyPages.length + 1) {
    throw new Error('页尾平衡 V2 验证失败：分页页数异常增加');
  }

  const greedyLastPageFill = greedyPages[greedyPages.length - 1]?.blocks.length ?? 0;
  const balancedV2LastPageFill = balancedV2Pages[balancedV2Pages.length - 1]?.blocks.length ?? 0;
  if (balancedV2LastPageFill < greedyLastPageFill) {
    throw new Error(
      `页尾平衡 V2 验证失败：V2 的最后一页不应比 greedy 更空，greedy=${greedyLastPageFill}，V2=${balancedV2LastPageFill}`,
    );
  }

  if (balancedV2Pages.length !== balancedV1Pages.length && balancedV2LastPageFill === greedyLastPageFill) {
    throw new Error(
      `页尾平衡 V2 验证失败：当页数未改善时，V2 不应仅增加复杂度，V1=${balancedV1Pages.length}，V2=${balancedV2Pages.length}`,
    );
  }

  // 这一组用例专门卡住“页尾是图片、下一页起始是整块表格”时 V2 过度保守的问题。
  const complexTailBalanceDocument = await createLayoutDocumentFromMarkdown([
    '![图示一](example-1.png)',
    '',
    '![图示二](example-2.png)',
    '',
    '![图示三](example-3.png)',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '| 3 | 4 |',
  ].join('\n'));
  const complexTailGreedyPages = paginateBlocks(complexTailBalanceDocument.blocks, contract, {
    algorithmId: ESTIMATED_GREEDY_PAGINATION_ALGORITHM_ID,
  });
  const complexTailBalancedV1Pages = paginateBlocks(complexTailBalanceDocument.blocks, contract, {
    algorithmId: ESTIMATED_GREEDY_BALANCED_PAGINATION_ALGORITHM_ID,
  });
  const complexTailBalancedV2Pages = paginateBlocks(complexTailBalanceDocument.blocks, contract, {
    algorithmId: ESTIMATED_GREEDY_BALANCED_V2_PAGINATION_ALGORITHM_ID,
  });

  const complexTailGreedyFirstPageFill = complexTailGreedyPages[0]?.blocks.length ?? 0;
  const complexTailV1FirstPageFill = complexTailBalancedV1Pages[0]?.blocks.length ?? 0;
  const complexTailV2FirstPageFill = complexTailBalancedV2Pages[0]?.blocks.length ?? 0;
  const complexTailV2SecondPageSignature =
    complexTailBalancedV2Pages[1]?.blocks.map((block) => `${block.type}:${block.metadata.kind}`).join('|') ?? '';

  if (complexTailBalancedV2Pages.length !== complexTailBalancedV1Pages.length) {
    throw new Error(
      `页尾平衡 V2 回归验证失败：复杂尾块场景页数应与 V1 保持一致，V1=${complexTailBalancedV1Pages.length}，V2=${complexTailBalancedV2Pages.length}`,
    );
  }

  if (complexTailV2FirstPageFill !== complexTailV1FirstPageFill) {
    throw new Error(
      `页尾平衡 V2 回归验证失败：复杂尾块场景首屏填充应与 V1 一致，V1=${complexTailV1FirstPageFill}，V2=${complexTailV2FirstPageFill}`,
    );
  }

  if (complexTailV2FirstPageFill >= complexTailGreedyFirstPageFill) {
    throw new Error(
      `页尾平衡 V2 回归验证失败：复杂尾块场景下 V2 不应退回 greedy 的过满首页，greedy=${complexTailGreedyFirstPageFill}，V2=${complexTailV2FirstPageFill}`,
    );
  }

  if (complexTailV2SecondPageSignature !== 'image:image|table:table') {
    throw new Error(
      `页尾平衡 V2 回归验证失败：复杂尾块场景第二页应保留“图片 + 表格”组合，实际得到 ${complexTailV2SecondPageSignature || '空页'}`,
    );
  }

  await fs.mkdir(outputDir, { recursive: true });
  await runElectronExport(html);

  const stat = await fs.stat(outputPath);
  console.log(
    JSON.stringify({ pages: pages.length, blocks: layoutDocument.blocks.length, outputPath, bytes: stat.size }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
