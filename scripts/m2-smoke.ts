import {
  applyBlockStyleOverridesToBlock,
  applyPageNumbersToTocItems,
  applyTextStyleToBlock,
  buildHeadingPageNumberMap,
  buildTocItems,
  buildFontFaceCss,
  buildFontFamilyGroupsWithImportedFonts,
  createLayoutDocumentFromMarkdown,
  estimateImageVisibleHeightPx,
  getVisibleTocItemsForBlock,
  insertEquationBlockAfterNode,
  insertTocBlockAfterNode,
  mergeTopLevelTextBlocksByIds,
  mergeTableCellsByRange,
  parseLayoutProjectFile,
  resolveHangingIndentStyle,
  resolveImageLayout,
  resolveTableColumnWidths,
  resolveTableRowHeightPx,
  serializeLayoutProjectFile,
  shouldHideLayoutListItemMarker,
  toggleTextMarkOnBlock,
  updateLayoutImageAttributes,
  updateTableColumnAlignByCell,
  updateTableColumnWidthsByCell,
  updateTableHeaderRowByCell,
  updateTableRowHeightByCell,
  updateTableStructureByCell,
  type LayoutFontResource,
  type LayoutBlock,
  type SyntaxMappingConfig,
} from '../src/engine/document-model/index.ts';
import { textFontFamilyGroups } from '../src/constants/fontFamilies.ts';
import { renderEquationToHtml, renderInlineEquationToHtml, splitInlineEquations } from '../src/engine/document-model/equation';
import { cloneStyleSettings } from '../src/engine/style/styleSettings.ts';
import { defaultStyleSettings } from '../src/engine/style/presets.ts';
import { resolveStyleContract } from '../src/engine/style/resolveContract.ts';
import {
  applyQuickTextStyleToStyleSheet,
  resolveQuickTextStyleForBlock,
  resolveQuickTextStyleForRun,
} from '../src/engine/style/quickTextStyle.ts';
import { buildExportHtml } from '../src/services/exportHtml.ts';
import {
  ESTIMATED_COST_PAGINATION_ALGORITHM_ID,
  MAX_FILL_PAGINATION_ALGORITHM_ID,
  MEASURED_BLOCK_CACHE_PAGINATION_ALGORITHM_ID,
  paginateBlocks,
} from '../src/engine/typesetting/index.ts';
import { clearAllBlockHeightCache } from '../src/engine/typesetting/algorithms/estimatedMaxFill.ts';
import { useAppStore } from '../src/store/index.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function replaceBlock(blocks: LayoutBlock[], nextBlock: LayoutBlock): LayoutBlock[] {
  return blocks.map((block) => (block.id === nextBlock.id ? nextBlock : block));
}

