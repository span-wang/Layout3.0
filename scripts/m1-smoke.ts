import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  applyPageNumbersToTocItems,
  applyAnswerAnnotationToBlock,
  applyBlockStyleOverridesToBlock,
  applyTextStyleToBlock,
  clearTextFormattingInTextRuns,
  buildHeadingPageNumberMap,
  buildTocItems,
  createLayoutDocumentFromMarkdown,
  estimateImageVisibleHeightPx,
  getLayoutBlockPlainText,
  insertEquationBlockAfterNode,
  insertListBlockAfterNode,
  insertTableBlockAfterNode,
  insertTocBlockAfterNode,
  updateBlockquoteStructureByNode,
  updateListItemCheckedByItem,
  updateListOrderedByItem,
  updateListStartByItem,
  updateListStructureByItem,
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
import { formulaTemplateGroups } from '../src/constants/formulaTemplates.ts';
import { resolveStyleContract } from '../src/engine/style/resolveContract.ts';
import { cloneStyleSettings } from '../src/engine/style/styleSettings.ts';
import { getBlockStyleSourceSummary, resolveBlockDefaultTextMetrics } from '../src/engine/style/blockStyleResolution.ts';
import { buildExportHtml } from '../src/services/exportHtml.ts';
import { getBlockStyleControlSupportByBlockType } from '../src/components/layout/objectStyleSupport.ts';
import {
  MAX_FILL_PAGINATION_ALGORITHM_ID,
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

  const headingPageNumberMap = buildHeadingPageNumberMap(pages);
  const tocItemsWithPageNumbers = applyPageNumbersToTocItems(tocItems, headingPageNumberMap);

  if (headingPageNumberMap[tocItems[0]?.id ?? ''] !== 1 || headingPageNumberMap[tocItems[1]?.id ?? ''] !== 2) {
    throw new Error('文档大纲验证失败：标题页码映射没有按分页结果正确回填');
  }

  if (tocItemsWithPageNumbers[0]?.pageNumber !== 1 || tocItemsWithPageNumbers[1]?.pageNumber !== 2) {
    throw new Error('文档大纲验证失败：大纲项页码没有被正确写回运行时数据');
  }

  const tocBlockResult = insertTocBlockAfterNode(layoutDocument.blocks, {
    insertAfterNodeId: null,
  });
  const tocBlock = tocBlockResult.blocks.find((block) => block.type === 'toc');
  const tocInsertedPageBreak = tocBlockResult.blocks[1];

  if (!tocBlock || tocBlock.metadata.kind !== 'toc') {
    throw new Error('目录块验证失败：未能插入目录块');
  }

  if (tocBlock.metadata.title !== '目录') {
    throw new Error('目录块验证失败：目录块默认标题不正确');
  }

  if (tocBlockResult.blocks[0]?.type !== 'toc') {
    throw new Error('目录块验证失败：目录块没有被插入到文档最前面');
  }

  if (
    !tocInsertedPageBreak ||
    tocInsertedPageBreak.type !== 'pageBreak' ||
    tocInsertedPageBreak.metadata.kind !== 'pageBreak'
  ) {
    throw new Error('目录块验证失败：目录块后没有自动追加手动分页符');
  }

  const replacedTocBlockResult = insertTocBlockAfterNode(tocBlockResult.blocks, {
    insertAfterNodeId: null,
  });
  const replacedTocBlocks = replacedTocBlockResult.blocks.filter((block) => block.type === 'toc');
  const replacedPageBreakBlocks = replacedTocBlockResult.blocks.filter((block) => block.type === 'pageBreak');

  if (replacedTocBlocks.length !== 1) {
    throw new Error('目录块验证失败：重复插入目录时不应堆叠出第二个目录块');
  }

  if (replacedPageBreakBlocks.length !== 2) {
    throw new Error('目录块验证失败：重复插入目录后分页符数量不符合预期');
  }

  if (replacedTocBlockResult.blocks[0]?.type !== 'toc' || replacedTocBlockResult.blocks[1]?.type !== 'pageBreak') {
    throw new Error('目录块验证失败：重复插入目录后最前面的自动目录组没有被正确替换');
  }

  if (tocBlock.metadata.maxDepth !== 3) {
    throw new Error('目录块验证失败：目录块默认层级应为 H1-H3');
  }

  const filteredTocDepth2 = tocItemsWithPageNumbers.filter((item) => item.depth <= 2);
  const filteredTocDepth1 = tocItemsWithPageNumbers.filter((item) => item.depth <= 1);

  if (filteredTocDepth2.length !== 2) {
    throw new Error('目录层级验证失败：H1-H2 过滤结果不符合预期');
  }

  if (filteredTocDepth1.length !== 1 || filteredTocDepth1[0]?.depth !== 1) {
    throw new Error('目录层级验证失败：仅 H1 过滤结果不符合预期');
  }

  const refreshableTocDocument = {
    ...layoutDocument,
    blocks: replacedTocBlockResult.blocks,
    meta: {
      ...layoutDocument.meta,
      blockCount: replacedTocBlockResult.blocks.length,
    },
  };
  useAppStore.getState().loadDocument({
    title: refreshableTocDocument.title,
    filePath: null,
    source: refreshableTocDocument.source,
    documentFormat: 'layout',
    layoutDocument: refreshableTocDocument,
  });
  const tocRefreshEpochBefore = useAppStore.getState().documentEpoch;
  const refreshedToc = useAppStore.getState().refreshLayoutTocBlock({
    nodeId: replacedTocBlockResult.blocks[0]?.id ?? '',
  });
  const tocRefreshState = useAppStore.getState();

  if (!refreshedToc) {
    throw new Error('目录刷新验证失败：当前目录块没有成功触发刷新动作');
  }

  if (tocRefreshState.documentEpoch !== tocRefreshEpochBefore + 1) {
    throw new Error('目录刷新验证失败：刷新目录后没有触发新的文档轮次');
  }

  if (tocRefreshState.isDirty) {
    throw new Error('目录刷新验证失败：手动刷新目录不应把文档标记为未保存');
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
  customizedStyleSettings.paginationAlgorithmId = MAX_FILL_PAGINATION_ALGORITHM_ID;
  const serializedProjectFile = serializeLayoutProjectFile({
    document: layoutDocument,
    styleSettings: customizedStyleSettings,
  });
  const restoredProject = parseLayoutProjectFile(serializedProjectFile);
  const restoredLegacyAlgorithmProject = parseLayoutProjectFile(
    JSON.stringify(
      {
        ...JSON.parse(serializedProjectFile),
        styleSettings: {
          ...JSON.parse(serializedProjectFile).styleSettings,
          paginationAlgorithmId: 'estimated-cost-v1',
        },
      },
      null,
      2,
    ),
  );

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
  if (algorithmIds.length !== 1 || algorithmIds[0] !== MAX_FILL_PAGINATION_ALGORITHM_ID) {
    throw new Error(`分页算法注册验证失败：当前应只保留分页测试算法1，实际为 ${algorithmIds.join(', ') || '空'}`);
  }

  if (restoredLegacyAlgorithmProject.styleSettings.paginationAlgorithmId !== MAX_FILL_PAGINATION_ALGORITHM_ID) {
    throw new Error('layout 工程文件验证失败：旧分页算法 ID 没有回退到分页测试算法1');
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

  const zeroSpacingParagraph = applyBlockStyleOverridesToBlock(blockStyledParagraph, {
    spaceBefore: 0,
    spaceAfter: 0,
  });

  if (zeroSpacingParagraph.blockStyleOverrides.spaceBefore !== 0 || zeroSpacingParagraph.blockStyleOverrides.spaceAfter !== 0) {
    throw new Error('样式优先级验证失败：块级样式的 0 覆盖不应被当成空值忽略');
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

  const zeroSpacingHtml = buildExportHtml({
    pages: paginateBlocks([zeroSpacingParagraph], contract),
    title: '零间距验证',
  });

  if (!zeroSpacingHtml.includes('margin-top:0px') || !zeroSpacingHtml.includes('margin-bottom:0px')) {
    throw new Error('样式优先级验证失败：导出 HTML 没有正确消费 0 值段前段后距');
  }

  const restoredStyledParagraph = restoredStyledProject.document.blocks.find(
    (block) => block.id === blockStyledParagraph.id,
  );
  if (!restoredStyledParagraph || restoredStyledParagraph.blockStyleOverrides.spaceAfter !== 26) {
    throw new Error('样式编辑验证失败：`.layout` 工程文件没有恢复段后距样式');
  }

  const notesStyleSettings = cloneStyleSettings(defaultStyleSettings);
  notesStyleSettings.templateId = 'notes';
  const notesContract = resolveStyleContract(notesStyleSettings);
  const noteParagraph = styleEditingDocument.blocks.find((block) => block.type === 'paragraph');
  if (!noteParagraph) {
    throw new Error('样式优先级验证失败：未找到用于模板基线验证的段落块');
  }

  const noteDefaultMetrics = resolveBlockDefaultTextMetrics(noteParagraph, notesContract);
  const noteSourceSummary = getBlockStyleSourceSummary(noteParagraph, notesContract);

  if (noteDefaultMetrics.fontSize !== notesContract.blockStyles.paragraph.fontSize) {
    throw new Error('样式优先级验证失败：模板基线字号没有按模板解析结果返回');
  }

  if (!noteSourceSummary.includes('模板基线') || !noteSourceSummary.includes('局部覆盖')) {
    throw new Error('样式优先级验证失败：块级样式来源摘要没有清楚说明模板与局部覆盖关系');
  }

  const notesStyledHtml = buildExportHtml({
    pages: paginateBlocks(styledDocument.blocks, notesContract),
    title: `${styledDocument.title}（笔记模板）`,
  });

  if (!notesStyledHtml.includes(`--page-paragraph-font-size:${notesContract.blockStyles.paragraph.fontSize}px`)) {
    throw new Error('样式优先级验证失败：导出 HTML 没有注入模板基线变量');
  }

  if (
    !notesStyledHtml.includes(`font-size:${notesContract.blockStyles.paragraph.fontSize}px`) ||
    !notesStyledHtml.includes(`line-height:${notesContract.blockStyles.paragraph.lineHeight}px`)
  ) {
    throw new Error('样式优先级验证失败：导出 HTML 没有消费笔记模板的段落基线');
  }

  const clearedStyledParagraph = clearTextFormattingInTextRuns(
    blockStyledParagraph.textRuns,
    blockStyledParagraph.id,
    { start: 0, end: 4 },
  );

  if (clearedStyledParagraph.some((run) => run.styleOverrides.fontSize !== undefined)) {
    throw new Error('样式优先级验证失败：清除文字格式不应保留文字字号覆盖');
  }

  const paragraphStyleSupport = getBlockStyleControlSupportByBlockType('paragraph');
  const codeStyleSupport = getBlockStyleControlSupportByBlockType('code');
  const listStyleSupport = getBlockStyleControlSupportByBlockType('list');
  const tableStyleSupport = getBlockStyleControlSupportByBlockType('table');
  const equationStyleSupport = getBlockStyleControlSupportByBlockType('equation');

  if (
    !paragraphStyleSupport ||
    !paragraphStyleSupport.supportsIndentLeft ||
    !paragraphStyleSupport.supportsIndentRight ||
    !paragraphStyleSupport.supportsFirstLineIndent ||
    !paragraphStyleSupport.supportsHangingIndent
  ) {
    throw new Error('样式入口收口验证失败：标题/段落应继续保留完整缩进体系入口');
  }

  if (
    !codeStyleSupport ||
    !codeStyleSupport.supportsTextAlign ||
    !codeStyleSupport.supportsLineHeight ||
    !codeStyleSupport.supportsSpaceBefore ||
    !codeStyleSupport.supportsSpaceAfter ||
    codeStyleSupport.supportsIndentLeft ||
    codeStyleSupport.supportsIndentRight ||
    codeStyleSupport.supportsFirstLineIndent ||
    codeStyleSupport.supportsHangingIndent
  ) {
    throw new Error('样式入口收口验证失败：代码块应只保留当前稳定支持的块级样式入口');
  }

  if (
    !listStyleSupport ||
    !listStyleSupport.supportsTextAlign ||
    !listStyleSupport.supportsLineHeight ||
    !listStyleSupport.supportsSpaceBefore ||
    !listStyleSupport.supportsSpaceAfter ||
    listStyleSupport.supportsIndentLeft ||
    listStyleSupport.supportsIndentRight ||
    listStyleSupport.supportsFirstLineIndent ||
    listStyleSupport.supportsHangingIndent
  ) {
    throw new Error('样式入口收口验证失败：列表应只保留当前稳定支持的块级样式入口');
  }

  if (
    !tableStyleSupport ||
    tableStyleSupport.supportsTextAlign ||
    !tableStyleSupport.supportsLineHeight ||
    !tableStyleSupport.supportsSpaceBefore ||
    !tableStyleSupport.supportsSpaceAfter ||
    tableStyleSupport.supportsIndentLeft ||
    tableStyleSupport.supportsIndentRight ||
    tableStyleSupport.supportsFirstLineIndent ||
    tableStyleSupport.supportsHangingIndent
  ) {
    throw new Error('样式入口收口验证失败：表格应只保留行高和段前段后距入口');
  }

  if (equationStyleSupport !== null) {
    throw new Error('样式入口收口验证失败：公式块当前不应暴露块级样式入口');
  }

  const scopedBlockStyleDocument = await createLayoutDocumentFromMarkdown([
    '```txt',
    '代码块样式验证',
    '```',
    '',
    '- 列表样式验证',
    '',
    '| 列 1 |',
    '| --- |',
    '| 单元格 |',
  ].join('\n'));
  const scopedCodeBlock = scopedBlockStyleDocument.blocks.find((block) => block.type === 'code');
  const scopedListBlock = scopedBlockStyleDocument.blocks.find(
    (block) => block.type === 'list' && block.metadata.kind === 'list',
  );
  const scopedTableBlock = scopedBlockStyleDocument.blocks.find(
    (block) => block.type === 'table' && block.metadata.kind === 'table',
  );

  if (!scopedCodeBlock || !scopedListBlock || !scopedTableBlock) {
    throw new Error('样式入口收口验证失败：未找到代码块、列表或表格测试块');
  }

  const exportableCodeBlock = applyBlockStyleOverridesToBlock(scopedCodeBlock, {
    textAlign: 'right',
    lineHeight: 34,
    spaceBefore: 12,
    spaceAfter: 18,
  });
  const exportableListBlock = applyBlockStyleOverridesToBlock(scopedListBlock, {
    textAlign: 'center',
    lineHeight: 30,
    spaceBefore: 10,
    spaceAfter: 16,
  });
  const exportableTableBlock = applyBlockStyleOverridesToBlock(scopedTableBlock, {
    lineHeight: 32,
    spaceBefore: 14,
    spaceAfter: 20,
  });
  const scopedBlockStyleHtml = buildExportHtml({
    pages: paginateBlocks([exportableCodeBlock, exportableListBlock, exportableTableBlock], contract),
    title: '块级样式收口验证',
  });

  if (
    !scopedBlockStyleHtml.includes('text-align:right') ||
    !scopedBlockStyleHtml.includes('line-height:34px') ||
    !scopedBlockStyleHtml.includes('margin-top:12px') ||
    !scopedBlockStyleHtml.includes('margin-bottom:18px')
  ) {
    throw new Error('样式入口收口验证失败：代码块的稳定样式项没有正确导出');
  }

  if (
    !scopedBlockStyleHtml.includes('text-align:center') ||
    !scopedBlockStyleHtml.includes('line-height:30px') ||
    !scopedBlockStyleHtml.includes('margin-top:10px') ||
    !scopedBlockStyleHtml.includes('margin-bottom:16px')
  ) {
    throw new Error('样式入口收口验证失败：列表的稳定样式项没有正确导出');
  }

  if (
    !scopedBlockStyleHtml.includes('<table style="line-height:32px;margin-top:14px;margin-bottom:20px">')
  ) {
    throw new Error('样式入口收口验证失败：表格的稳定样式项没有正确导出');
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

  const croppedImageBlock = updateLayoutImageAttributes(editableImage, {
    src: editableImage.metadata.src,
    alt: editableImage.metadata.alt,
    title: editableImage.metadata.title,
    widthPx: 240,
    heightPx: 160,
    cropTopPx: 10,
    cropRightPx: 20,
    cropBottomPx: 30,
    cropLeftPx: 40,
  });
  const croppedImageHtml = buildExportHtml({
    pages: paginateBlocks([croppedImageBlock], contract),
    title: '图片裁剪导出验证',
  });

  if (croppedImageHtml.includes('image-frame')) {
    throw new Error('图片裁剪导出验证失败：导出结果仍然残留旧的图片框类名');
  }

  if (!croppedImageHtml.includes('class="image-viewport"')) {
    throw new Error('图片裁剪导出验证失败：导出结果没有输出新的图片可见区容器');
  }

  if (!croppedImageHtml.includes('style="width:180px;height:120px"')) {
    throw new Error('图片裁剪导出验证失败：裁剪后的图片可见尺寸没有正确输出到导出 HTML');
  }

  if (!croppedImageHtml.includes('transform:translate(-40px, -10px)')) {
    throw new Error('图片裁剪导出验证失败：裁剪后的图片内容偏移没有正确输出到导出 HTML');
  }

  if (estimateImageVisibleHeightPx(croppedImageBlock.metadata, 220) !== 120) {
    throw new Error('图片裁剪分页验证失败：裁剪后的图片可见高度没有按新口径参与估算');
  }

  const directOrderedListResult = updateListOrderedByItem(editableList, editableList.metadata.items[0].id, true);
  if (
    !directOrderedListResult.didUpdate ||
    directOrderedListResult.block.metadata.kind !== 'list' ||
    !directOrderedListResult.block.metadata.ordered ||
    directOrderedListResult.block.metadata.start !== 1 ||
    directOrderedListResult.selectedNodeId !== editableList.metadata.items[0].id
  ) {
    throw new Error('列表属性编辑验证失败：模型层没有正确切换为有序列表并设置默认起始编号');
  }

  const directListStartResult = updateListStartByItem(
    directOrderedListResult.block,
    editableList.metadata.items[0].id,
    5,
  );
  if (
    !directListStartResult.didUpdate ||
    directListStartResult.block.metadata.kind !== 'list' ||
    directListStartResult.block.metadata.start !== 5
  ) {
    throw new Error('列表属性编辑验证失败：模型层没有正确设置有序列表起始编号');
  }

  const directListInsertResult = updateListStructureByItem(
    directListStartResult.block,
    editableList.metadata.items[0].id,
    'insertItemBelow',
  );
  if (
    !directListInsertResult.didUpdate ||
    directListInsertResult.block.metadata.kind !== 'list' ||
    directListInsertResult.block.metadata.items.length !== 2 ||
    directListInsertResult.block.metadata.items[1].textRuns.length !== 0 ||
    directListInsertResult.selectedNodeId !== directListInsertResult.block.metadata.items[1].id
  ) {
    throw new Error('列表结构编辑验证失败：模型层没有正确插入空列表项并选中新项');
  }

  const directListDeleteResult = updateListStructureByItem(
    directListInsertResult.block,
    directListInsertResult.selectedNodeId ?? '',
    'deleteItem',
  );
  if (
    !directListDeleteResult.didUpdate ||
    directListDeleteResult.block.metadata.kind !== 'list' ||
    directListDeleteResult.block.metadata.items.length !== 1 ||
    directListDeleteResult.selectedNodeId !== editableList.metadata.items[0].id
  ) {
    throw new Error('列表结构编辑验证失败：模型层没有正确删除当前列表项并选中剩余项');
  }

  const protectedListDelete = updateListStructureByItem(
    directListDeleteResult.block,
    editableList.metadata.items[0].id,
    'deleteItem',
  );
  if (protectedListDelete.didUpdate) {
    throw new Error('列表结构编辑验证失败：不应允许删除最后一个列表项');
  }

  const selectedAfterListOrdered = useAppStore.getState().updateLayoutListOrdered({
    itemId: editableList.metadata.items[0].id,
    ordered: true,
  });
  const orderedListBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === editableList.id);
  if (
    selectedAfterListOrdered !== editableList.metadata.items[0].id ||
    !orderedListBlock ||
    orderedListBlock.metadata.kind !== 'list' ||
    !orderedListBlock.metadata.ordered ||
    orderedListBlock.metadata.start !== 1
  ) {
    throw new Error('列表属性编辑验证失败：store 没有正确切换列表类型');
  }

  const selectedAfterListStart = useAppStore.getState().updateLayoutListStart({
    itemId: editableList.metadata.items[0].id,
    start: 7,
  });
  const startedListBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === editableList.id);
  if (
    selectedAfterListStart !== editableList.metadata.items[0].id ||
    !startedListBlock ||
    startedListBlock.metadata.kind !== 'list' ||
    startedListBlock.metadata.start !== 7
  ) {
    throw new Error('列表属性编辑验证失败：store 没有正确设置起始编号');
  }

  const listPropertyHtml = buildExportHtml({
    pages: paginateBlocks(startedListBlock ? [startedListBlock] : [], contract),
    title: '列表属性导出验证',
  });
  if (!listPropertyHtml.includes('<ol start="7"')) {
    throw new Error('列表属性导出验证失败：HTML 没有输出有序列表起始编号');
  }

  const selectedAfterInsertListItem = useAppStore.getState().updateLayoutListStructure({
    itemId: editableList.metadata.items[0].id,
    action: 'insertItemBelow',
  });
  const insertedListItemBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === editableList.id);
  if (
    !selectedAfterInsertListItem ||
    !insertedListItemBlock ||
    insertedListItemBlock.metadata.kind !== 'list' ||
    insertedListItemBlock.metadata.items.length !== 2 ||
    insertedListItemBlock.metadata.items[1].id !== selectedAfterInsertListItem ||
    insertedListItemBlock.metadata.items[1].textRuns.length !== 0
  ) {
    throw new Error('列表结构编辑验证失败：store 没有正确插入空列表项');
  }

  useAppStore.getState().updateLayoutNodeText({
    nodeId: editableList.metadata.items[0].id,
    text: '保留列表项',
  });
  const selectedAfterDeleteListItem = useAppStore.getState().updateLayoutListStructure({
    itemId: selectedAfterInsertListItem,
    action: 'deleteItem',
  });
  const deletedListItemBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === editableList.id);
  if (
    selectedAfterDeleteListItem !== editableList.metadata.items[0].id ||
    !deletedListItemBlock ||
    deletedListItemBlock.metadata.kind !== 'list' ||
    deletedListItemBlock.metadata.items.length !== 1 ||
    deletedListItemBlock.metadata.items[0].textRuns[0]?.text !== '保留列表项'
  ) {
    throw new Error('列表结构编辑验证失败：store 删除列表项后没有保留剩余项文字或选中态');
  }

  const protectedStoreListDelete = useAppStore.getState().updateLayoutListStructure({
    itemId: editableList.metadata.items[0].id,
    action: 'deleteItem',
  });
  if (protectedStoreListDelete !== null) {
    throw new Error('列表结构编辑验证失败：store 不应允许删除最后一个列表项');
  }

  const taskListDocument = await createLayoutDocumentFromMarkdown([
    '- [ ] 待办任务',
    '- [x] 完成任务',
    '- 普通列表项',
  ].join('\n'));
  const taskListBlock = taskListDocument.blocks.find(
    (block) => block.type === 'list' && block.metadata.kind === 'list',
  );

  if (!taskListBlock || taskListBlock.metadata.kind !== 'list' || taskListBlock.metadata.items.length < 3) {
    throw new Error('任务列表勾选验证失败：未找到包含任务项与普通项的列表');
  }

  const uncheckedTaskItem = taskListBlock.metadata.items[0];
  const checkedTaskItem = taskListBlock.metadata.items[1];
  const plainListItem = taskListBlock.metadata.items[2];

  if (uncheckedTaskItem.checked !== false || checkedTaskItem.checked !== true || plainListItem.checked !== null) {
    throw new Error('任务列表勾选验证失败：Markdown 导入没有正确保留 checked 状态');
  }

  const directTaskCheckedResult = updateListItemCheckedByItem(taskListBlock, uncheckedTaskItem.id, true);
  if (
    !directTaskCheckedResult.didUpdate ||
    directTaskCheckedResult.block.metadata.kind !== 'list' ||
    directTaskCheckedResult.block.metadata.items[0].checked !== true ||
    directTaskCheckedResult.selectedNodeId !== uncheckedTaskItem.id
  ) {
    throw new Error('任务列表勾选验证失败：模型层没有正确勾选任务项');
  }

  const directPlainListCheckResult = updateListItemCheckedByItem(taskListBlock, plainListItem.id, true);
  if (
    directPlainListCheckResult.didUpdate ||
    directPlainListCheckResult.block.metadata.kind !== 'list' ||
    directPlainListCheckResult.block.metadata.items[2].checked !== null
  ) {
    throw new Error('任务列表勾选验证失败：普通列表项不应被自动转换成任务项');
  }

  useAppStore.getState().loadDocument({
    title: taskListDocument.title,
    filePath: null,
    source: taskListDocument.source,
    documentFormat: 'layout',
    layoutDocument: taskListDocument,
  });
  const selectedAfterTaskChecked = useAppStore.getState().updateLayoutListItemChecked({
    itemId: uncheckedTaskItem.id,
    checked: true,
  });
  const selectedAfterTaskUnchecked = useAppStore.getState().updateLayoutListItemChecked({
    itemId: checkedTaskItem.id,
    checked: false,
  });
  const selectedAfterPlainListCheck = useAppStore.getState().updateLayoutListItemChecked({
    itemId: plainListItem.id,
    checked: true,
  });
  const checkedTaskListBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === taskListBlock.id);
  if (
    selectedAfterTaskChecked !== uncheckedTaskItem.id ||
    selectedAfterTaskUnchecked !== checkedTaskItem.id ||
    selectedAfterPlainListCheck !== null ||
    !checkedTaskListBlock ||
    checkedTaskListBlock.metadata.kind !== 'list' ||
    checkedTaskListBlock.metadata.items[0].checked !== true ||
    checkedTaskListBlock.metadata.items[1].checked !== false ||
    checkedTaskListBlock.metadata.items[2].checked !== null
  ) {
    throw new Error('任务列表勾选验证失败：store 没有正确写回任务项 checked 状态');
  }

  const taskListHtml = buildExportHtml({
    pages: paginateBlocks([checkedTaskListBlock], contract),
    title: '任务列表勾选导出验证',
  });
  if (
    !taskListHtml.includes('class="task-list-item"') ||
    !taskListHtml.includes('☑') ||
    !taskListHtml.includes('☐')
  ) {
    throw new Error('任务列表勾选导出验证失败：HTML 没有输出任务项勾选状态');
  }

  const blockquoteDocument = await createLayoutDocumentFromMarkdown([
    '> 第一段引用',
    '>',
    '> - 引用列表项',
  ].join('\n'));
  const editableBlockquote = blockquoteDocument.blocks.find(
    (block): block is LayoutBlock & { metadata: { kind: 'blockquote'; blocks: LayoutBlock[] } } =>
      block.type === 'blockquote' && block.metadata.kind === 'blockquote',
  );

  if (!editableBlockquote || editableBlockquote.metadata.blocks.length < 2) {
    throw new Error('引用结构编辑验证失败：未找到可用于结构编辑的引用块');
  }

  const directBlockquoteInsertResult = updateBlockquoteStructureByNode(
    editableBlockquote,
    editableBlockquote.metadata.blocks[1].id,
    'insertParagraphAbove',
  );
  if (
    !directBlockquoteInsertResult.didUpdate ||
    directBlockquoteInsertResult.block.metadata.kind !== 'blockquote' ||
    directBlockquoteInsertResult.block.metadata.blocks.length !== 3
  ) {
    throw new Error('引用结构编辑验证失败：模型层没有正确插入空段落');
  }

  const insertedQuoteParagraph = directBlockquoteInsertResult.block.metadata.blocks[1];
  if (
    directBlockquoteInsertResult.selectedNodeId !== insertedQuoteParagraph.id ||
    insertedQuoteParagraph.type !== 'paragraph' ||
    insertedQuoteParagraph.metadata.kind !== 'paragraph' ||
    insertedQuoteParagraph.metadata.text !== '' ||
    insertedQuoteParagraph.textRuns.length !== 0
  ) {
    throw new Error('引用结构编辑验证失败：插入的引用段落结构不正确或没有自动选中新段落');
  }

  const directBlockquoteDeleteResult = updateBlockquoteStructureByNode(
    directBlockquoteInsertResult.block,
    insertedQuoteParagraph.id,
    'deleteBlock',
  );
  if (
    !directBlockquoteDeleteResult.didUpdate ||
    directBlockquoteDeleteResult.block.metadata.kind !== 'blockquote' ||
    directBlockquoteDeleteResult.block.metadata.blocks.length !== 2 ||
    directBlockquoteDeleteResult.selectedNodeId !== editableBlockquote.metadata.blocks[1].id
  ) {
    throw new Error('引用结构编辑验证失败：模型层删除当前子块后没有正确保留剩余子块或选中态');
  }

  const protectedBlockquoteDelete = updateBlockquoteStructureByNode(
    {
      ...editableBlockquote,
      metadata: {
        ...editableBlockquote.metadata,
        blocks: [editableBlockquote.metadata.blocks[0]],
      },
    },
    editableBlockquote.metadata.blocks[0].id,
    'deleteBlock',
  );
  if (protectedBlockquoteDelete.didUpdate) {
    throw new Error('引用结构编辑验证失败：不应允许删除最后一个引用子块');
  }

  useAppStore.getState().loadDocument({
    title: blockquoteDocument.title,
    filePath: null,
    source: blockquoteDocument.source,
    documentFormat: 'layout',
    layoutDocument: blockquoteDocument,
  });
  const selectedAfterInsertQuoteParagraph = useAppStore.getState().updateLayoutBlockquoteStructure({
    blockquoteId: editableBlockquote.id,
    targetNodeId: editableBlockquote.metadata.blocks[0].id,
    action: 'insertParagraphBelow',
  });
  const insertedBlockquoteStore = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === editableBlockquote.id);
  if (
    !selectedAfterInsertQuoteParagraph ||
    !insertedBlockquoteStore ||
    insertedBlockquoteStore.metadata.kind !== 'blockquote' ||
    insertedBlockquoteStore.metadata.blocks.length !== 3 ||
    insertedBlockquoteStore.metadata.blocks[1]?.id !== selectedAfterInsertQuoteParagraph
  ) {
    throw new Error('引用结构编辑验证失败：store 没有正确插入空段落并选中新段落');
  }

  const selectedAfterDeleteQuoteBlock = useAppStore.getState().updateLayoutBlockquoteStructure({
    blockquoteId: editableBlockquote.id,
    targetNodeId: selectedAfterInsertQuoteParagraph,
    action: 'deleteBlock',
  });
  const deletedBlockquoteStore = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === editableBlockquote.id);
  if (
    selectedAfterDeleteQuoteBlock !== insertedBlockquoteStore.metadata.blocks[2].id ||
    !deletedBlockquoteStore ||
    deletedBlockquoteStore.metadata.kind !== 'blockquote' ||
    deletedBlockquoteStore.metadata.blocks.length !== 2 ||
    getLayoutBlockPlainText(deletedBlockquoteStore.metadata.blocks[1]) !== '引用列表项'
  ) {
    throw new Error('引用结构编辑验证失败：store 删除子块后没有保留剩余内容或选中态');
  }

  const protectedStoreBlockquoteDelete = useAppStore.getState().updateLayoutBlockquoteStructure({
    blockquoteId: editableBlockquote.id,
    targetNodeId: deletedBlockquoteStore?.metadata.kind === 'blockquote' ? deletedBlockquoteStore.metadata.blocks[0].id : '',
    action: 'deleteBlock',
  });
  if (protectedStoreBlockquoteDelete !== null && deletedBlockquoteStore?.metadata.kind === 'blockquote' && deletedBlockquoteStore.metadata.blocks.length <= 1) {
    throw new Error('引用结构编辑验证失败：store 不应允许删除最后一个引用子块');
  }

  const blockquoteHtml = buildExportHtml({
    pages: paginateBlocks(deletedBlockquoteStore ? [deletedBlockquoteStore] : [], contract),
    title: '引用结构导出验证',
  });
  if (!blockquoteHtml.includes('<blockquote>') || !blockquoteHtml.includes('引用列表项')) {
    throw new Error('引用结构导出验证失败：HTML 没有正确保留引用容器和剩余子块内容');
  }

  useAppStore.getState().loadDocument({
    title: canvasNodeEditDocument.title,
    filePath: null,
    source: canvasNodeEditDocument.source,
    documentFormat: 'layout',
    layoutDocument: canvasNodeEditDocument,
  });

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

  useAppStore.getState().loadDocument({
    title: canvasNodeEditDocument.title,
    filePath: null,
    source: canvasNodeEditDocument.source,
    documentFormat: 'layout',
    layoutDocument: canvasNodeEditDocument,
  });
  useAppStore.getState().selectLayoutNode(editableImage.id);
  const aiMarkdownInsertedNodeId = await useAppStore.getState().insertLayoutMarkdownBlocks({
    markdown: [
      '# AI 生成标题',
      '',
      '这是一段 AI 生成的正文，包含 **加粗** 内容。',
      '',
      '| 名称 | 数值 |',
      '| --- | --- |',
      '| 甲 | 1 |',
      '',
      '$$',
      'x^2 + 1 = 0',
      '$$',
      '',
      '- 第一项',
      '- 第二项',
    ].join('\n'),
  });
  const aiMarkdownDocument = useAppStore.getState().layoutDocument;
  const originalSelectedIndex =
    aiMarkdownDocument?.blocks.findIndex((block) => block.id === editableImage.id) ?? -1;
  const aiInsertedIndex =
    aiMarkdownDocument?.blocks.findIndex((block) => block.id === aiMarkdownInsertedNodeId) ?? -1;
  const aiInsertedBlocks = aiMarkdownDocument?.blocks.slice(aiInsertedIndex, aiInsertedIndex + 5) ?? [];

  if (!aiMarkdownInsertedNodeId || aiInsertedIndex !== originalSelectedIndex + 1) {
    throw new Error('AI Markdown 插入验证失败：结构化内容没有插入到当前选中块之后');
  }

  if (
    aiInsertedBlocks[0]?.type !== 'heading' ||
    !aiInsertedBlocks.some((block) => block.type === 'table') ||
    !aiInsertedBlocks.some((block) => block.type === 'equation') ||
    !aiInsertedBlocks.some((block) => block.type === 'list')
  ) {
    throw new Error('AI Markdown 插入验证失败：标题、表格、公式或列表没有进入结构化块');
  }

  if (
    aiInsertedBlocks.length === 1 &&
    aiInsertedBlocks[0]?.type === 'paragraph' &&
    getLayoutBlockPlainText(aiInsertedBlocks[0]).includes('| --- |')
  ) {
    throw new Error('AI Markdown 插入验证失败：Markdown 源码仍被当作单个普通段落写入');
  }

  if (
    aiMarkdownDocument?.viewState.selectedNodeId !== aiMarkdownInsertedNodeId ||
    useAppStore.getState().documentHistoryPast.length === 0 ||
    !useAppStore.getState().isDirty
  ) {
    throw new Error('AI Markdown 插入验证失败：插入后没有正确更新选中态、撤销栈或未保存状态');
  }

  useAppStore.getState().loadDocument({
    title: canvasNodeEditDocument.title,
    filePath: null,
    source: canvasNodeEditDocument.source,
    documentFormat: 'layout',
    layoutDocument: canvasNodeEditDocument,
  });

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

  const directUnorderedListResult = insertListBlockAfterNode(insertedTableDocument?.blocks ?? [], {
    kind: 'unordered',
    insertAfterNodeId: selectedTableNodeId,
  });
  const directUnorderedListBlock = directUnorderedListResult.blocks.find(
    (block) => block.id === directUnorderedListResult.insertedBlockId,
  );
  if (
    !directUnorderedListBlock ||
    directUnorderedListBlock.type !== 'list' ||
    directUnorderedListBlock.metadata.kind !== 'list' ||
    directUnorderedListBlock.metadata.ordered ||
    directUnorderedListBlock.metadata.start !== null ||
    directUnorderedListBlock.metadata.items.length !== 1 ||
    directUnorderedListBlock.metadata.items[0].checked !== null ||
    directUnorderedListResult.selectedNodeId !== directUnorderedListBlock.metadata.items[0].id
  ) {
    throw new Error('列表插入验证失败：模型层没有正确生成默认无序列表');
  }

  const directOrderedListInsertResult = insertListBlockAfterNode(directUnorderedListResult.blocks, {
    kind: 'ordered',
    insertAfterNodeId: directUnorderedListResult.selectedNodeId,
  });
  const directOrderedListBlock = directOrderedListInsertResult.blocks.find(
    (block) => block.id === directOrderedListInsertResult.insertedBlockId,
  );
  if (
    !directOrderedListBlock ||
    directOrderedListBlock.type !== 'list' ||
    directOrderedListBlock.metadata.kind !== 'list' ||
    !directOrderedListBlock.metadata.ordered ||
    directOrderedListBlock.metadata.start !== 1 ||
    directOrderedListBlock.metadata.items.length !== 1 ||
    directOrderedListBlock.metadata.items[0].checked !== null ||
    directOrderedListInsertResult.selectedNodeId !== directOrderedListBlock.metadata.items[0].id
  ) {
    throw new Error('列表插入验证失败：模型层没有正确生成默认有序列表');
  }

  const selectedTaskListItemId = useAppStore.getState().insertLayoutListBlock({
    kind: 'task',
    insertAfterNodeId: selectedTableNodeId,
  });
  const insertedTaskListDocument = useAppStore.getState().layoutDocument;
  const insertedTaskListBlock = insertedTaskListDocument?.blocks.find(
    (block) =>
      block.type === 'list' &&
      block.metadata.kind === 'list' &&
      block.metadata.items.some((item) => item.id === selectedTaskListItemId),
  );
  const taskListIndex =
    insertedTaskListDocument?.blocks.findIndex((block) => block.id === insertedTaskListBlock?.id) ?? -1;
  const taskListPreviousTableIndex =
    insertedTaskListDocument?.blocks.findIndex((block) => block.id === insertedTableBlock.id) ?? -1;

  if (!selectedTaskListItemId || !insertedTaskListBlock || taskListIndex !== taskListPreviousTableIndex + 1) {
    throw new Error('列表插入验证失败：任务列表没有插入到当前选中块之后');
  }

  if (
    insertedTaskListBlock.metadata.kind !== 'list' ||
    insertedTaskListBlock.metadata.ordered ||
    insertedTaskListBlock.metadata.start !== null ||
    insertedTaskListBlock.metadata.items.length !== 1 ||
    insertedTaskListBlock.metadata.items[0].checked !== false ||
    insertedTaskListDocument?.viewState.selectedNodeId !== selectedTaskListItemId
  ) {
    throw new Error('列表插入验证失败：store 写回的任务列表结构或选中态不正确');
  }

  const selectedOrderedListItemId = useAppStore.getState().insertLayoutListBlock({
    kind: 'ordered',
    insertAfterNodeId: selectedTaskListItemId,
  });
  const insertedOrderedListBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find(
      (block) =>
        block.type === 'list' &&
        block.metadata.kind === 'list' &&
        block.metadata.items.some((item) => item.id === selectedOrderedListItemId),
    );
  if (
    !selectedOrderedListItemId ||
    !insertedOrderedListBlock ||
    insertedOrderedListBlock.metadata.kind !== 'list' ||
    !insertedOrderedListBlock.metadata.ordered ||
    insertedOrderedListBlock.metadata.start !== 1 ||
    insertedOrderedListBlock.metadata.items[0]?.id !== selectedOrderedListItemId
  ) {
    throw new Error('列表插入验证失败：store 没有正确插入有序列表并选中首项');
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

  const mergeAnchorCellId = columnDeletedTableBlock.metadata.rows[0]?.cells[0]?.id;
  const mergeFocusCellId = columnDeletedTableBlock.metadata.rows[1]?.cells[1]?.id;
  if (!mergeAnchorCellId || !mergeFocusCellId) {
    throw new Error('表格合并验证失败：缺少可用于合并的 2 x 2 单元格区域');
  }

  useAppStore.getState().selectLayoutTableCell({ cellId: mergeAnchorCellId });
  useAppStore.getState().selectLayoutTableCell({ cellId: mergeFocusCellId, extendRange: true });
  const tableSelectionBeforeMerge = useAppStore.getState().layoutDocument?.viewState.tableSelection;
  if (!tableSelectionBeforeMerge || tableSelectionBeforeMerge.cellIds.length !== 4) {
    throw new Error('表格合并验证失败：Shift 选择没有形成 2 x 2 表格选区');
  }

  const mergeResult = useAppStore.getState().mergeLayoutSelectedTableCells();
  const mergedTableBlock = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === insertedTableBlock.id);
  if (
    !mergeResult.didUpdate ||
    mergeResult.selectedNodeId !== mergeAnchorCellId ||
    !mergedTableBlock ||
    mergedTableBlock.metadata.kind !== 'table' ||
    mergedTableBlock.metadata.rows[0].cells[0].rowSpan !== 2 ||
    mergedTableBlock.metadata.rows[0].cells[0].colSpan !== 2 ||
    mergedTableBlock.metadata.rows[1].cells[1].coveredByCellId !== mergeAnchorCellId ||
    useAppStore.getState().layoutDocument?.viewState.tableSelection !== null
  ) {
    throw new Error('表格合并验证失败：store 没有正确合并选中单元格或清理选区');
  }

  const mergedTableHtml = buildExportHtml({
    pages: paginateBlocks([mergedTableBlock], contract),
    title: '表格合并导出验证',
  });
  if (!mergedTableHtml.includes('rowspan="2"') || !mergedTableHtml.includes('colspan="2"')) {
    throw new Error('表格合并导出验证失败：HTML 没有输出 rowspan/colspan');
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

  const insertedEquationResult = insertEquationBlockAfterNode([], {
    value: 'E=mc^2',
  });
  const insertedEquationBlock = insertedEquationResult.blocks[0];
  const renderedEquationHtml = buildExportHtml({
    pages: [
      {
        pageNumber: 1,
        blocks: [insertedEquationBlock],
        contract,
        warnings: [],
      },
    ],
    title: '公式冒烟',
  });

  if (insertedEquationResult.insertedBlockId !== insertedEquationBlock?.id) {
    throw new Error('公式插入验证失败：插入结果 ID 与实际块 ID 不一致');
  }

  if (insertedEquationBlock?.type !== 'equation' || insertedEquationBlock.metadata.kind !== 'equation') {
    throw new Error('公式插入验证失败：未生成公式块');
  }

  if (!renderedEquationHtml.includes('katex') || !renderedEquationHtml.includes('E=mc^2')) {
    throw new Error('公式导出验证失败：HTML 未包含公式渲染结果');
  }

  const brokenEquationHtml = buildExportHtml({
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            ...insertedEquationBlock,
            metadata: {
              ...insertedEquationBlock.metadata,
              value: '\\frac{1}{',
            },
          },
        ],
        contract,
        warnings: [],
      },
    ],
    title: '公式错误态',
  });

  if (!brokenEquationHtml.includes('公式解析失败')) {
    throw new Error('公式错误态验证失败：导出 HTML 未暴露解析失败提示');
  }

  const matrixTemplate = formulaTemplateGroups
    .flatMap((group) => group.templates)
    .find((template) => template.id === 'matrix-2x2');
  const braceTemplate = formulaTemplateGroups
    .flatMap((group) => group.templates)
    .find((template) => template.id === 'braces');
  const subSupTemplate = formulaTemplateGroups
    .flatMap((group) => group.templates)
    .find((template) => template.id === 'subsuperscript');

  if (!matrixTemplate || !braceTemplate || !subSupTemplate) {
    throw new Error('公式模板验证失败：关键模板配置缺失');
  }

  if (!matrixTemplate.value.includes('\\begin{bmatrix}') || !matrixTemplate.value.includes('a & b')) {
    throw new Error('公式模板验证失败：矩阵模板骨架不完整');
  }

  if (!braceTemplate.value.includes('\\left\\{') || !braceTemplate.value.includes('\\right\\}')) {
    throw new Error('公式模板验证失败：大括号模板骨架不完整');
  }

  if (!subSupTemplate.value.includes('x_{i}^{2}')) {
    throw new Error('公式模板验证失败：上下标模板骨架不完整');
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

  const unknownAlgorithmPages = paginateBlocks(layoutDocument.blocks, contract, {
    algorithmId: 'estimated-cost-v1',
  });
  const maxFillAlgorithmPages = paginateBlocks(layoutDocument.blocks, contract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  if (unknownAlgorithmPages.length !== maxFillAlgorithmPages.length) {
    throw new Error('分页算法回退验证失败：旧算法 ID 没有回退到分页测试算法1');
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