async function main(): Promise<void> {
  const source = [
    '# M2 链路冒烟',
    '',
    '这是一段用于验证文字样式、段落样式、分页和导出的正文内容。',
    '',
    '## 表格与图片',
    '',
    '| 项目 | 数值 | 说明 |',
    '| --- | ---: | --- |',
    '| 表格列宽 | 128 | 验证列宽和表头 |',
    '| 表格行高 | 56 | 验证行高和导出 |',
    '',
    '![旧图片说明](C:\\测试图片\\m2-smoke.png "旧标题")',
    '',
    '图片后面的普通段落用于验证左侧图片环绕能进入导出 HTML。',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '### 目录页码',
    '',
    '- 任务一',
    '- [x] 任务二',
    '',
    '/pagebreak',
    '',
    '## 第二页标题',
    '',
    '第二页内容用于验证目录页码回填。',
  ].join('\n');

  let document = await createLayoutDocumentFromMarkdown(source);
  assert(document.blocks.some((block) => block.type === 'heading'), 'M2 冒烟失败：Markdown 未导入标题块');
  assert(document.blocks.some((block) => block.type === 'table'), 'M2 冒烟失败：Markdown 未导入表格块');
  assert(document.blocks.some((block) => block.type === 'image'), 'M2 冒烟失败：Markdown 未导入图片块');
  assert(document.blocks.some((block) => block.type === 'equation'), 'M2 冒烟失败：Markdown 未导入公式块');
  assert(document.blocks.some((block) => block.type === 'list'), 'M2 冒烟失败：Markdown 未导入列表块');

  const customSyntaxMappingConfig: SyntaxMappingConfig = {
    version: '1.0.0',
    textMarkMappings: [
      {
        id: 'textmark-smoke-double-equals',
        name: '冒烟自定义等号映射',
        enabled: true,
        pattern: '==(.+?)==',
        markType: 'underline',
        description: '将 ==text== 映射为下划线文本',
      },
    ],
    blockCommandMappings: [],
  };
  const customSyntaxDocument = await createLayoutDocumentFromMarkdown(
    '这是 ==重点== 文本',
    customSyntaxMappingConfig,
  );
  const customSyntaxParagraph = customSyntaxDocument.blocks.find(
    (block) => block.type === 'paragraph' && block.metadata.kind === 'paragraph',
  );
  assert(
    customSyntaxParagraph?.textRuns.some((run) =>
      run.text === '重点' && run.marks.some((mark) => mark.type === 'underline'),
    ),
    'M2 冒烟失败：自定义语法映射没有在 Markdown 导入时生效',
  );
  const customSyntaxProjectFile = serializeLayoutProjectFile({
    document: customSyntaxDocument,
    styleSettings: defaultStyleSettings,
  });
  const reopenedCustomSyntaxDocument = parseLayoutProjectFile(customSyntaxProjectFile).document;
  assert(
    reopenedCustomSyntaxDocument.meta.syntaxMappingConfig?.textMarkMappings.some(
      (mapping) => mapping.id === 'textmark-smoke-double-equals',
    ) &&
      reopenedCustomSyntaxDocument.meta.syntaxMappingConfig.textMarkMappings.some(
        (mapping) => mapping.id === 'md-underline',
      ),
    'M2 冒烟失败：自定义语法映射保存重开后没有和默认规则一起恢复显示',
  );
  const legacySyntaxProjectFile = JSON.stringify(
    {
      kind: 'layout-project',
      version: '1.0.0',
      savedAt: '2026-06-28T00:00:00.000Z',
      document: {
        ...customSyntaxDocument,
        meta: {
          ...customSyntaxDocument.meta,
          syntaxMappingConfig: undefined,
        },
        metadata: {
          syntaxMappingConfig: customSyntaxMappingConfig,
        },
      },
      styleSettings: defaultStyleSettings,
    },
    null,
    2,
  );
  const migratedLegacySyntaxDocument = parseLayoutProjectFile(legacySyntaxProjectFile).document;
  assert(
    migratedLegacySyntaxDocument.meta.syntaxMappingConfig?.textMarkMappings.some(
      (mapping) => mapping.id === 'textmark-smoke-double-equals',
    ) &&
      (migratedLegacySyntaxDocument as { metadata?: unknown }).metadata === undefined,
    'M2 冒烟失败：旧 metadata.syntaxMappingConfig 没有迁移到 meta.syntaxMappingConfig',
  );

  const importedFontResource: LayoutFontResource = {
    id: 'font-resource-m2-smoke',
    type: 'font',
    src: 'C:\\测试字体\\M2SmokeFont.ttf',
    displayName: 'M2 冒烟字体',
    fontFamily: 'LAYOUT3_font_resource_m2_smoke',
    format: 'truetype',
    originalFileName: 'M2SmokeFont.ttf',
    importedAt: '2026-06-27T00:00:00.000Z',
  };
  document = {
    ...document,
    resources: [...document.resources, importedFontResource],
  };
  const fontFamilyGroups = buildFontFamilyGroupsWithImportedFonts(textFontFamilyGroups, document.resources);
  assert(
    fontFamilyGroups.some((group) =>
      group.label === '导入字体' &&
      group.options.some((option) => option.value === importedFontResource.fontFamily),
    ),
    'M2 冒烟失败：导入字体没有进入字体下拉分组',
  );
  const fontFaceCss = buildFontFaceCss(document.resources);
  assert(
    fontFaceCss.includes(`font-family: "${importedFontResource.fontFamily}"`) &&
      fontFaceCss.includes('format("truetype")') &&
      fontFaceCss.includes('layout-asset://'),
    'M2 冒烟失败：导入字体没有生成可用 @font-face CSS',
  );

  const tocInsertResult = insertTocBlockAfterNode(document.blocks, { insertAfterNodeId: null });
  document = {
    ...document,
    blocks: tocInsertResult.blocks,
    meta: {
      ...document.meta,
      blockCount: tocInsertResult.blocks.length,
    },
  };

  const paragraphBlock = document.blocks.find(
    (block) => block.type === 'paragraph' && block.metadata.kind === 'paragraph',
  );
  assert(paragraphBlock, 'M2 冒烟失败：未找到可用于样式验证的段落块');

  const styledParagraph = applyBlockStyleOverridesToBlock(
    toggleTextMarkOnBlock(
      toggleTextMarkOnBlock(
        toggleTextMarkOnBlock(
          toggleTextMarkOnBlock(
            applyTextStyleToBlock(paragraphBlock, { start: 0, end: 6 }, {
              fontFamily: importedFontResource.fontFamily,
              fontSize: 19,
              color: '#0f766e',
              highlightColor: '#fef3c7',
            }),
            { start: 0, end: 6 },
            'bold',
          ),
          { start: 0, end: 6 },
          'italic',
        ),
        { start: 0, end: 6 },
        'underline',
      ),
      { start: 0, end: 6 },
      'strike',
    ),
    {
      textAlign: 'justify',
      lineHeight: 31,
      indentLeft: 24,
      indentRight: 18,
      firstLineIndent: 28,
      hangingIndent: 12,
      spaceBefore: 6,
      spaceAfter: 12,
    },
  );
  document = { ...document, blocks: replaceBlock(document.blocks, styledParagraph) };

  assert(
    styledParagraph.textRuns.some((run) =>
      run.styleOverrides.fontFamily === importedFontResource.fontFamily &&
      run.styleOverrides.fontSize === 19 &&
      run.styleOverrides.color === '#0f766e' &&
      run.styleOverrides.highlightColor === '#fef3c7' &&
      run.marks.some((mark) => mark.type === 'bold') &&
      run.marks.some((mark) => mark.type === 'italic') &&
      run.marks.some((mark) => mark.type === 'underline') &&
      run.marks.some((mark) => mark.type === 'strike'),
    ),
    'M2 冒烟失败：文字样式没有完整写入 TextRun',
  );
  assert(
    styledParagraph.blockStyleOverrides.textAlign === 'justify' &&
      styledParagraph.blockStyleOverrides.lineHeight === 31 &&
      styledParagraph.blockStyleOverrides.indentLeft === 24 &&
      styledParagraph.blockStyleOverrides.indentRight === 18 &&
      styledParagraph.blockStyleOverrides.firstLineIndent === 28 &&
      styledParagraph.blockStyleOverrides.hangingIndent === 12 &&
      styledParagraph.blockStyleOverrides.spaceBefore === 6 &&
      styledParagraph.blockStyleOverrides.spaceAfter === 12,
    'M2 冒烟失败：段落样式没有完整写入 blockStyleOverrides',
  );
  const paragraphIndentStyle = resolveHangingIndentStyle(styledParagraph.blockStyleOverrides);
  assert(
    paragraphIndentStyle.paddingLeft === 36 &&
      paragraphIndentStyle.paddingRight === 18 &&
      paragraphIndentStyle.textIndent === 16,
    'M2 冒烟失败：段落左右缩进、首行缩进或悬挂缩进口径异常',
  );

  const headingBlock = document.blocks.find(
    (block) => block.type === 'heading' && block.metadata.kind === 'heading' && block.metadata.depth === 1,
  );
  const listBlock = document.blocks.find((block) => block.type === 'list' && block.metadata.kind === 'list');
  const quickStyleTableBlock = document.blocks.find((block) => block.type === 'table' && block.metadata.kind === 'table');
  assert(headingBlock && listBlock && quickStyleTableBlock, 'M2 冒烟失败：字体字号批量范围验证缺少标题、列表或表格块');

  const h4Block: LayoutBlock = {
    id: 'heading-h4-quick-style-smoke',
    type: 'heading',
    sourceRange: null,
    blockStyleRef: 'heading4',
    blockStyleOverrides: {},
    textRuns: [
      {
        id: 'heading-h4-quick-style-smoke-run-1',
        text: 'H4 批量字体字号',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    pagination: {},
    metadata: {
      kind: 'heading',
      depth: 4,
      text: 'H4 批量字体字号',
    },
  };
  document = {
    ...document,
    blocks: [...document.blocks, h4Block],
    styles: applyQuickTextStyleToStyleSheet(
      applyQuickTextStyleToStyleSheet(
        applyQuickTextStyleToStyleSheet(
          applyQuickTextStyleToStyleSheet(
            applyQuickTextStyleToStyleSheet(document.styles, 'allText', {
              fontFamily: 'LAYOUT3_global_quick_font',
              fontSize: 13,
            }),
            'heading1',
            {
              fontFamily: importedFontResource.fontFamily,
              fontSize: 27,
            },
          ),
          'heading4',
          {
            fontFamily: 'LAYOUT3_h4_quick_font',
            fontSize: 17,
          },
        ),
        'list',
        {
          fontFamily: 'LAYOUT3_list_quick_font',
          fontSize: 18,
        },
      ),
      'table',
      {
        fontFamily: 'LAYOUT3_table_quick_font',
        fontSize: 21,
      },
    ),
  };

  const headingInheritedStyle = resolveQuickTextStyleForBlock(headingBlock, document.styles);
  const paragraphInheritedStyle = resolveQuickTextStyleForBlock(styledParagraph, document.styles);
  const h4InheritedStyle = resolveQuickTextStyleForBlock(h4Block, document.styles);
  const listInheritedStyle = resolveQuickTextStyleForBlock(listBlock, document.styles);
  const tableInheritedStyle = resolveQuickTextStyleForBlock(quickStyleTableBlock, document.styles);
  assert(
    headingInheritedStyle.fontFamily === importedFontResource.fontFamily &&
      headingInheritedStyle.fontSize === 27,
    'M2 冒烟失败：H1 字体字号没有覆盖全文字规则',
  );
  assert(
    paragraphInheritedStyle.fontFamily === 'LAYOUT3_global_quick_font' &&
      paragraphInheritedStyle.fontSize === 13,
    'M2 冒烟失败：段落没有继承全文字字体字号规则',
  );
  assert(
    h4InheritedStyle.fontFamily === 'LAYOUT3_h4_quick_font' &&
      h4InheritedStyle.fontSize === 17,
    'M2 冒烟失败：H4 字体字号范围规则没有生效',
  );
  assert(
    listInheritedStyle.fontFamily === 'LAYOUT3_list_quick_font' &&
      listInheritedStyle.fontSize === 18,
    'M2 冒烟失败：列表字体字号范围规则没有生效',
  );
  assert(
    tableInheritedStyle.fontFamily === 'LAYOUT3_table_quick_font' &&
      tableInheritedStyle.fontSize === 21,
    'M2 冒烟失败：表格字体字号范围规则没有生效',
  );
  assert(
    resolveQuickTextStyleForRun(styledParagraph.textRuns[0], paragraphInheritedStyle).fontFamily ===
      importedFontResource.fontFamily &&
      resolveQuickTextStyleForRun(styledParagraph.textRuns[0], paragraphInheritedStyle).fontSize === 19,
    'M2 冒烟失败：TextRun 局部字体字号没有覆盖全文字规则',
  );

  const multiLineParagraph = document.blocks.find(
    (block) => block.type === 'paragraph' && block.metadata.kind === 'paragraph' && block.id !== paragraphBlock.id,
  );
  const multiLineText = [
    'A. II类银行账户为存款人提供购买投资理财产品服务',
    'B. III类银行账户为存款人提供限制金额的消费和缴费支付服务',
    'C. I类银行账户为存款人提供单笔无限额的存取现金服务',
    'D. I类银行账户为存款人提供购买投资理财产品服务',
  ].join('\n');
  const multiLineStyleParagraph = applyTextStyleToBlock(
    {
      ...(multiLineParagraph ?? paragraphBlock),
      textRuns: [
        {
          id: `${(multiLineParagraph ?? paragraphBlock).id}-multi-line-run-1`,
          text: multiLineText,
          sourceRange: null,
          marks: [],
          charStyleRef: null,
          styleOverrides: {},
          annotations: [],
        },
      ],
      metadata: {
        ...(multiLineParagraph ?? paragraphBlock).metadata,
        text: multiLineText,
      },
    },
    { start: 0, end: multiLineText.length },
    {
      color: '#d92d20',
      fontSize: 20,
    },
  );
  const multiLineMarkedParagraph = toggleTextMarkOnBlock(
    multiLineStyleParagraph,
    { start: 0, end: multiLineText.length },
    'bold',
  );
  const multiLineTailRun = multiLineMarkedParagraph.textRuns.find((run) => run.text.endsWith('品服务'));
  assert(
    multiLineTailRun?.styleOverrides.color === '#d92d20' &&
      multiLineTailRun.styleOverrides.fontSize === 20 &&
      multiLineTailRun.marks.some((mark) => mark.type === 'bold'),
    'M2 冒烟失败：多行段落完整选区应用格式时尾部文字漏格式',
  );

  // 验证顶层文本块合并只允许连续同类型文本块，并保留第一个块作为合并目标。
  const blockMergeDocument = await createLayoutDocumentFromMarkdown([
    '# 合并测试',
    '',
    '第一段',
    '',
    '第二段',
    '',
    '第三段',
    '',
    '- 列表项',
  ].join('\n'));
  const mergeHeadingBlock = blockMergeDocument.blocks.find(
    (block) => block.type === 'heading' && block.metadata.kind === 'heading',
  );
  const mergeParagraphBlocks = blockMergeDocument.blocks.filter(
    (block): block is Extract<LayoutBlock, { type: 'paragraph' }> =>
      block.type === 'paragraph' && block.metadata.kind === 'paragraph',
  );
  const mergeListBlock = blockMergeDocument.blocks.find((block) => block.type === 'list');
  assert(mergeHeadingBlock, 'M2 冒烟失败：合并测试文档缺少标题块');
  assert(mergeParagraphBlocks.length >= 3, 'M2 冒烟失败：合并测试文档缺少段落块');
  assert(mergeListBlock, 'M2 冒烟失败：合并测试文档缺少列表块');

  const paragraphMergeResult = mergeTopLevelTextBlocksByIds(blockMergeDocument.blocks, [
    mergeParagraphBlocks[0].id,
    mergeParagraphBlocks[1].id,
  ]);
  const mergedParagraphBlock = paragraphMergeResult.blocks.find((block) => block.id === mergeParagraphBlocks[0].id);
  assert(
    paragraphMergeResult.didUpdate &&
      paragraphMergeResult.reason === 'merged' &&
      paragraphMergeResult.mergedCount === 2 &&
      paragraphMergeResult.selectedNodeId === mergeParagraphBlocks[0].id &&
      paragraphMergeResult.blocks.length === blockMergeDocument.blocks.length - 1 &&
      mergedParagraphBlock?.type === 'paragraph' &&
      mergedParagraphBlock.metadata.kind === 'paragraph' &&
      mergedParagraphBlock.metadata.text === '第一段\n第二段',
    'M2 冒烟失败：连续段落块没有按预期合并为第一个块',
  );
  const mixedBlockMergeResult = mergeTopLevelTextBlocksByIds(blockMergeDocument.blocks, [
    mergeHeadingBlock.id,
    mergeParagraphBlocks[0].id,
  ]);
  assert(
    !mixedBlockMergeResult.didUpdate && mixedBlockMergeResult.reason === 'mixedBlockTypes',
    'M2 冒烟失败：标题和段落不应被合并',
  );
  const unsupportedBlockMergeResult = mergeTopLevelTextBlocksByIds(blockMergeDocument.blocks, [
    mergeParagraphBlocks[2].id,
    mergeListBlock.id,
  ]);
  assert(
    !unsupportedBlockMergeResult.didUpdate && unsupportedBlockMergeResult.reason === 'unsupportedBlockType',
    'M2 冒烟失败：段落和列表不应被合并',
  );

  // 验证 store 里的合并操作会进入撤销栈，撤销/重做能恢复文档结构。
  const historyDocument = await createLayoutDocumentFromMarkdown([
    '# 历史测试',
    '',
    '第一段',
    '',
    '第二段',
  ].join('\n'));
  const historyParagraphBlocks = historyDocument.blocks.filter(
    (block): block is Extract<LayoutBlock, { type: 'paragraph' }> =>
      block.type === 'paragraph' && block.metadata.kind === 'paragraph',
  );
  assert(historyParagraphBlocks.length >= 2, 'M2 冒烟失败：历史测试文档缺少段落块');
  useAppStore.getState().loadDocument({
    title: '历史测试',
    filePath: null,
    source: historyDocument.source,
    documentFormat: 'layout',
    layoutDocument: historyDocument,
  });
  useAppStore.getState().selectLayoutBlock({ blockId: historyParagraphBlocks[0].id });
  useAppStore.getState().selectLayoutBlock({ blockId: historyParagraphBlocks[1].id, extendRange: true });
  const storeMergeResult = useAppStore.getState().mergeLayoutSelectedBlocks();
  assert(
    storeMergeResult.didUpdate &&
      useAppStore.getState().documentHistoryPast.length === 1 &&
      useAppStore.getState().documentHistoryFuture.length === 0 &&
      useAppStore.getState().layoutDocument?.blocks.length === historyDocument.blocks.length - 1,
    'M2 冒烟失败：store 合并块没有写入历史栈或块数量异常',
  );
  assert(useAppStore.getState().undoLayoutDocument(), 'M2 冒烟失败：撤销合并块失败');
  assert(
    useAppStore.getState().layoutDocument?.blocks.length === historyDocument.blocks.length &&
      useAppStore.getState().documentHistoryFuture.length === 1,
    'M2 冒烟失败：撤销后没有恢复原始块数量或重做栈',
  );
  assert(useAppStore.getState().redoLayoutDocument(), 'M2 冒烟失败：重做合并块失败');
  assert(
    useAppStore.getState().layoutDocument?.blocks.length === historyDocument.blocks.length - 1 &&
      useAppStore.getState().documentHistoryFuture.length === 0,
    'M2 冒烟失败：重做后没有恢复合并结果或清空重做栈',
  );
  assert(useAppStore.getState().undoLayoutDocument(), 'M2 冒烟失败：二次撤销合并块失败');
  useAppStore.getState().updateLayoutNodeText({ nodeId: historyParagraphBlocks[0].id, text: '改写第一段' });
  assert(
    useAppStore.getState().documentHistoryFuture.length === 0,
    'M2 冒烟失败：撤销后执行新操作没有清空重做栈',
  );

  const tableBlock = document.blocks.find((block) => block.type === 'table' && block.metadata.kind === 'table');
  assert(tableBlock && tableBlock.metadata.kind === 'table', 'M2 冒烟失败：未找到可用于表格验证的表格块');
  const firstCellId = tableBlock.metadata.rows[0]?.cells[0]?.id;
  assert(firstCellId, 'M2 冒烟失败：表格缺少第一个单元格');

  const tableHeaderOffResult = updateTableHeaderRowByCell(tableBlock, firstCellId, false);
  assert(
    tableHeaderOffResult.didUpdate &&
      tableHeaderOffResult.block.metadata.kind === 'table' &&
      tableHeaderOffResult.block.metadata.rows[0]?.cells.every((cell) => !cell.isHeader),
    'M2 冒烟失败：表格表头行关闭没有产生模型写回',
  );
  const tableHeaderResult = updateTableHeaderRowByCell(tableHeaderOffResult.block, firstCellId, true);
  assert(
    tableHeaderResult.didUpdate &&
      tableHeaderResult.block.metadata.kind === 'table' &&
      tableHeaderResult.block.metadata.rows[0]?.cells.every((cell) => cell.isHeader),
    'M2 冒烟失败：表格表头行开启没有产生模型写回',
  );
  const tableWithHeader = tableHeaderResult.block;
  const tableAlignResult = updateTableColumnAlignByCell(tableWithHeader, firstCellId, 'center');
  assert(tableAlignResult.didUpdate, 'M2 冒烟失败：表格列对齐没有产生模型写回');
  const tableWithAlign = tableAlignResult.block;
  assert(tableWithAlign.type === 'table' && tableWithAlign.metadata.kind === 'table', 'M2 冒烟失败：表格属性写回后类型异常');
  const tableWidthResult = updateTableColumnWidthsByCell(tableWithAlign, firstCellId, [180, 120, null]);
  assert(tableWidthResult.didUpdate, 'M2 冒烟失败：表格列宽没有通过模型函数写回');
  const tableHeaderHeightResult = updateTableRowHeightByCell(tableWidthResult.block, firstCellId, 58);
  assert(tableHeaderHeightResult.didUpdate, 'M2 冒烟失败：表格表头行高没有通过模型函数写回');
  assert(
    tableHeaderHeightResult.block.type === 'table' && tableHeaderHeightResult.block.metadata.kind === 'table',
    'M2 冒烟失败：表格行高写回后类型异常',
  );
  const firstBodyCellId = tableHeaderHeightResult.block.metadata.rows[1]?.cells[0]?.id;
  assert(firstBodyCellId, 'M2 冒烟失败：表格缺少可用于行高验证的正文单元格');
  const tableBodyHeightResult = updateTableRowHeightByCell(tableHeaderHeightResult.block, firstBodyCellId, 46);
  assert(tableBodyHeightResult.didUpdate, 'M2 冒烟失败：表格正文行高没有通过模型函数写回');
  const tableWithSize = tableBodyHeightResult.block;
  assert(tableWithSize.type === 'table' && tableWithSize.metadata.kind === 'table', 'M2 冒烟失败：表格尺寸写回后类型异常');
  document = { ...document, blocks: replaceBlock(document.blocks, tableWithSize) };

  const tableInsertRowResult = updateTableStructureByCell(tableWithSize, firstCellId, 'insertRowBelow');
  assert(
    tableInsertRowResult.didUpdate &&
      tableInsertRowResult.block.metadata.kind === 'table' &&
      tableInsertRowResult.block.metadata.rows.length === tableWithSize.metadata.rows.length + 1 &&
      !!tableInsertRowResult.selectedNodeId,
    'M2 冒烟失败：表格插入行没有正确写回结构或迁移选中态',
  );
  const tableInsertColumnResult = updateTableStructureByCell(tableWithSize, firstCellId, 'insertColumnRight');
  assert(
    tableInsertColumnResult.didUpdate &&
      tableInsertColumnResult.block.metadata.kind === 'table' &&
      tableInsertColumnResult.block.metadata.rows.every(
        (row) => row.cells.length === tableWithSize.metadata.rows[0].cells.length + 1,
      ) &&
      tableInsertColumnResult.block.metadata.columnWidthsPx?.length === tableWithSize.metadata.rows[0].cells.length + 1 &&
      !!tableInsertColumnResult.selectedNodeId,
    'M2 冒烟失败：表格插入列没有正确写回结构、列宽或选中态',
  );
  const tableDeleteRowResult = updateTableStructureByCell(tableWithSize, firstBodyCellId, 'deleteRow');
  assert(
    tableDeleteRowResult.didUpdate &&
      tableDeleteRowResult.block.metadata.kind === 'table' &&
      tableDeleteRowResult.block.metadata.rows.length === tableWithSize.metadata.rows.length - 1 &&
      !!tableDeleteRowResult.selectedNodeId,
    'M2 冒烟失败：表格删除行没有正确写回结构或迁移选中态',
  );
  const secondHeaderCellId = tableWithSize.metadata.rows[0]?.cells[1]?.id;
  assert(secondHeaderCellId, 'M2 冒烟失败：表格缺少可用于删除列验证的第二列单元格');
  const tableDeleteColumnResult = updateTableStructureByCell(tableWithSize, secondHeaderCellId, 'deleteColumn');
  assert(
    tableDeleteColumnResult.didUpdate &&
      tableDeleteColumnResult.block.metadata.kind === 'table' &&
      tableDeleteColumnResult.block.metadata.rows.every(
        (row) => row.cells.length === tableWithSize.metadata.rows[0].cells.length - 1,
      ) &&
      tableDeleteColumnResult.block.metadata.columnWidthsPx?.length === tableWithSize.metadata.rows[0].cells.length - 1 &&
      tableDeleteColumnResult.block.metadata.align.length === tableWithSize.metadata.rows[0].cells.length - 1 &&
      !!tableDeleteColumnResult.selectedNodeId,
    'M2 冒烟失败：表格删除列没有正确写回结构、列宽、对齐或选中态',
  );

  const resolvedColumnWidths = resolveTableColumnWidths(
    tableWithSize.metadata.columnWidthsPx,
    tableWithSize.metadata.rows[0]?.cells.length ?? 0,
    520,
  );
  assert(
    resolvedColumnWidths[0] === 180 && resolvedColumnWidths[1] === 120 && resolvedColumnWidths[2] === 220,
    `M2 冒烟失败：表格列宽解析不符合预期，实际为 ${resolvedColumnWidths.join(',')}`,
  );
  assert(
    resolveTableRowHeightPx(tableWithSize.metadata.rows[0], 42) === 58,
    'M2 冒烟失败：表格行高解析不符合预期',
  );
  const mergeFocusCellId = tableWithSize.metadata.rows[1]?.cells[1]?.id;
  assert(mergeFocusCellId, 'M2 冒烟失败：表格缺少用于合并的目标单元格');
  const tableMergeResult = mergeTableCellsByRange(tableWithSize, firstCellId, mergeFocusCellId);
  assert(tableMergeResult.didUpdate, 'M2 冒烟失败：表格相邻单元格没有成功合并');
  assert(
    tableMergeResult.block.metadata.kind === 'table' &&
      tableMergeResult.block.metadata.rows[0]?.cells[0]?.rowSpan === 2 &&
      tableMergeResult.block.metadata.rows[0]?.cells[0]?.colSpan === 2 &&
      tableMergeResult.block.metadata.rows[0]?.cells[1]?.coveredByCellId === firstCellId &&
      tableMergeResult.block.metadata.rows[1]?.cells[0]?.coveredByCellId === firstCellId &&
      tableMergeResult.block.metadata.rows[1]?.cells[1]?.coveredByCellId === firstCellId,
    'M2 冒烟失败：合并单元格没有正确写入跨度或覆盖关系',
  );
  document = { ...document, blocks: replaceBlock(document.blocks, tableMergeResult.block) };
  const mergedTableHtml = buildExportHtml({
    pages: paginateBlocks([tableMergeResult.block], resolveStyleContract(defaultStyleSettings)),
    title: '合并单元格导出验证',
  });
  assert(
    mergedTableHtml.includes('rowspan="2"') && mergedTableHtml.includes('colspan="2"'),
    'M2 冒烟失败：合并单元格导出 HTML 没有输出 rowspan/colspan',
  );

  const imageBlock = document.blocks.find((block) => block.type === 'image' && block.metadata.kind === 'image');
  assert(imageBlock, 'M2 冒烟失败：未找到可用于图片验证的图片块');

  // 验证图片标题默认不显示
  assert(
    imageBlock.metadata.showCaption === undefined || imageBlock.metadata.showCaption === false,
    'M2 冒烟失败：图片标题显示开关默认值应为 false',
  );

  const updatedImage = updateLayoutImageAttributes(imageBlock, {
    src: 'C:\\测试图片\\m2-smoke-updated.png',
    alt: 'M2 图片说明',
    title: 'M2 图片标题',
    widthPx: 320,
    heightPx: 220,
    lockAspectRatio: true,
    objectFit: 'cover',
    cropTopPx: 12,
    cropRightPx: 18,
    cropBottomPx: 20,
    cropLeftPx: 10,
    wrapMode: 'square',
    wrapSide: 'right',
  });
  document = { ...document, blocks: replaceBlock(document.blocks, updatedImage) };
  assert(
    updatedImage.metadata.kind === 'image' &&
      updatedImage.metadata.alt === 'M2 图片说明' &&
      updatedImage.metadata.wrapMode === 'square' &&
      updatedImage.metadata.wrapSide === 'right' &&
      estimateImageVisibleHeightPx(updatedImage.metadata, 220) === 188,
    'M2 冒烟失败：图片属性、裁剪或可见高度没有按统一口径写回',
  );
  assert(
    resolveImageLayout({ ...updatedImage.metadata, wrapMode: 'left' }).wrapMode === 'square' &&
      resolveImageLayout({ ...updatedImage.metadata, wrapMode: 'left' }).wrapSide === 'left' &&
      resolveImageLayout({ ...updatedImage.metadata, wrapMode: 'right' }).wrapMode === 'square' &&
      resolveImageLayout({ ...updatedImage.metadata, wrapMode: 'center' }).wrapMode === 'topBottom' &&
      resolveImageLayout({ ...updatedImage.metadata, wrapMode: 'block' }).wrapMode === 'inline',
    'M2 冒烟失败：旧图片环绕值没有兼容映射到新环绕口径',
  );

  // 验证显示标题开关
  const imageWithCaption = updateLayoutImageAttributes(updatedImage, {
    src: updatedImage.metadata.src,
    alt: updatedImage.metadata.alt,
    title: updatedImage.metadata.title,
    showCaption: true,
  });
  assert(
    imageWithCaption.metadata.showCaption === true,
    'M2 冒烟失败：图片显示标题开关没有正确写入',
  );

  // 验证图片位置偏移量
  const imageWithOffset = updateLayoutImageAttributes(imageWithCaption, {
    src: imageWithCaption.metadata.src,
    alt: imageWithCaption.metadata.alt,
    title: imageWithCaption.metadata.title,
    showCaption: imageWithCaption.metadata.showCaption,
    offsetX: 15,
    offsetY: -8,
  });
  assert(
    imageWithOffset.metadata.offsetX === 15 && imageWithOffset.metadata.offsetY === -8,
    'M2 冒烟失败：图片位置偏移量没有正确写入',
  );
  document = { ...document, blocks: replaceBlock(document.blocks, imageWithOffset) };

  const equationInsertResult = insertEquationBlockAfterNode(document.blocks, {
    value: '\\frac{a+b}{c}',
    insertAfterNodeId: updatedImage.id,
  });
  document = {
    ...document,
    blocks: equationInsertResult.blocks,
    meta: {
      ...document.meta,
      blockCount: equationInsertResult.blocks.length,
    },
  };
  const insertedEquationBlock = document.blocks.find(
    (block) => block.id === equationInsertResult.insertedBlockId,
  );
  assert(
    insertedEquationBlock?.type === 'equation' && insertedEquationBlock.metadata.kind === 'equation',
    'M2 冒烟失败：公式块插入后没有进入文档模型',
  );
  const equationRenderResult = renderEquationToHtml(insertedEquationBlock.metadata.value);
  assert(
    equationRenderResult.error === null &&
      equationRenderResult.html.includes('katex-html') &&
      equationRenderResult.html.includes('katex-mathml'),
    'M2 冒烟失败：块级公式没有成功渲染为可视化 HTML',
  );
  const radicalEquationRenderResult = renderEquationToHtml('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
  assert(
    radicalEquationRenderResult.error === null &&
      radicalEquationRenderResult.html.includes('katex-html') &&
      radicalEquationRenderResult.html.includes('katex-mathml') &&
      radicalEquationRenderResult.html.includes('<svg'),
    'M2 冒烟失败：根号公式没有使用 KaTeX HTML/SVG 视觉渲染',
  );
  const invalidEquationRenderResult = renderEquationToHtml('\\frac{');
  assert(
    invalidEquationRenderResult.error &&
      invalidEquationRenderResult.html.includes('equation-render-error') &&
      invalidEquationRenderResult.html.includes('公式解析失败'),
    'M2 冒烟失败：块级公式解析失败时没有输出错误降级 HTML',
  );

  // 验证行内公式解析和渲染
  const inlineEquationTests = [
    { input: 'x^2 + y^2 = r^2', expected: true },
    { input: 'E = mc^2', expected: true },
    { input: '\\frac{a}{b}', expected: true },
    { input: '\\sum_{i=1}^n x_i', expected: true },
  ];

  for (const test of inlineEquationTests) {
    const fragments = splitInlineEquations(`$${test.input}$`);
    assert(
      fragments.length === 1 && fragments[0].type === 'equation' && fragments[0].content === test.input,
      `M2 冒烟失败：行内公式 "${test.input}" 解析结果不符合预期`,
    );
    const rendered = renderInlineEquationToHtml(test.input);
    assert(
      rendered.includes('katex-html') && rendered.includes('katex-mathml') && !rendered.startsWith('$'),
      `M2 冒烟失败：行内公式 "${test.input}" 渲染结果不符合预期`,
    );
  }

  // 验证混合文本（含行内公式和普通文字）
  const mixedText = '根据公式 $E = mc^2$，能量与质量成正比。';
  const mixedFragments = splitInlineEquations(mixedText);
  assert(mixedFragments.length === 3, `M2 冒烟失败：混合文本应拆分为 3 个片段，实际为 ${mixedFragments.length}`);
  assert(mixedFragments[0].type === 'text' && mixedFragments[0].content === '根据公式 ', 'M2 冒烟失败：混合文本第一段应为普通文字');
  assert(mixedFragments[1].type === 'equation' && mixedFragments[1].content === 'E = mc^2', 'M2 冒烟失败：混合文本第二段应为公式');
  assert(mixedFragments[2].type === 'text' && mixedFragments[2].content === '，能量与质量成正比。', 'M2 冒烟失败：混合文本第三段应为普通文字');

  const smokeBlockSpacing = {
    ...defaultStyleSettings.blockSpacing,
    heading2SpaceBefore: 30,
    paragraphSpaceAfter: 26,
    listItemGap: 11,
    codePaddingX: 22,
    codePaddingY: 18,
    tableCellPaddingY: 14,
    imageSpaceAfter: 28,
    textInsetLeft: 12,
    textInsetRight: 10,
  };
  const styleSettings = cloneStyleSettings({
    ...defaultStyleSettings,
    templateId: 'lecture',
    themeId: 'snowMountain',
    marginMode: 'custom',
    customMarginsMm: {
      top: 18,
      right: 16,
      bottom: 18,
      left: 16,
    },
    paginationAlgorithmId: ESTIMATED_COST_PAGINATION_ALGORITHM_ID,
    blockSpacingPresetId: 'm2-smoke-spacing',
    blockSpacing: smokeBlockSpacing,
    customBlockSpacingPresets: [
      {
        id: 'm2-smoke-spacing',
        name: 'M2 冒烟排版',
        description: '验证块排版参数预设保存恢复',
        parameters: smokeBlockSpacing,
      },
    ],
  });
  const serialized = serializeLayoutProjectFile({ document, styleSettings });
  const restoredProject = parseLayoutProjectFile(serialized);
  assert(restoredProject.document.blocks.length === document.blocks.length, 'M2 冒烟失败：layout 工程文件没有恢复完整块数量');
  assert(restoredProject.styleSettings.templateId === 'lecture', 'M2 冒烟失败：layout 工程文件没有恢复模板设置');
  assert(restoredProject.styleSettings.themeId === 'snowMountain', 'M2 冒烟失败：layout 工程文件没有恢复风格主题设置');
  assert(
    restoredProject.styleSettings.paginationAlgorithmId === ESTIMATED_COST_PAGINATION_ALGORITHM_ID,
    'M2 冒烟失败：layout 工程文件没有恢复分页算法选择',
  );
  const legacyThemeProjectFile = JSON.stringify(
    {
      ...JSON.parse(serialized),
      styleSettings: {
        ...JSON.parse(serialized).styleSettings,
        themeId: undefined,
      },
    },
    null,
    2,
  );
  const restoredLegacyThemeProject = parseLayoutProjectFile(legacyThemeProjectFile);
  assert(
    restoredLegacyThemeProject.styleSettings.themeId === 'default',
    'M2 冒烟失败：旧工程文件缺少 themeId 时没有回退到默认主题',
  );
  assert(
    restoredProject.styleSettings.blockSpacingPresetId === 'm2-smoke-spacing' &&
      restoredProject.styleSettings.customBlockSpacingPresets[0]?.name === 'M2 冒烟排版' &&
      restoredProject.styleSettings.blockSpacing.paragraphSpaceAfter === 26 &&
      restoredProject.styleSettings.blockSpacing.codePaddingX === 22,
    'M2 冒烟失败：layout 工程文件没有恢复块排版参数预设',
  );
  const restoredStyledParagraph = restoredProject.document.blocks.find((block) => block.id === styledParagraph.id);
  assert(
    restoredStyledParagraph &&
      restoredStyledParagraph.textRuns.some((run) =>
        run.styleOverrides.fontFamily === importedFontResource.fontFamily &&
        run.styleOverrides.fontSize === 19 &&
        run.styleOverrides.color === '#0f766e' &&
        run.styleOverrides.highlightColor === '#fef3c7' &&
        run.marks.some((mark) => mark.type === 'bold') &&
        run.marks.some((mark) => mark.type === 'italic') &&
        run.marks.some((mark) => mark.type === 'underline') &&
        run.marks.some((mark) => mark.type === 'strike'),
      ),
    'M2 冒烟失败：layout 工程文件没有恢复文字样式覆盖',
  );
  assert(
    restoredStyledParagraph.blockStyleOverrides.textAlign === 'justify' &&
      restoredStyledParagraph.blockStyleOverrides.lineHeight === 31 &&
      restoredStyledParagraph.blockStyleOverrides.indentLeft === 24 &&
      restoredStyledParagraph.blockStyleOverrides.indentRight === 18 &&
      restoredStyledParagraph.blockStyleOverrides.firstLineIndent === 28 &&
      restoredStyledParagraph.blockStyleOverrides.hangingIndent === 12 &&
      restoredStyledParagraph.blockStyleOverrides.spaceBefore === 6 &&
      restoredStyledParagraph.blockStyleOverrides.spaceAfter === 12,
    'M2 冒烟失败：layout 工程文件没有恢复段落样式覆盖',
  );
  const restoredTableBlock = restoredProject.document.blocks.find((block) => block.id === tableMergeResult.block.id);
  assert(
    restoredTableBlock?.type === 'table' &&
      restoredTableBlock.metadata.kind === 'table' &&
      restoredTableBlock.metadata.columnWidthsPx?.[0] === 180 &&
      restoredTableBlock.metadata.columnWidthsPx?.[1] === 120 &&
      restoredTableBlock.metadata.align[0] === 'center' &&
      restoredTableBlock.metadata.rows[0]?.heightPx === 58 &&
      restoredTableBlock.metadata.rows[1]?.heightPx === 46 &&
      restoredTableBlock.metadata.rows[0]?.cells[0]?.rowSpan === 2 &&
      restoredTableBlock.metadata.rows[0]?.cells[0]?.colSpan === 2,
    'M2 冒烟失败：layout 工程文件没有恢复表格列宽、行高、对齐或合并单元格',
  );
  const restoredImageBlock = restoredProject.document.blocks.find((block) => block.id === imageWithOffset.id);
  assert(
    restoredImageBlock?.type === 'image' &&
      restoredImageBlock.metadata.kind === 'image' &&
      restoredImageBlock.metadata.src === 'C:\\测试图片\\m2-smoke-updated.png' &&
      restoredImageBlock.metadata.alt === 'M2 图片说明' &&
      restoredImageBlock.metadata.title === 'M2 图片标题' &&
      restoredImageBlock.metadata.widthPx === 320 &&
      restoredImageBlock.metadata.heightPx === 220 &&
      restoredImageBlock.metadata.cropTopPx === 12 &&
      restoredImageBlock.metadata.cropRightPx === 18 &&
      restoredImageBlock.metadata.cropBottomPx === 20 &&
      restoredImageBlock.metadata.cropLeftPx === 10 &&
      restoredImageBlock.metadata.wrapMode === 'square' &&
      restoredImageBlock.metadata.wrapSide === 'right' &&
      restoredImageBlock.metadata.showCaption === true &&
      restoredImageBlock.metadata.offsetX === 15 &&
      restoredImageBlock.metadata.offsetY === -8,
    'M2 冒烟失败：layout 工程文件没有恢复图片路径、标题、裁剪、环绕、说明或偏移属性',
  );
  const restoredEquationBlock = restoredProject.document.blocks.find(
    (block) => block.id === insertedEquationBlock.id,
  );
  assert(
    restoredEquationBlock?.type === 'equation' &&
      restoredEquationBlock.metadata.kind === 'equation' &&
      restoredEquationBlock.metadata.value === '\\frac{a+b}{c}',
    'M2 冒烟失败：layout 工程文件没有恢复块级公式源码',
  );

  const contract = resolveStyleContract(restoredProject.styleSettings);
  assert(contract.templateLabel.includes('讲义'), 'M2 冒烟失败：模板设置没有进入样式契约');
  assert(
    contract.blockStyles.heading2.marginTop === 30 &&
      contract.blockStyles.paragraph.marginBottom === 26 &&
      contract.blockStyles.paragraph.insetLeft === 12 &&
      contract.blockStyles.paragraph.insetRight === 10 &&
      contract.blockStyles.list.itemGap === 11 &&
      contract.blockStyles.code.paddingX === 22 &&
      contract.blockStyles.code.paddingY === 18 &&
      contract.blockStyles.table.cellPaddingY === 14 &&
      contract.blockStyles.image.marginBottom === 28,
    'M2 冒烟失败：块排版参数没有进入样式契约',
  );

  useAppStore.getState().replaceStyleSettings(defaultStyleSettings);
  useAppStore.getState().applyBlockSpacingPreset('compact');
  assert(
    useAppStore.getState().styleSettings.blockSpacing.listItemGap === 4,
    'M2 冒烟失败：内置块排版预设没有应用到 store',
  );
  useAppStore.getState().setBlockSpacingParameter('paragraphSpaceAfter', 31);
  const smokePresetId = useAppStore.getState().addBlockSpacingPreset({
    name: '冒烟预设',
    description: '用于验证自定义块排版预设',
  });
  useAppStore.getState().setBlockSpacingParameter('paragraphSpaceAfter', 36);
  useAppStore.getState().updateBlockSpacingPreset({
    presetId: smokePresetId,
    name: '冒烟预设重命名',
    description: '描述已更新',
    parameters: useAppStore.getState().styleSettings.blockSpacing,
  });
  useAppStore.getState().applyBlockSpacingPreset(smokePresetId);
  assert(
    useAppStore.getState().styleSettings.blockSpacing.paragraphSpaceAfter === 36 &&
      useAppStore.getState().styleSettings.customBlockSpacingPresets.some(
        (preset) =>
          preset.id === smokePresetId &&
          preset.name === '冒烟预设重命名' &&
          preset.description === '描述已更新',
      ),
    'M2 冒烟失败：自定义块排版预设没有正确新增、重命名、更新参数或应用',
  );
  const pages = paginateBlocks(restoredProject.document.blocks, contract, {
    algorithmId: restoredProject.styleSettings.paginationAlgorithmId,
    styles: restoredProject.document.styles,
  });
  assert(pages.length >= 2, `M2 冒烟失败：分页结果页数异常，实际为 ${pages.length}`);

  const tocItems = applyPageNumbersToTocItems(
    buildTocItems(restoredProject.document),
    buildHeadingPageNumberMap(pages),
  );
  assert(tocItems.length >= 4, `M2 冒烟失败：目录项数量异常，实际为 ${tocItems.length}`);
  assert(
    tocItems.every((item) => typeof item.pageNumber === 'number'),
    'M2 冒烟失败：目录页码没有按分页结果回填',
  );

  assert(
    restoredProject.document.resources.some(
      (resource) => resource.type === 'font' && resource.fontFamily === importedFontResource.fontFamily,
    ),
    'M2 冒烟失败：layout 工程文件没有恢复导入字体资源',
  );

  const html = buildExportHtml({
    pages,
    title: restoredProject.document.title,
    resources: restoredProject.document.resources,
    styles: restoredProject.document.styles,
  });
  const expectedHtmlFragments = [
    `font-family: "${importedFontResource.fontFamily}"`,
    `font-family:${importedFontResource.fontFamily}`,
    'font-family:LAYOUT3_global_quick_font',
    'font-family:LAYOUT3_h4_quick_font',
    'font-family:LAYOUT3_list_quick_font',
    'font-family:LAYOUT3_table_quick_font',
    'format("truetype")',
    'font-size:13px',
    'font-size:17px',
    'font-size:18px',
    'font-size:19px',
    'font-size:21px',
    'font-size:27px',
    'color:#0f766e',
    'background-color:#fef3c7',
    'font-style:italic',
    '<strong>',
    '<em>',
    '<u>',
    '<s>',
    'text-align:justify',
    'line-height:31px',
    'margin-top:6px',
    'margin-bottom:12px',
    'padding-left:36px',
    'padding-right:18px',
    'text-indent:16px',
    '--page-heading2-margin-top:30px',
    '--page-paragraph-margin-bottom:26px',
    '--page-paragraph-inset-left:12px',
    '--page-code-padding-x:22px',
    '--page-table-cell-padding-y:14px',
    '<th',
    'width:180px',
    'height:58px',
    'image-wrap-square',
    'image-wrap-side-right',
    'transform:translate(-10px, -12px)',
    'equation-shell',
    'toc-entry-export',
    '讲义模板',
    '雪山静境',
    '--page-surface-bg:#FAFDFF',
    '--page-heading1-rule:#F2B84B',
    '--page-heading2-marker:#2F6F64',
  ];

  for (const fragment of expectedHtmlFragments) {
    assert(html.includes(fragment), `M2 冒烟失败：导出 HTML 缺少关键片段 ${fragment}`);
  }

  const longTocSource = [
    '# 长目录分页验证',
    '',
    ...Array.from({ length: 18 }, (_, index) => [
      `## 长目录标题 ${index + 1}`,
      '',
      `这是第 ${index + 1} 个标题下的短正文，用来制造足够多的目录项。`,
    ].join('\n')),
  ].join('\n\n');
  let longTocDocument = await createLayoutDocumentFromMarkdown(longTocSource);
  const longTocInsertResult = insertTocBlockAfterNode(longTocDocument.blocks, { insertAfterNodeId: null });
  longTocDocument = {
    ...longTocDocument,
    blocks: longTocInsertResult.blocks,
    meta: {
      ...longTocDocument.meta,
      blockCount: longTocInsertResult.blocks.length,
    },
  };
  const longTocContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 520,
    contentHeightPx: 170,
  };
  const longTocPages = paginateBlocks(longTocDocument.blocks, longTocContract);
  const longTocFragments = longTocPages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'toc' && block.metadata.kind === 'toc');
  const longTocItems = applyPageNumbersToTocItems(
    buildTocItems(longTocDocument),
    buildHeadingPageNumberMap(longTocPages),
  );
  const longTocVisibleItemIds = longTocFragments.flatMap((fragment) =>
    getVisibleTocItemsForBlock(fragment, longTocItems).map((item) => item.id),
  );
  assert(
    longTocFragments.length > 1 && longTocFragments.every((fragment) => fragment.metadata.kind === 'toc' && !!fragment.metadata.runtimeSlice),
    'M2 冒烟失败：长目录没有拆成多个运行时目录片段',
  );
  assert(
    longTocVisibleItemIds.join('|') === longTocItems.map((item) => item.id).join('|'),
    'M2 冒烟失败：长目录分页片段没有完整保留目录项顺序',
  );
  const longTocHtml = buildExportHtml({ pages: longTocPages, title: '长目录分页验证' });
  const longTocExportSectionCount = longTocHtml.match(/class="toc-block-export"/g)?.length ?? 0;
  assert(
    longTocExportSectionCount === longTocFragments.length && longTocHtml.includes('目录（续）'),
    'M2 冒烟失败：长目录导出 HTML 没有按分页片段输出',
  );

  const measuredBlockA: LayoutBlock = {
    id: 'm2-measured-block-a',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-measured-block-a-run',
        text: '真实测量块 A',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '真实测量块 A',
    },
  };
  const measuredBlockB: LayoutBlock = {
    id: 'm2-measured-block-b',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-measured-block-b-run',
        text: '真实测量块 B',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '真实测量块 B',
    },
  };
  const measuredContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 100,
  };
  const measuredPages = paginateBlocks([measuredBlockA, measuredBlockB], measuredContract, {
    algorithmId: MEASURED_BLOCK_CACHE_PAGINATION_ALGORITHM_ID,
    measuredBlockHeights: {
      [measuredBlockA.id]: 80,
      [measuredBlockB.id]: 40,
    },
  });
  const remeasuredPages = paginateBlocks([measuredBlockA, measuredBlockB], measuredContract, {
    algorithmId: MEASURED_BLOCK_CACHE_PAGINATION_ALGORITHM_ID,
    measuredBlockHeights: {
      [measuredBlockA.id]: 40,
      [measuredBlockB.id]: 40,
    },
  });
  assert(
    measuredPages.length === 2 &&
      measuredPages[0]?.blocks.length === 1 &&
      measuredPages[1]?.blocks[0]?.id === measuredBlockB.id,
    'M2 冒烟失败：真实测量块缓存算法没有优先使用测量高度进行分页',
  );
  assert(
    remeasuredPages.length === 1 &&
      remeasuredPages[0]?.blocks.map((block) => block.id).join('|') ===
        `${measuredBlockA.id}|${measuredBlockB.id}`,
    'M2 冒烟失败：真实测量块缓存算法没有响应测量高度变化',
  );

  const maxFillTextBlock: LayoutBlock = {
    id: 'm2-max-fill-rich-paragraph',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-run-1',
        text: '第一页红色文字\n',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: { color: '#dc2626' },
        annotations: [],
      },
      {
        id: 'm2-max-fill-run-2',
        text: '第二页高亮文字\n',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: { highlightColor: '#fef3c7' },
        annotations: [],
      },
      {
        id: 'm2-max-fill-run-3',
        text: '第三页加粗文字\n',
        sourceRange: null,
        marks: [{ type: 'bold' }],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
      {
        id: 'm2-max-fill-run-4',
        text: '第四页普通文字',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '第一页红色文字\n第二页高亮文字\n第三页加粗文字\n第四页普通文字',
    },
  };
  const tinyMaxFillContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 24,
  };
  const maxFillPages = paginateBlocks([maxFillTextBlock], tinyMaxFillContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const maxFillTexts = maxFillPages.flatMap((page) =>
    page.blocks.map((block) => block.textRuns.map((run) => run.text).join('')),
  );
  assert(
    maxFillTexts.join('') === maxFillTextBlock.metadata.text,
    'M2 冒烟失败：分页测试算法1文本分割后内容顺序不正确',
  );
  assert(
    maxFillPages.length === 4 && maxFillTexts[1] === '第二页高亮文字\n',
    `M2 冒烟失败：分页测试算法1剩余文本没有紧跟原块继续分页，实际页数 ${maxFillPages.length}`,
  );
  assert(
    maxFillPages[0]?.blocks[0]?.textRuns[0]?.styleOverrides.color === '#dc2626' &&
      maxFillPages[1]?.blocks[0]?.textRuns[0]?.styleOverrides.highlightColor === '#fef3c7' &&
      maxFillPages[2]?.blocks[0]?.textRuns[0]?.marks.some((mark) => mark.type === 'bold'),
    'M2 冒烟失败：分页测试算法1文本分割后没有保留 TextRun 样式',
  );
  assert(
    maxFillPages.every((page) =>
      page.blocks.every((block) => block.textRuns.map((run) => run.text).join('') === block.metadata.text),
    ),
    'M2 冒烟失败：分页测试算法1分割片段的 metadata.text 没有同步更新',
  );

  const maxFillVisualLineText = '一二三四，五六七八九十甲乙丙丁戊己庚辛壬癸';
  const maxFillVisualLineBlock: LayoutBlock = {
    id: 'm2-max-fill-visual-line-paragraph',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-visual-line-run',
        text: maxFillVisualLineText,
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: { fontSize: 16 },
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: maxFillVisualLineText,
    },
  };
  const visualLineContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 96,
    contentHeightPx: 48,
  };
  const visualLinePages = paginateBlocks([maxFillVisualLineBlock], visualLineContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const visualLineTexts = visualLinePages.flatMap((page) =>
    page.blocks.map((block) => block.textRuns.map((run) => run.text).join('')),
  );
  assert(
    visualLineTexts.join('') === maxFillVisualLineText,
    'M2 冒烟失败：分页测试算法1视觉行拆分后文本顺序不正确',
  );
  assert(
    visualLinePages.length === 2 && visualLineTexts[0] === maxFillVisualLineText.slice(0, 12),
    `M2 冒烟失败：分页测试算法1没有按视觉行边界拆分，第一页实际为“${visualLineTexts[0] ?? ''}”`,
  );

  const maxFillLargeFontText = '大字号第一页\n大字号第二页';
  const maxFillLargeFontBlock: LayoutBlock = {
    id: 'm2-max-fill-large-font-paragraph',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-large-font-run',
        text: maxFillLargeFontText,
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: { fontSize: 36 },
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: maxFillLargeFontText,
    },
  };
  const largeFontContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 72,
  };
  const largeFontPages = paginateBlocks([maxFillLargeFontBlock], largeFontContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const largeFontTexts = largeFontPages.flatMap((page) =>
    page.blocks.map((block) => block.textRuns.map((run) => run.text).join('')),
  );
  assert(
    largeFontPages.length === 2 && largeFontTexts[0] === '大字号第一页\n',
    `M2 冒烟失败：分页测试算法1没有按大字号有效行高拆页，实际页数 ${largeFontPages.length}`,
  );

  const measuredHeightBlockA: LayoutBlock = {
    id: 'm2-max-fill-measured-height-a',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-measured-height-a-run',
        text: '实测高度段落',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '实测高度段落',
    },
  };
  const measuredHeightBlockB: LayoutBlock = {
    ...measuredHeightBlockA,
    id: 'm2-max-fill-measured-height-b',
    textRuns: [
      {
        ...measuredHeightBlockA.textRuns[0],
        id: 'm2-max-fill-measured-height-b-run',
        text: '后续段落',
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '后续段落',
    },
  };
  const measuredHeightPages = paginateBlocks(
    [measuredHeightBlockA, measuredHeightBlockB],
    {
      ...resolveStyleContract(defaultStyleSettings),
      contentHeightPx: 100,
    },
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
      measuredBlockHeights: {
        [measuredHeightBlockA.id]: 84,
      },
    },
  );
  assert(
    measuredHeightPages.length === 2,
    `M2 冒烟失败：分页测试算法1没有消费实测块高，实际页数 ${measuredHeightPages.length}`,
  );

  const maxFillTailMisbreakText =
    '核心任务：了解三科内容结构、分值分布、重点章节；攻克《中级会计实务》的长期股权投资、合并报表等前期难点；熟悉《财务管理》的计算公式逻辑；对《经济法》的法条体系建立初步印象。';
  const maxFillTailMisbreakListBlock: LayoutBlock = {
    id: 'm2-max-fill-tail-misbreak-list',
    type: 'list',
    sourceRange: null,
    blockStyleRef: 'list',
    blockStyleOverrides: {
      lineHeight: 28,
      spaceBefore: 0,
      spaceAfter: 16,
    },
    pagination: {},
    textRuns: [],
    metadata: {
      kind: 'list',
      ordered: false,
      start: null,
      spread: false,
      items: [
        {
          id: 'm2-max-fill-tail-misbreak-item',
          sourceRange: null,
          checked: null,
          textRuns: [
            {
              id: 'm2-max-fill-tail-misbreak-run',
              text: maxFillTailMisbreakText,
              sourceRange: null,
              marks: [],
              charStyleRef: null,
              styleOverrides: { fontSize: 16 },
              annotations: [],
            },
          ],
        },
      ],
    },
  };
  const tailMisbreakContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 656,
    contentHeightPx: 72,
  };
  const tailMisbreakPages = paginateBlocks([maxFillTailMisbreakListBlock], tailMisbreakContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const tailMisbreakTexts = tailMisbreakPages.flatMap((page) =>
    page.blocks.flatMap((block) =>
      block.type === 'list' && block.metadata.kind === 'list'
        ? block.metadata.items.map((item) => item.textRuns.map((run) => run.text).join(''))
        : [],
    ),
  );
  assert(
    tailMisbreakTexts.join('') === maxFillTailMisbreakText,
    'M2 冒烟失败：分页测试算法1页尾误拆修复后列表项文本顺序不正确',
  );
  assert(
    tailMisbreakTexts[1] === '初步印象。',
    `M2 冒烟失败：分页测试算法1仍把“初步印象。”拆成过短尾巴，实际续页为“${tailMisbreakTexts[1] ?? ''}”`,
  );

  const tailMeasuredTolerancePages = paginateBlocks(
    [maxFillTailMisbreakListBlock],
    {
      ...resolveStyleContract(defaultStyleSettings),
      contentWidthPx: 656,
      contentHeightPx: 100,
    },
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
      measuredBlockHeights: {
        [maxFillTailMisbreakListBlock.id]: 112,
      },
    },
  );
  assert(
    tailMeasuredTolerancePages.length === 1,
    `M2 冒烟失败：分页测试算法1把轻微实测高度偏差误判为需要拆页，实际页数 ${tailMeasuredTolerancePages.length}`,
  );

  const tailContextHeadingBlock: LayoutBlock = {
    id: 'm2-max-fill-tail-context-heading',
    type: 'heading',
    sourceRange: null,
    blockStyleRef: 'heading2',
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-tail-context-heading-run',
        text: '二、各阶段详细规划',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'heading',
      depth: 2,
      text: '二、各阶段详细规划',
    },
  };
  const tailContextSubheadingBlock: LayoutBlock = {
    id: 'm2-max-fill-tail-context-subheading',
    type: 'heading',
    sourceRange: null,
    blockStyleRef: 'heading3',
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-tail-context-subheading-run',
        text: '1. 预习阶段',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'heading',
      depth: 3,
      text: '1. 预习阶段',
    },
  };
  const tailContextNextHeadingBlock: LayoutBlock = {
    id: 'm2-max-fill-tail-context-next-heading',
    type: 'heading',
    sourceRange: null,
    blockStyleRef: 'heading3',
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-tail-context-next-heading-run',
        text: '2. 基础阶段',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'heading',
      depth: 3,
      text: '2. 基础阶段',
    },
  };
  const tailContextPages = paginateBlocks(
    [
      tailContextHeadingBlock,
      tailContextSubheadingBlock,
      maxFillTailMisbreakListBlock,
      tailContextNextHeadingBlock,
    ],
    {
      ...resolveStyleContract(defaultStyleSettings),
      contentWidthPx: 656,
      contentHeightPx: 212,
    },
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
    },
  );
  const tailContextFirstPageListText = tailContextPages[0]?.blocks
    .filter((block) => block.type === 'list' && block.metadata.kind === 'list')
    .flatMap((block) => (block.metadata.kind === 'list' ? block.metadata.items : []))
    .map((item) => item.textRuns.map((run) => run.text).join(''))[0];
  const tailContextSecondPageListText = tailContextPages[1]?.blocks
    .filter((block) => block.type === 'list' && block.metadata.kind === 'list')
    .flatMap((block) => (block.metadata.kind === 'list' ? block.metadata.items : []))
    .map((item) => item.textRuns.map((run) => run.text).join(''))[0];
  assert(
    tailContextFirstPageListText === maxFillTailMisbreakText,
    `M2 冒烟失败：分页测试算法1仍在完整上下文里提前拆分“初步印象。”，第一页列表实际为“${tailContextFirstPageListText ?? ''}”`,
  );
  assert(
    tailContextSecondPageListText !== '初步印象。',
    'M2 冒烟失败：分页测试算法1仍把“初步印象。”单独拆到第二页正文开头',
  );

  // 验证混排文本（中文+英文+数字）使用字符级精确流式布局，不再按平均宽度估算
  const flowMixedText = '项目编号PROJ-2026-001，负责人张三负责预算审核，金额CNY150000.00元整备注信息。'.repeat(6);
  const mixedTextBlock: LayoutBlock = {
    id: 'm2-mixed-text-flow',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-mixed-text-run',
        text: flowMixedText,
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: { fontSize: 14 },
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: flowMixedText,
    },
  };
  const mixedContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 42, // 很窄：约 3 个中文字符宽，强制多行跨页
    contentHeightPx: 48, // 约 2 行，强制分页
  };
  const mixedPages = paginateBlocks([mixedTextBlock], mixedContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const flowMixedTexts = mixedPages.flatMap((page) =>
    page.blocks.map((block) => block.textRuns.map((run) => run.text).join('')),
  );
  assert(
    flowMixedTexts.join('') === flowMixedText,
    'M2 冒烟失败：分页测试算法1混排文本分割后内容顺序不正确',
  );
  assert(
    mixedPages.length >= 2,
    'M2 冒烟失败：分页测试算法1混排文本没有正确分页，实际页数为 ' + mixedPages.length,
  );

  const maxFillCacheText = '这是一段用于验证分页测试算法1高度缓存契约隔离的长文本。'.repeat(18);
  const maxFillCacheBlock: LayoutBlock = {
    id: 'm2-max-fill-cache-contract-block',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-cache-contract-run',
        text: maxFillCacheText,
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: maxFillCacheText,
    },
  };
  const maxFillCacheNextBlock: LayoutBlock = {
    id: 'm2-max-fill-cache-contract-next-block',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-cache-contract-next-run',
        text: '后续段落',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '后续段落',
    },
  };
  const wideMaxFillContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 2000,
    contentHeightPx: 2000,
  };
  const narrowMaxFillContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 80,
    contentHeightPx: 48,
  };
  clearAllBlockHeightCache();
  paginateBlocks([maxFillCacheBlock], wideMaxFillContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const maxFillCachePagesAfterContractChange = paginateBlocks(
    [maxFillCacheBlock, maxFillCacheNextBlock],
    narrowMaxFillContract,
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
    },
  );
  const cacheContractFirstPageIds = maxFillCachePagesAfterContractChange[0]?.blocks.map((block) => block.id) ?? [];
  assert(
    maxFillCachePagesAfterContractChange.length > 1 &&
      cacheContractFirstPageIds.length === 1 &&
      !cacheContractFirstPageIds.includes(maxFillCacheNextBlock.id),
    'M2 冒烟失败：分页测试算法1高度缓存没有按样式契约隔离，页面宽度变化后复用了旧块高',
  );

  const maxFillHeadingBlock: LayoutBlock = {
    id: 'm2-max-fill-heading-before-list',
    type: 'heading',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-heading-run',
        text: '二、衔接句型',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'heading',
      depth: 2,
      text: '二、衔接句型',
    },
  };
  const maxFillListBlock: LayoutBlock = {
    id: 'm2-max-fill-long-list',
    type: 'list',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [],
    metadata: {
      kind: 'list',
      ordered: true,
      start: 1,
      spread: false,
      items: Array.from({ length: 10 }, (_, itemIndex) => ({
        id: `m2-max-fill-list-item-${itemIndex + 1}`,
        sourceRange: null,
        textRuns: [
          {
            id: `m2-max-fill-list-run-${itemIndex + 1}`,
            text: `${itemIndex + 1}. A case in point is ... 示例内容`,
            sourceRange: null,
            marks: itemIndex === 1 ? [{ type: 'bold' as const }] : [],
            charStyleRef: null,
            styleOverrides: itemIndex === 1 ? { color: '#2563eb' } : {},
            annotations: [],
          },
        ],
        level: itemIndex === 2 ? 2 : 1,
        checked: itemIndex === 3 ? true : null,
      })),
    },
  };
  const tinyListContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 120,
  };
  const maxFillListPages = paginateBlocks([maxFillHeadingBlock, maxFillListBlock], tinyListContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const maxFillListFragments = maxFillListPages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'list' && block.metadata.kind === 'list');
  const firstPageListFragment = maxFillListPages[0]?.blocks.find(
    (block) => block.type === 'list' && block.metadata.kind === 'list',
  );
  const splitListItemIds = maxFillListFragments.flatMap((block) =>
    block.metadata.kind === 'list' ? block.metadata.items.map((item) => item.id) : [],
  );
  assert(
    firstPageListFragment &&
      firstPageListFragment.metadata.kind === 'list' &&
      firstPageListFragment.metadata.items.length > 0,
    'M2 冒烟失败：分页测试算法1没有把长列表的首个片段放到标题同页，仍可能产生大空白',
  );
  assert(
    maxFillListFragments.length > 1 &&
      splitListItemIds.join('|') === maxFillListBlock.metadata.items.map((item) => item.id).join('|'),
    'M2 冒烟失败：分页测试算法1列表按项拆分后顺序不正确',
  );
  let expectedListStart = maxFillListBlock.metadata.start ?? 1;
  for (const fragment of maxFillListFragments) {
    assert(
      fragment.metadata.kind === 'list' && fragment.metadata.start === expectedListStart,
      'M2 冒烟失败：分页测试算法1有序列表跨页后起始编号不正确',
    );
    expectedListStart += fragment.metadata.items.length;
  }
  const preservedStyledItem = maxFillListFragments
    .flatMap((block) => (block.metadata.kind === 'list' ? block.metadata.items : []))
    .find((item) => item.id === 'm2-max-fill-list-item-2');
  const preservedTaskItem = maxFillListFragments
    .flatMap((block) => (block.metadata.kind === 'list' ? block.metadata.items : []))
    .find((item) => item.id === 'm2-max-fill-list-item-4');
  assert(
    preservedStyledItem?.textRuns[0]?.styleOverrides.color === '#2563eb' &&
      preservedStyledItem.textRuns[0]?.marks.some((mark) => mark.type === 'bold') &&
      preservedTaskItem?.checked === true,
    'M2 冒烟失败：分页测试算法1列表拆分后没有保留列表项样式或任务勾选状态',
  );

  const longListItemText = '这是一个需要在列表项内部跨页拆分的长文本片段。'.repeat(26);
  const maxFillLongListItemBlock: LayoutBlock = {
    id: 'm2-max-fill-long-list-item',
    type: 'list',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [],
    metadata: {
      kind: 'list',
      ordered: true,
      start: 3,
      spread: false,
      items: [
        {
          id: 'm2-max-fill-long-list-item-1',
          sourceRange: null,
          textRuns: [
            {
              id: 'm2-max-fill-long-list-item-run-1',
              text: longListItemText,
              sourceRange: null,
              marks: [{ type: 'underline' }],
              charStyleRef: null,
              styleOverrides: { backgroundColor: '#fef3c7' },
              annotations: [],
            },
          ],
          level: 2,
          checked: true,
        },
        {
          id: 'm2-max-fill-long-list-item-2',
          sourceRange: null,
          textRuns: [
            {
              id: 'm2-max-fill-long-list-item-run-2',
              text: '后续短列表项',
              sourceRange: null,
              marks: [],
              charStyleRef: null,
              styleOverrides: {},
              annotations: [],
            },
          ],
          level: 1,
          checked: null,
        },
      ],
    },
  };
  const maxFillLongListItemPages = paginateBlocks([maxFillLongListItemBlock], tinyListContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const longListItemFragments = maxFillLongListItemPages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'list' && block.metadata.kind === 'list');
  const longListItemPieces = longListItemFragments
    .flatMap((block) => (block.metadata.kind === 'list' ? block.metadata.items : []))
    .filter((item) => item.id.startsWith('m2-max-fill-long-list-item-1'));
  const longListItemTextAfterSplit = longListItemPieces
    .flatMap((item) => item.textRuns)
    .map((run) => run.text)
    .join('');
  assert(
    longListItemFragments.length > 1 &&
      longListItemPieces.length > 1 &&
      longListItemTextAfterSplit === longListItemText,
    'M2 冒烟失败：分页测试算法1没有按列表项内部文本拆分超长列表项，或拆分后内容顺序不正确',
  );
  assert(
    longListItemPieces.every(
      (item) =>
        item.checked === true &&
        item.level === 2 &&
        item.textRuns.every(
          (run) =>
            run.styleOverrides.backgroundColor === '#fef3c7' &&
            run.marks.some((mark) => mark.type === 'underline'),
        ),
    ),
    'M2 冒烟失败：分页测试算法1列表项内部拆分后没有保留样式、层级或任务勾选状态',
  );
  assert(
    longListItemFragments.every(
      (block) => block.metadata.kind === 'list' && block.metadata.start !== null && block.metadata.start >= 3,
    ),
    'M2 冒烟失败：分页测试算法1列表项内部拆分后有序列表起始编号异常',
  );
  const longListItemHiddenMarkerCount = longListItemPieces.filter((item) =>
    shouldHideLayoutListItemMarker(item),
  ).length;
  const firstLongListItemPiece = longListItemPieces[0];
  assert(firstLongListItemPiece, 'M2 冒烟失败：分页测试算法1列表项内部拆分后缺少首页片段');
  assert(
    !shouldHideLayoutListItemMarker(firstLongListItemPiece) &&
      longListItemHiddenMarkerCount === longListItemPieces.length - 1,
    'M2 冒烟失败：分页测试算法1列表项续页片段没有正确标记隐藏列表符号',
  );
  const longListItemExportHtml = buildExportHtml({
    pages: maxFillLongListItemPages,
    title: '列表项续页符号验证',
  });
  const longListItemHiddenMarkerHtmlCount =
    longListItemExportHtml.match(/data-list-marker-hidden="true"/g)?.length ?? 0;
  assert(
    longListItemHiddenMarkerHtmlCount === longListItemHiddenMarkerCount,
    'M2 冒烟失败：导出 HTML 没有同步隐藏列表项续页符号',
  );
  assert(
    !longListItemExportHtml.includes('data-list-marker-hidden="true"><span class="task-list-checkbox"'),
    'M2 冒烟失败：任务列表项续页不应重复显示勾选框',
  );

  const measuredLineBreakListItemText =
    '核心原则：按章节顺序精学，不跳重点；每学完一章做对应章节练习题（客观题+简单计算题）；整理笔记和错题本。';
  const measuredLineBreakListItemId = 'm2-max-fill-measured-line-break-list-item-1';
  const measuredLineBreakSplitOffset =
    measuredLineBreakListItemText.indexOf('简单计算题') + '简单计算题'.length;
  const maxFillMeasuredLineBreakListBlock: LayoutBlock = {
    id: 'm2-max-fill-measured-line-break-list',
    type: 'list',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [],
    metadata: {
      kind: 'list',
      ordered: true,
      start: 1,
      spread: false,
      items: [
        {
          id: measuredLineBreakListItemId,
          sourceRange: null,
          textRuns: [
            {
              id: 'm2-max-fill-measured-line-break-list-run-1',
              text: measuredLineBreakListItemText,
              sourceRange: null,
              marks: [],
              charStyleRef: null,
              styleOverrides: {},
              annotations: [],
            },
          ],
          level: 1,
          checked: null,
        },
      ],
    },
  };
  const maxFillMeasuredLineBreakPages = paginateBlocks(
    [maxFillMeasuredLineBreakListBlock],
    {
      ...tinyListContract,
      contentHeightPx: 24,
      contentWidthPx: 656,
    },
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
      measuredTextLineBreaks: {
        [measuredLineBreakListItemId]: [
          measuredLineBreakSplitOffset,
          measuredLineBreakListItemText.length,
        ],
      },
    },
  );
  const measuredLineBreakListFragments = maxFillMeasuredLineBreakPages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'list' && block.metadata.kind === 'list');
  const measuredLineBreakFirstText = measuredLineBreakListFragments[0]?.metadata.kind === 'list'
    ? measuredLineBreakListFragments[0].metadata.items[0]?.textRuns.map((run) => run.text).join('')
    : '';
  const measuredLineBreakSecondText = measuredLineBreakListFragments[1]?.metadata.kind === 'list'
    ? measuredLineBreakListFragments[1].metadata.items[0]?.textRuns.map((run) => run.text).join('')
    : '';
  assert(
    measuredLineBreakListFragments.length === 2 &&
      measuredLineBreakFirstText.endsWith('简单计算题') &&
      measuredLineBreakSecondText.startsWith('）；') &&
      !measuredLineBreakFirstText.endsWith('简单计算') &&
      !measuredLineBreakSecondText.startsWith('题）'),
    'M2 冒烟失败：分页测试算法1没有优先使用真实换行测量，仍把“简单计算题”拆成“简单计算 / 题”',
  );

  const maxFillTableIntroBlock: LayoutBlock = {
    id: 'm2-max-fill-table-intro',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-table-intro-run',
        text: '表格前说明\n表格前说明',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '表格前说明\n表格前说明',
    },
  };
  const maxFillMediumTableBlock: LayoutBlock = {
    id: 'm2-max-fill-medium-table',
    type: 'table',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [],
    metadata: {
      kind: 'table',
      align: [null, null],
      columnWidthsPx: [260, 260],
      rows: [
        {
          id: 'm2-max-fill-medium-table-header',
          sourceRange: null,
          heightPx: null,
          cells: [
            {
              id: 'm2-max-fill-medium-table-header-cell-1',
              sourceRange: null,
              textRuns: [
                {
                  id: 'm2-max-fill-medium-table-header-cell-1-run',
                  text: '列 A',
                  sourceRange: null,
                  marks: [],
                  charStyleRef: null,
                  styleOverrides: {},
                  annotations: [],
                },
              ],
              isHeader: true,
            },
            {
              id: 'm2-max-fill-medium-table-header-cell-2',
              sourceRange: null,
              textRuns: [
                {
                  id: 'm2-max-fill-medium-table-header-cell-2-run',
                  text: '列 B',
                  sourceRange: null,
                  marks: [],
                  charStyleRef: null,
                  styleOverrides: {},
                  annotations: [],
                },
              ],
              isHeader: true,
            },
          ],
        },
        ...Array.from({ length: 3 }, (_, rowIndex) => ({
          id: `m2-max-fill-medium-table-row-${rowIndex + 1}`,
          sourceRange: null,
          heightPx: null,
          cells: [
            {
              id: `m2-max-fill-medium-table-row-${rowIndex + 1}-cell-1`,
              sourceRange: null,
              textRuns: [
                {
                  id: `m2-max-fill-medium-table-row-${rowIndex + 1}-cell-1-run`,
                  text: `第 ${rowIndex + 1} 行 A`,
                  sourceRange: null,
                  marks: [],
                  charStyleRef: null,
                  styleOverrides: {},
                  annotations: [],
                },
              ],
              isHeader: false,
            },
            {
              id: `m2-max-fill-medium-table-row-${rowIndex + 1}-cell-2`,
              sourceRange: null,
              textRuns: [
                {
                  id: `m2-max-fill-medium-table-row-${rowIndex + 1}-cell-2-run`,
                  text: `第 ${rowIndex + 1} 行 B`,
                  sourceRange: null,
                  marks: [],
                  charStyleRef: null,
                  styleOverrides: {},
                  annotations: [],
                },
              ],
              isHeader: false,
            },
          ],
        })),
      ],
    },
  };
  const tinyTableContract = {
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 150,
    contentWidthPx: 520,
  };
  const maxFillMediumTablePages = paginateBlocks(
    [maxFillTableIntroBlock, maxFillMediumTableBlock],
    tinyTableContract,
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
    },
  );
  const firstPageMediumTable = maxFillMediumTablePages[0]?.blocks.find(
    (block) => block.type === 'table' && block.metadata.kind === 'table',
  );
  const mediumTableFragments = maxFillMediumTablePages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'table' && block.metadata.kind === 'table');
  const mediumTableRealRowIds = mediumTableFragments.flatMap((block) =>
    block.metadata.kind === 'table'
      ? block.metadata.rows
          .map((row) => row.id)
          .filter((rowId) => !rowId.includes('repeat-header'))
          .map((rowId) => rowId.replace(/-fragment-\d+$/, ''))
      : [],
  );
  assert(
    firstPageMediumTable &&
      firstPageMediumTable.metadata.kind === 'table' &&
      firstPageMediumTable.metadata.rows.length > 1,
    'M2 冒烟失败：分页测试算法1没有把页尾中等表格的可容纳行留在当前页',
  );
  assert(
    mediumTableFragments.length > 1 &&
      mediumTableRealRowIds.join('|') ===
        maxFillMediumTableBlock.metadata.rows.map((row) => row.id).join('|'),
    'M2 冒烟失败：分页测试算法1中等表格按行拆分后行顺序不正确',
  );

  const longTableCellText =
    '这是一个需要跨页拆分的长表格单元格内容。'.repeat(24);
  const maxFillLongRowTableBlock: LayoutBlock = {
    id: 'm2-max-fill-long-row-table',
    type: 'table',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [],
    metadata: {
      kind: 'table',
      align: [null, null],
      columnWidthsPx: [260, 260],
      rows: [
        {
          id: 'm2-max-fill-long-row-header',
          sourceRange: null,
          heightPx: null,
          cells: [
            {
              id: 'm2-max-fill-long-row-header-cell-1',
              sourceRange: null,
              textRuns: [
                {
                  id: 'm2-max-fill-long-row-header-cell-1-run',
                  text: '说明',
                  sourceRange: null,
                  marks: [],
                  charStyleRef: null,
                  styleOverrides: {},
                  annotations: [],
                },
              ],
              isHeader: true,
            },
            {
              id: 'm2-max-fill-long-row-header-cell-2',
              sourceRange: null,
              textRuns: [
                {
                  id: 'm2-max-fill-long-row-header-cell-2-run',
                  text: '备注',
                  sourceRange: null,
                  marks: [],
                  charStyleRef: null,
                  styleOverrides: {},
                  annotations: [],
                },
              ],
              isHeader: true,
            },
          ],
        },
        {
          id: 'm2-max-fill-long-row',
          sourceRange: null,
          heightPx: null,
          cells: [
            {
              id: 'm2-max-fill-long-row-cell-1',
              sourceRange: null,
              textRuns: [
                {
                  id: 'm2-max-fill-long-row-cell-1-run',
                  text: longTableCellText,
                  sourceRange: null,
                  marks: [{ type: 'bold' }],
                  charStyleRef: null,
                  styleOverrides: { color: '#16a34a' },
                  annotations: [],
                },
              ],
              isHeader: false,
            },
            {
              id: 'm2-max-fill-long-row-cell-2',
              sourceRange: null,
              textRuns: [
                {
                  id: 'm2-max-fill-long-row-cell-2-run',
                  text: '短备注',
                  sourceRange: null,
                  marks: [],
                  charStyleRef: null,
                  styleOverrides: {},
                  annotations: [],
                },
              ],
              isHeader: false,
            },
          ],
        },
      ],
    },
  };
  const maxFillLongRowPages = paginateBlocks([maxFillLongRowTableBlock], tinyTableContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const longRowFragments = maxFillLongRowPages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'table' && block.metadata.kind === 'table');
  const longRowCellRuns = longRowFragments.flatMap((block) =>
    block.metadata.kind === 'table'
      ? block.metadata.rows
          .filter((row) => row.id.includes('m2-max-fill-long-row-split'))
          .flatMap((row) => row.cells[0]?.textRuns ?? [])
      : [],
  );
  const longRowCellTextAfterSplit = longRowCellRuns.map((run) => run.text).join('');
  assert(
    longRowFragments.length > 1 && longRowCellTextAfterSplit === longTableCellText,
    'M2 冒烟失败：分页测试算法1长表格行按单元格拆分后内容顺序不正确',
  );
  assert(
    longRowCellRuns.every(
      (run) =>
        run.styleOverrides.color === '#16a34a' &&
        run.marks.some((mark) => mark.type === 'bold'),
    ),
    'M2 冒烟失败：分页测试算法1长表格行拆分后没有保留单元格 TextRun 样式',
  );

  const wrappedImageHtml = buildExportHtml({
    pages: paginateBlocks([imageWithOffset, styledParagraph], resolveStyleContract(defaultStyleSettings)),
    title: '图片环绕导出验证',
  });
  for (const fragment of ['image-wrap-square', 'image-wrap-side-right', 'float:right', 'margin-left:16px']) {
    assert(wrappedImageHtml.includes(fragment), `M2 冒烟失败：图片环绕导出 HTML 缺少关键片段 ${fragment}`);
  }

  // 验证默认不显示标题时导出 HTML 不包含 figcaption
  const imageWithoutCaption = updateLayoutImageAttributes(imageBlock, {
    src: 'C:\\测试图片\\m2-smoke-updated.png',
    alt: 'M2 图片说明',
    title: 'M2 图片标题',
    showCaption: false,
  });
  const imageWithoutCaptionHtml = buildExportHtml({
    pages: paginateBlocks([imageWithoutCaption], resolveStyleContract(defaultStyleSettings)),
    title: '无标题图片验证',
  });
  assert(
    !imageWithoutCaptionHtml.includes('<figcaption>'),
    'M2 冒烟失败：图片 showCaption=false 时导出 HTML 不应包含 figcaption',
  );

  // 验证显示标题时导出 HTML 包含 figcaption
  const imageWithCaptionHtml = buildExportHtml({
    pages: paginateBlocks([imageWithCaption], resolveStyleContract(defaultStyleSettings)),
    title: '有标题图片验证',
  });
  assert(
    imageWithCaptionHtml.includes('<figcaption>'),
    'M2 冒烟失败：图片 showCaption=true 时导出 HTML 应包含 figcaption',
  );

  console.log(`M2 冒烟验证通过：${restoredProject.document.blocks.length} 个结构块，${pages.length} 页，${tocItems.length} 个目录项。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
