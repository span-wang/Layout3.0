import {
  applyBlockStyleOverridesToBlock,
  applyPageNumbersToTocItems,
  applyTextStyleToBlock,
  autoFitTablesInLayoutDocument,
  buildHeadingPageNumberMap,
  buildTocItems,
  buildFontFaceCss,
  buildFontFamilyGroupsWithImportedFonts,
  createLayoutDocumentFromMarkdown,
  createEmptyLayoutDocument,
  estimateImageVisibleHeightPx,
  getVisibleTocItemsForBlock,
  insertEquationBlockAfterNode,
  insertTocBlockAfterNode,
  mergeTopLevelTextBlocksByIds,
  mergeTableCellsByRange,
  parseLayoutProjectFile,
  resolveHangingIndentStyle,
  resolveImageLayout,
  resolveTableAutoFitSize,
  resolveTableColumnWidths,
  resolveTableRowHeightPx,
  serializeLayoutProjectFile,
  shouldHideLayoutListItemMarker,
  toggleTextMarkOnBlock,
  updateLayoutImageAttributes,
  updateTableAutoFitSizeByCell,
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
  clearBlockSpacingPresetLibrary,
  loadBlockSpacingPresetLibrary,
} from '../src/services/BlockSpacingPresetLibraryService.ts';
import {
  DOM_MEASURE_PAGINATION_ALGORITHM_ID,
  MAX_FILL_PAGINATION_ALGORITHM_ID,
  listPaginationAlgorithms,
  paginateBlocks,
  type TableRowMeasurementJob,
  type TextFragmentMeasurementJob,
} from '../src/engine/typesetting/index.ts';
import { clearAllBlockHeightCache } from '../src/engine/typesetting/algorithms/estimatedMaxFill.ts';
import {
  createDeterministicFontMetricsProvider,
  setFontMetricsProvider,
} from '../src/engine/font-metrics';
import { useAppStore } from '../src/store/index.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

setFontMetricsProvider(createDeterministicFontMetricsProvider());

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function replaceBlock(blocks: LayoutBlock[], nextBlock: LayoutBlock): LayoutBlock[] {
  return blocks.map((block) => (block.id === nextBlock.id ? nextBlock : block));
}

function withTestPageMetrics<T extends { contentHeightPx: number; contentWidthPx: number }>(
  contract: T & { columnCount?: number; columnGapPx?: number },
): T & { columnPageCapacityPx: number; singleColumnContentWidthPx: number } {
  // 分栏接入后分页看单栏宽度和 columnPageCapacityPx；测试里手动改宽高时必须同步这两个派生值。
  const columnCount = Math.max(1, contract.columnCount ?? 1);
  const columnGapPx = columnCount > 1 ? Math.max(0, contract.columnGapPx ?? 0) : 0;
  return {
    ...contract,
    singleColumnContentWidthPx:
      columnCount > 1
        ? (contract.contentWidthPx - (columnCount - 1) * columnGapPx) / columnCount
        : contract.contentWidthPx,
    columnPageCapacityPx: contract.contentHeightPx * columnCount,
  };
}

async function main(): Promise<void> {
  const previousLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createMemoryStorage(),
  });

  clearBlockSpacingPresetLibrary();

  try {
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

  const columnBreakInsertedDocument = await createLayoutDocumentFromMarkdown('# 分栏断点冒烟\n\n正文一');
  useAppStore.getState().loadDocument({
    title: columnBreakInsertedDocument.title,
    filePath: null,
    source: columnBreakInsertedDocument.source,
    documentFormat: 'layout',
    layoutDocument: columnBreakInsertedDocument,
  });
  const insertedColumnBreakId = useAppStore.getState().insertLayoutColumnBreakBlock({
    insertAfterNodeId: columnBreakInsertedDocument.blocks[0]?.id ?? null,
  });
  assert(insertedColumnBreakId, 'M2 冒烟失败：未能插入分栏断点');
  const columnBreakDocument = useAppStore.getState().layoutDocument;
  const columnBreakBlockCount =
    columnBreakDocument?.blocks.filter((block) => block.type === 'columnBreak').length ?? 0;
  assert(columnBreakBlockCount === 1, 'M2 冒烟失败：分栏断点没有进入文档模型');
  const columnBreakProjectFile = serializeLayoutProjectFile({
    document: columnBreakDocument!,
    styleSettings: cloneStyleSettings(defaultStyleSettings),
  });
  const reopenedColumnBreakProject = parseLayoutProjectFile(columnBreakProjectFile);
  assert(
    reopenedColumnBreakProject.document.blocks.some(
      (block) => block.type === 'columnBreak' && block.metadata.kind === 'columnBreak',
    ),
    'M2 冒烟失败：分栏断点保存重开后没有恢复',
  );

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
    styleSettings: cloneStyleSettings(defaultStyleSettings),
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
        styleSettings: cloneStyleSettings(defaultStyleSettings),
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
  assert(
    tableBlock.metadata.columnWidthsPx?.every((width) => width === null) &&
      tableBlock.metadata.rows.every((row) => row.heightPx === null),
    'M2 冒烟失败：Markdown 原始表格应先保持未显式设置尺寸，便于验证导入预适应',
  );
  const importAutoFitResult = autoFitTablesInLayoutDocument(document, cloneStyleSettings(defaultStyleSettings));
  const importAutoFitTable = importAutoFitResult.document.blocks.find(
    (block) => block.id === tableBlock.id && block.type === 'table' && block.metadata.kind === 'table',
  );
  assert(
    importAutoFitResult.didUpdate &&
      importAutoFitTable?.type === 'table' &&
      importAutoFitTable.metadata.kind === 'table' &&
      importAutoFitTable.metadata.columnWidthsPx?.every((width) => typeof width === 'number' && width > 0) &&
      importAutoFitTable.metadata.rows.every((row) => typeof row.heightPx === 'number' && row.heightPx > 0),
    'M2 冒烟失败：Markdown 导入后的表格没有在首次渲染前写入自适应列宽行高',
  );
  const importAutoFitPreserveResult = autoFitTablesInLayoutDocument(
    {
      ...document,
      blocks: replaceBlock(document.blocks, {
        ...tableBlock,
        metadata: {
          ...tableBlock.metadata,
          columnWidthsPx: [188, 122, 210],
          rows: tableBlock.metadata.rows.map((row) => ({ ...row, heightPx: 57 })),
        },
      }),
    },
    cloneStyleSettings(defaultStyleSettings),
  );
  const preservedImportTable = importAutoFitPreserveResult.document.blocks.find(
    (block) => block.id === tableBlock.id && block.type === 'table' && block.metadata.kind === 'table',
  );
  assert(
    !importAutoFitPreserveResult.didUpdate &&
      preservedImportTable?.type === 'table' &&
      preservedImportTable.metadata.kind === 'table' &&
      preservedImportTable.metadata.columnWidthsPx?.[0] === 188 &&
      preservedImportTable.metadata.rows[0]?.heightPx === 57,
    'M2 冒烟失败：导入预适应不应覆盖已保存的表格列宽行高',
  );
  useAppStore.getState().setLayoutDocument({
    ...document,
    blocks: replaceBlock(document.blocks, {
      ...tableBlock,
      metadata: {
        ...tableBlock.metadata,
        columnWidthsPx: tableBlock.metadata.rows[0]?.cells.map(() => 120) ?? [],
        rows: tableBlock.metadata.rows.map((row, rowIndex) => ({
          ...row,
          heightPx: rowIndex === 0 ? 32 : 30,
          cells: row.cells.map((cell, cellIndex) => ({
            ...cell,
            textRuns: [
              {
                id: `${cell.id}-store-autofit-run`,
                text: cellIndex === 1
                  ? 'store 自动适应验证使用的长内容，需要让当前列变宽并让行高随内容抬高'
                  : '短内容',
                sourceRange: null,
                marks: [],
                charStyleRef: null,
                styleOverrides: cellIndex === 1 ? { fontSize: 20 } : {},
                annotations: [],
              },
            ],
          })),
        })),
      },
    }),
  });
  const autoFitHistoryLengthBefore = useAppStore.getState().documentHistoryPast.length;
  const storeAutoFitSelectedNodeId = useAppStore.getState().autoFitLayoutTableSize({
    cellId: firstCellId,
    contentWidthPx: 520,
    rowHeightPx: 40,
    headerRowHeightPx: 44,
    cellPaddingX: 12,
    cellPaddingY: 10,
    baseFontSizePx: 16,
    baseLineHeightPx: 24,
  });
  const storeAutoFitTable = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === tableBlock.id);
  assert(
    storeAutoFitSelectedNodeId === firstCellId &&
      storeAutoFitTable?.type === 'table' &&
      storeAutoFitTable.metadata.kind === 'table' &&
      (storeAutoFitTable.metadata.columnWidthsPx?.[1] ?? 0) > (storeAutoFitTable.metadata.columnWidthsPx?.[0] ?? 0) &&
      storeAutoFitTable.metadata.rows.some((row) => (row.heightPx ?? 0) > 44) &&
      useAppStore.getState().documentHistoryPast.length === autoFitHistoryLengthBefore + 1,
    'M2 冒烟失败：store 表格自动适应没有写回列宽行高或没有进入一次历史栈',
  );
  const defaultAutoFitDocument = await createLayoutDocumentFromMarkdown('# 默认表格自适应\n\n起始段落');
  useAppStore.getState().replaceStyleSettings(cloneStyleSettings(defaultStyleSettings));
  useAppStore.getState().loadDocument({
    title: '默认表格自适应',
    filePath: null,
    source: defaultAutoFitDocument.source,
    documentFormat: 'layout',
    layoutDocument: defaultAutoFitDocument,
  });
  const defaultAutoFitHistoryBeforeInsert = useAppStore.getState().documentHistoryPast.length;
  const insertedDefaultFitCellId = useAppStore.getState().insertLayoutTableBlock({
    rowCount: 2,
    columnCount: 3,
  });
  assert(insertedDefaultFitCellId, 'M2 冒烟失败：默认自适应测试未能插入表格');
  const insertedDefaultFitTable = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.type === 'table' && block.metadata.kind === 'table');
  assert(
    insertedDefaultFitTable?.type === 'table' &&
      insertedDefaultFitTable.metadata.kind === 'table' &&
      insertedDefaultFitTable.metadata.columnWidthsPx?.length === 3 &&
      insertedDefaultFitTable.metadata.columnWidthsPx.every((width) => typeof width === 'number' && width > 0) &&
      insertedDefaultFitTable.metadata.rows.every((row) => typeof row.heightPx === 'number' && row.heightPx > 0) &&
      useAppStore.getState().documentHistoryPast.length === defaultAutoFitHistoryBeforeInsert + 1,
    'M2 冒烟失败：新插入表格没有默认写回最佳列宽行高或历史栈异常',
  );
  const defaultFitFirstWidthBeforeText = insertedDefaultFitTable.metadata.columnWidthsPx?.[0] ?? 0;
  const defaultFitSecondWidthBeforeText = insertedDefaultFitTable.metadata.columnWidthsPx?.[1] ?? 0;
  const defaultFitSecondCellId = insertedDefaultFitTable.metadata.rows[0]?.cells[1]?.id;
  assert(defaultFitSecondCellId, 'M2 冒烟失败：默认自适应测试缺少第二列单元格');
  const defaultAutoFitHistoryBeforeText = useAppStore.getState().documentHistoryPast.length;
  useAppStore.getState().updateLayoutNodeText({
    nodeId: defaultFitSecondCellId,
    text: '默认启用后，保存单元格长内容时应该自动重新适应列宽和行高，不需要再点右侧按钮。',
  });
  const textDefaultFitTable = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === insertedDefaultFitTable.id);
  assert(
    textDefaultFitTable?.type === 'table' &&
      textDefaultFitTable.metadata.kind === 'table' &&
      (textDefaultFitTable.metadata.columnWidthsPx?.[1] ?? 0) > defaultFitSecondWidthBeforeText &&
      (textDefaultFitTable.metadata.columnWidthsPx?.[0] ?? 0) < defaultFitFirstWidthBeforeText &&
      textDefaultFitTable.metadata.rows.some((row) => (row.heightPx ?? 0) > 0) &&
      useAppStore.getState().documentHistoryPast.length === defaultAutoFitHistoryBeforeText + 1,
    'M2 冒烟失败：单元格内容保存后没有默认重新适应表格尺寸或历史栈异常',
  );
  const defaultAutoFitHistoryBeforeStructure = useAppStore.getState().documentHistoryPast.length;
  const insertedStructureCellId = useAppStore.getState().updateLayoutTableStructure({
    cellId: defaultFitSecondCellId,
    action: 'insertColumnRight',
  });
  const structureDefaultFitTable = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === insertedDefaultFitTable.id);
  assert(
    insertedStructureCellId &&
      structureDefaultFitTable?.type === 'table' &&
      structureDefaultFitTable.metadata.kind === 'table' &&
      structureDefaultFitTable.metadata.columnWidthsPx?.length === 4 &&
      structureDefaultFitTable.metadata.columnWidthsPx.every((width) => typeof width === 'number' && width > 0) &&
      useAppStore.getState().documentHistoryPast.length === defaultAutoFitHistoryBeforeStructure + 1,
    'M2 冒烟失败：表格结构变化后没有默认重新适应列宽或历史栈异常',
  );
  const mergeSourceRows = structureDefaultFitTable.metadata.rows;
  const defaultFitMergeTargetCellId = mergeSourceRows[1]?.cells[1]?.id;
  assert(defaultFitMergeTargetCellId, 'M2 冒烟失败：默认自适应合并测试缺少目标单元格');
  useAppStore.getState().selectLayoutTableCell({ cellId: defaultFitSecondCellId });
  useAppStore.getState().selectLayoutTableCell({ cellId: defaultFitMergeTargetCellId, extendRange: true });
  const defaultAutoFitHistoryBeforeMerge = useAppStore.getState().documentHistoryPast.length;
  const storeDefaultMergeResult = useAppStore.getState().mergeLayoutSelectedTableCells();
  const mergeDefaultFitTable = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.id === insertedDefaultFitTable.id);
  assert(
    storeDefaultMergeResult.didUpdate &&
      mergeDefaultFitTable?.type === 'table' &&
      mergeDefaultFitTable.metadata.kind === 'table' &&
      mergeDefaultFitTable.metadata.rows[0]?.cells[1]?.rowSpan === 2 &&
      mergeDefaultFitTable.metadata.rows[0]?.cells[1]?.colSpan === 1 &&
      mergeDefaultFitTable.metadata.rows[1]?.cells[1]?.coveredByCellId === defaultFitSecondCellId &&
      mergeDefaultFitTable.metadata.columnWidthsPx?.every((width) => typeof width === 'number' && width > 0) &&
      mergeDefaultFitTable.metadata.rows.every((row) => typeof row.heightPx === 'number' && row.heightPx > 0) &&
      useAppStore.getState().documentHistoryPast.length === defaultAutoFitHistoryBeforeMerge + 1,
    'M2 冒烟失败：合并单元格后没有默认重新适应表格尺寸或历史栈异常',
  );
  const markdownInsertDocument = await createLayoutDocumentFromMarkdown('# 插入 Markdown 表格');
  useAppStore.getState().loadDocument({
    title: '插入 Markdown 表格',
    filePath: null,
    source: markdownInsertDocument.source,
    documentFormat: 'layout',
    layoutDocument: markdownInsertDocument,
  });
  const insertedMarkdownTableNodeId = await useAppStore.getState().insertLayoutMarkdownBlocks({
    markdown: [
      '| 项目 | 说明 |',
      '| --- | --- |',
      '| 导入表格 | 这段长内容用于验证 Markdown 片段插入时也会在首次渲染前写入自适应尺寸 |',
    ].join('\n'),
  });
  const insertedMarkdownTable = useAppStore
    .getState()
    .layoutDocument?.blocks.find((block) => block.type === 'table' && block.metadata.kind === 'table');
  assert(
    insertedMarkdownTableNodeId &&
      insertedMarkdownTable?.type === 'table' &&
      insertedMarkdownTable.metadata.kind === 'table' &&
      insertedMarkdownTable.metadata.columnWidthsPx?.every((width) => typeof width === 'number' && width > 0) &&
      insertedMarkdownTable.metadata.rows.every((row) => typeof row.heightPx === 'number' && row.heightPx > 0),
    'M2 冒烟失败：Markdown 片段插入表格没有在进入渲染前完成自适应尺寸写回',
  );

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
  const autoFitSourceTable: LayoutBlock = {
    ...tableWithSize,
    metadata: {
      ...tableWithSize.metadata,
      columnWidthsPx: [120, 120, 120],
      rows: tableWithSize.metadata.rows.map((row, rowIndex) => ({
        ...row,
        heightPx: rowIndex === 0 ? 32 : 30,
        cells: row.cells.map((cell, cellIndex) => ({
          ...cell,
          textRuns: [
            {
              id: `${cell.id}-autofit-run`,
              text: cellIndex === 1
                ? '这是一个需要更宽列宽和更高行高的长单元格内容，用来验证表格自动适应能力'
                : cellIndex === 0
                  ? '短项'
                  : '中等内容',
              sourceRange: null,
              marks: [],
              charStyleRef: null,
              styleOverrides: cellIndex === 1 ? { fontSize: 20 } : {},
              annotations: [],
            },
          ],
        })),
      })),
    },
  };
  const autoFitSize = resolveTableAutoFitSize(autoFitSourceTable, {
    contentWidthPx: 520,
    rowHeightPx: 40,
    headerRowHeightPx: 44,
    cellPaddingX: 12,
    cellPaddingY: 10,
    getCellMetrics: ({ cell }) => {
      const fontSizePx = cell.textRuns[0]?.styleOverrides.fontSize ?? 16;
      return {
        fontSizePx,
        lineHeightPx: fontSizePx > 16 ? 28 : 24,
      };
    },
  });
  assert(autoFitSize, 'M2 冒烟失败：表格自动适应没有返回尺寸');
  assert(
    autoFitSize.columnWidthsPx.length === 3 &&
      autoFitSize.columnWidthsPx.reduce((total, width) => total + width, 0) === 520,
    `M2 冒烟失败：表格自动适应列宽没有填满正文宽度，实际为 ${autoFitSize.columnWidthsPx.join(',')}`,
  );
  assert(
    autoFitSize.columnWidthsPx[1] > autoFitSize.columnWidthsPx[0],
    `M2 冒烟失败：表格自动适应没有让长内容列更宽，实际为 ${autoFitSize.columnWidthsPx.join(',')}`,
  );
  assert(
    autoFitSize.rowHeightsPx.some((height) => height > 44),
    `M2 冒烟失败：表格自动适应没有按内容抬高行高，实际为 ${autoFitSize.rowHeightsPx.join(',')}`,
  );
  const autoFitResult = updateTableAutoFitSizeByCell(autoFitSourceTable, firstCellId, {
    contentWidthPx: 520,
    rowHeightPx: 40,
    headerRowHeightPx: 44,
    cellPaddingX: 12,
    cellPaddingY: 10,
    getCellMetrics: ({ cell }) => {
      const fontSizePx = cell.textRuns[0]?.styleOverrides.fontSize ?? 16;
      return {
        fontSizePx,
        lineHeightPx: fontSizePx > 16 ? 28 : 24,
      };
    },
  });
  assert(
    autoFitResult.didUpdate &&
      autoFitResult.block.type === 'table' &&
      autoFitResult.block.metadata.kind === 'table' &&
      autoFitResult.block.metadata.columnWidthsPx?.[1] === autoFitSize.columnWidthsPx[1] &&
      autoFitResult.block.metadata.rows.some((row) => (row.heightPx ?? 0) > 44),
    'M2 冒烟失败：表格自动适应模型写回没有同时更新列宽和行高',
  );
  const autoFitExportHtml = buildExportHtml({
    pages: paginateBlocks([autoFitResult.block], resolveStyleContract(defaultStyleSettings)),
    title: '表格自动适应导出验证',
  });
  assert(
    autoFitExportHtml.includes(`width:${autoFitSize.columnWidthsPx[1]}px`) &&
      autoFitExportHtml.includes(`height:${autoFitResult.block.metadata.rows[0]?.heightPx}px`),
    'M2 冒烟失败：表格自动适应后的导出 HTML 没有消费列宽或行高',
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
    pageBackground: {
      mode: 'image',
      color: '#f7fbff',
      imageSrc: 'C:\\测试背景\\paper.png',
      imageFit: 'cover',
    },
    marginMode: 'custom',
    customMarginsMm: {
      top: 18,
      right: 16,
      bottom: 18,
      left: 16,
    },
    headerFooterContent: {
      header: {
        left: '讲义：{文档标题}',
        center: '{本页标题}',
        right: '{页码}/{总页数}',
      },
      footer: {
        left: '{模板主题}',
        center: '内部练习',
        right: '{页面规格}',
      },
    },
    columns: {
      count: 2,
      gapMm: 10,
      divider: true,
      headingsSpanAll: false,
    },
    paginationAlgorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
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
    restoredProject.styleSettings.pageBackground.mode === 'image' &&
      restoredProject.styleSettings.pageBackground.color === '#f7fbff' &&
      restoredProject.styleSettings.pageBackground.imageSrc === 'C:\\测试背景\\paper.png' &&
      restoredProject.styleSettings.pageBackground.imageFit === 'cover',
    'M2 冒烟失败：layout 工程文件没有恢复页面背景配置',
  );
  assert(
    restoredProject.styleSettings.headerFooterContent.header.left === '讲义：{文档标题}' &&
      restoredProject.styleSettings.headerFooterContent.header.right === '{页码}/{总页数}' &&
      restoredProject.styleSettings.headerFooterContent.footer.center === '内部练习',
    'M2 冒烟失败：layout 工程文件没有恢复页眉页脚内容配置',
  );
  assert(
    restoredProject.styleSettings.columns.count === 2 &&
      restoredProject.styleSettings.columns.gapMm === 10 &&
      restoredProject.styleSettings.columns.divider === true &&
      restoredProject.styleSettings.columns.headingsSpanAll === false,
    'M2 冒烟失败：layout 工程文件没有恢复分栏配置',
  );
  const headingSpanAllProject = parseLayoutProjectFile(
    serializeLayoutProjectFile({
      document,
      styleSettings: cloneStyleSettings({
        ...styleSettings,
        columns: {
          ...styleSettings.columns,
          headingsSpanAll: true,
        },
      }),
    }),
  );
  assert(
    headingSpanAllProject.styleSettings.columns.headingsSpanAll === true,
    'M2 冒烟失败：标题不参与分栏开关没有随 layout 工程文件保存恢复',
  );
  assert(
    restoredProject.styleSettings.paginationAlgorithmId === MAX_FILL_PAGINATION_ALGORITHM_ID,
    'M2 冒烟失败：layout 工程文件没有恢复分页算法选择',
  );
  const restoredLegacyAlgorithmProject = parseLayoutProjectFile(
    JSON.stringify(
      {
        ...JSON.parse(serialized),
        styleSettings: {
          ...JSON.parse(serialized).styleSettings,
          paginationAlgorithmId: 'estimated-cost-v1',
        },
      },
      null,
      2,
    ),
  );
  assert(
    restoredLegacyAlgorithmProject.styleSettings.paginationAlgorithmId === MAX_FILL_PAGINATION_ALGORITHM_ID,
    'M2 冒烟失败：旧分页算法 ID 没有回退到分页测试算法1',
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
  const legacyColumnsProjectFile = JSON.stringify(
    {
      ...JSON.parse(serialized),
      styleSettings: {
        ...JSON.parse(serialized).styleSettings,
        columns: {
          count: 2,
          gapMm: 10,
          divider: true,
        },
      },
    },
    null,
    2,
  );
  const restoredLegacyColumnsProject = parseLayoutProjectFile(legacyColumnsProjectFile);
  assert(
    restoredLegacyColumnsProject.styleSettings.columns.headingsSpanAll === false,
    'M2 冒烟失败：旧 layout 工程文件缺少标题跨栏字段时没有默认让标题参与分栏',
  );
  const handDrawnStyleSettings = cloneStyleSettings({
    ...defaultStyleSettings,
    templateId: 'notes',
    themeId: 'handDrawn',
  });
  const handDrawnProjectFile = serializeLayoutProjectFile({
    document,
    styleSettings: handDrawnStyleSettings,
  });
  const restoredHandDrawnProject = parseLayoutProjectFile(handDrawnProjectFile);
  const handDrawnContract = resolveStyleContract(restoredHandDrawnProject.styleSettings);
  assert(
    restoredHandDrawnProject.styleSettings.themeId === 'handDrawn' &&
      handDrawnContract.themeLabel === '手绘札记' &&
      handDrawnContract.themeTokens.tableBorderColor === '#3A2E25',
    'M2 冒烟失败：手绘札记主题没有保存恢复或进入样式契约',
  );
  assert(
    handDrawnContract.themeLayoutMetrics.heading1.paddingBottom === 10 &&
      handDrawnContract.themeLayoutMetrics.heading2.underlineOccupiesFlow === true &&
      handDrawnContract.themeLayoutMetrics.heading2.underlineHeight === 8 &&
      handDrawnContract.themeLayoutMetrics.heading2.markerInsetLeft === 12,
    'M2 冒烟失败：手绘主题标题装饰占位没有进入分页样式契约',
  );
  const unknownThemeProjectFile = JSON.stringify(
    {
      ...JSON.parse(serialized),
      styleSettings: {
        ...JSON.parse(serialized).styleSettings,
        themeId: 'missing-theme',
      },
    },
    null,
    2,
  );
  const restoredUnknownThemeProject = parseLayoutProjectFile(unknownThemeProjectFile);
  assert(
    restoredUnknownThemeProject.styleSettings.themeId === 'default',
    'M2 冒烟失败：未知 themeId 没有回退到默认主题',
  );
  const legacyHeaderFooterProjectFile = JSON.stringify(
    {
      ...JSON.parse(serialized),
      styleSettings: {
        ...JSON.parse(serialized).styleSettings,
        headerFooterContent: undefined,
      },
    },
    null,
    2,
  );
  const restoredLegacyHeaderFooterProject = parseLayoutProjectFile(legacyHeaderFooterProjectFile);
  assert(
    restoredLegacyHeaderFooterProject.styleSettings.headerFooterContent.header.left === '{本页标题}' &&
      restoredLegacyHeaderFooterProject.styleSettings.headerFooterContent.footer.right === '{页码}',
    'M2 冒烟失败：旧工程文件缺少页眉页脚内容时没有回退到默认配置',
  );
  const legacyPageBackgroundProjectFile = JSON.stringify(
    {
      ...JSON.parse(serialized),
      styleSettings: {
        ...JSON.parse(serialized).styleSettings,
        pageBackground: undefined,
      },
    },
    null,
    2,
  );
  const restoredLegacyPageBackgroundProject = parseLayoutProjectFile(legacyPageBackgroundProjectFile);
  assert(
    restoredLegacyPageBackgroundProject.styleSettings.pageBackground.mode === 'theme' &&
      restoredLegacyPageBackgroundProject.styleSettings.pageBackground.imageSrc === '',
    'M2 冒烟失败：旧工程文件缺少页面背景配置时没有回退到跟随主题',
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
    contract.pageBackground.mode === 'image' &&
      contract.pageBackground.imageFit === 'cover' &&
      contract.pageBackground.imageSrc === 'C:\\测试背景\\paper.png',
    'M2 冒烟失败：页面背景配置没有进入样式契约',
  );
  assert(
    contract.columnCount === 2 &&
      contract.columnGapMm === 10 &&
      contract.singleColumnContentWidthPx < contract.contentWidthPx &&
      contract.columnPageCapacityPx === contract.contentHeightPx * 2 &&
      contract.headingsSpanAll === false,
    'M2 冒烟失败：分栏样式契约没有正确计算单栏宽度、多栏页容量或标题分栏默认值',
  );
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

  useAppStore.getState().replaceStyleSettings(cloneStyleSettings(defaultStyleSettings));
  useAppStore.getState().setHeaderFooterContentSlot({
    area: 'header',
    slot: 'center',
    value: 'Store 页眉',
  });
  assert(
    useAppStore.getState().styleSettings.headerFooterContent.header.center === 'Store 页眉',
    'M2 冒烟失败：store 没有正确写回页眉页脚内容',
  );
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
  useAppStore.getState().replaceStyleSettings(cloneStyleSettings(defaultStyleSettings));
  assert(
    useAppStore.getState().styleSettings.customBlockSpacingPresets.some(
      (preset) => preset.id === smokePresetId && preset.name === '冒烟预设重命名',
    ) &&
      useAppStore.getState().styleSettings.blockSpacing.paragraphSpaceAfter ===
        defaultStyleSettings.blockSpacing.paragraphSpaceAfter,
    'M2 冒烟失败：切换文件后自定义块排版预设没有继续显示，或错误篡改了当前文档参数',
  );
  assert(
    loadBlockSpacingPresetLibrary().some(
      (preset) => preset.id === smokePresetId && preset.description === '描述已更新',
    ),
    'M2 冒烟失败：本机块排版预设库没有保存自定义预设',
  );
  const pages = paginateBlocks(restoredProject.document.blocks, contract, {
    algorithmId: restoredProject.styleSettings.paginationAlgorithmId,
    styles: restoredProject.document.styles,
  });
  assert(pages.length >= 2, `M2 冒烟失败：分页结果页数异常，实际为 ${pages.length}`);
  const paginationAlgorithmIds = listPaginationAlgorithms().map((algorithm) => algorithm.id);
  assert(
    paginationAlgorithmIds.includes(MAX_FILL_PAGINATION_ALGORITHM_ID) &&
      paginationAlgorithmIds.includes(DOM_MEASURE_PAGINATION_ALGORITHM_ID),
    `M2 冒烟失败：分页算法注册表没有同时包含旧引擎和真实测量引擎，实际为 ${paginationAlgorithmIds.join(', ') || '空'}`,
  );
  const domMeasurePages = paginateBlocks(restoredProject.document.blocks, contract, {
    algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
    styles: restoredProject.document.styles,
  });
  assert(domMeasurePages.length >= 2, `M2 冒烟失败：真实测量分页引擎单栏分页结果页数异常，实际为 ${domMeasurePages.length}`);
  const domMeasureTextContract = withTestPageMetrics({
    ...contract,
    contentHeightPx: 56,
    columnCount: 1,
  });
  const domMeasureTextBlock: LayoutBlock = {
    id: 'dom-measure-smoke-text',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: 'paragraph',
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'dom-measure-smoke-text-run',
        text: '这是一段用于验证真实测量分页引擎运行时文本分片的长段落内容。'.repeat(24),
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '这是一段用于验证真实测量分页引擎运行时文本分片的长段落内容。'.repeat(24),
    },
  };
  const domMeasureTextPages = paginateBlocks([domMeasureTextBlock], domMeasureTextContract, {
    algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
  });
  assert(domMeasureTextPages.length >= 2, 'M2 冒烟失败：真实测量分页引擎长段落测试没有产生跨页结果');
  assert(
    domMeasureTextPages.some(
      (page) =>
        page.blocks.some(
          (block) => block.id.includes('dom-measure-smoke-text') && block.id !== domMeasureTextBlock.id,
        ),
    ),
    'M2 冒烟失败：真实测量分页引擎没有生成运行时文本分页片段',
  );
  const domMeasureFragmentJobs: TextFragmentMeasurementJob[] = [];
  paginateBlocks([domMeasureTextBlock], domMeasureTextContract, {
    algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
    measuredTextLineBreaks: {
      [domMeasureTextBlock.id]: [16, 32, domMeasureTextBlock.metadata.text.length],
    },
    textFragmentMeasurementJobs: domMeasureFragmentJobs,
  });
  assert(
    domMeasureFragmentJobs.length >= 2 &&
      domMeasureFragmentJobs.some((job) => job.endOffset === 16) &&
      domMeasureFragmentJobs.some((job) => job.endOffset === 32),
    'M2 冒烟失败：真实测量分页引擎没有为候选文本片段生成测量任务',
  );
  const domMeasureMeasuredFragmentPages = paginateBlocks([domMeasureTextBlock], domMeasureTextContract, {
    algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
    measuredTextLineBreaks: {
      [domMeasureTextBlock.id]: [16, 32, domMeasureTextBlock.metadata.text.length],
    },
    measuredTextFragmentHeights: {
      [`${domMeasureTextBlock.id}:text:0-16:w${Math.round(domMeasureTextContract.contentWidthPx)}`]: 24,
      [`${domMeasureTextBlock.id}:text:0-32:w${Math.round(domMeasureTextContract.contentWidthPx)}`]: 80,
    },
  });
  const measuredFragmentFirstText = domMeasureMeasuredFragmentPages[0]?.blocks[0]?.textRuns
    .map((run) => run.text)
    .join('');
  assert(
    measuredFragmentFirstText === domMeasureTextBlock.metadata.text.slice(0, 16),
    'M2 冒烟失败：真实测量分页引擎没有按片段真实高度收缩到可容纳断点',
  );
  const domMeasureLongListItemText =
    '核心原则：按章节顺序精学，不跳重点；每学完一章做对应章节练习题（客观题+简单计算题）；整理笔记和错题本。'.repeat(10);
  const domMeasureLongListBlock: LayoutBlock = {
    id: 'dom-measure-long-list',
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
          id: 'dom-measure-long-list-item-1',
          sourceRange: null,
          textRuns: [
            {
              id: 'dom-measure-long-list-item-run-1',
              text: domMeasureLongListItemText,
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
          id: 'dom-measure-long-list-item-2',
          sourceRange: null,
          textRuns: [
            {
              id: 'dom-measure-long-list-item-run-2',
              text: '后续短列表项',
              sourceRange: null,
              marks: [],
              charStyleRef: null,
              styleOverrides: {},
              annotations: [],
            },
          ],
          level: 2,
          checked: true,
        },
      ],
    },
  };
  const domMeasureLongListContract = withTestPageMetrics({
    ...contract,
    contentHeightPx: 72,
    columnCount: 1,
  });
  const domMeasureLongListJobs: TextFragmentMeasurementJob[] = [];
  paginateBlocks([domMeasureLongListBlock], domMeasureLongListContract, {
    algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
    measuredTextLineBreaks: {
      'dom-measure-long-list-item-1': [
        20,
        40,
        60,
        80,
        100,
        120,
        140,
        160,
        180,
        200,
        220,
        240,
        domMeasureLongListItemText.length,
      ],
    },
    textFragmentMeasurementJobs: domMeasureLongListJobs,
  });
  assert(
    domMeasureLongListJobs.some((job) => job.sourceBlockId === domMeasureLongListBlock.id),
    'M2 冒烟失败：真实测量分页引擎没有为超长列表项生成片段测量任务',
  );
  const domMeasureLongListPages = paginateBlocks([domMeasureLongListBlock], domMeasureLongListContract, {
    algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
    measuredTextLineBreaks: {
      'dom-measure-long-list-item-1': [
        20,
        40,
        60,
        80,
        100,
        120,
        140,
        160,
        180,
        200,
        220,
        240,
        domMeasureLongListItemText.length,
      ],
    },
    measuredTextFragmentHeights: {
      [`dom-measure-long-list-item-1:text:0-20:w${Math.round(domMeasureLongListContract.contentWidthPx)}`]: 24,
      [`dom-measure-long-list-item-1:text:0-40:w${Math.round(domMeasureLongListContract.contentWidthPx)}`]: 48,
      [`dom-measure-long-list-item-1:text:0-60:w${Math.round(domMeasureLongListContract.contentWidthPx)}`]: 84,
    },
  });
  const domMeasureLongListFragments = domMeasureLongListPages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'list' && block.metadata.kind === 'list');
  const domMeasureLongListPieces = domMeasureLongListFragments
    .flatMap((block) => (block.metadata.kind === 'list' ? block.metadata.items : []))
    .filter((item) => item.id.startsWith('dom-measure-long-list-item-1'));
  const domMeasureLongListTextAfterSplit = domMeasureLongListPieces
    .flatMap((item) => item.textRuns)
    .map((run) => run.text)
    .join('');
  assert(
    domMeasureLongListFragments.length > 1 &&
      domMeasureLongListPieces.length > 1 &&
      domMeasureLongListTextAfterSplit === domMeasureLongListItemText,
    'M2 冒烟失败：真实测量分页引擎没有正确拆分超长列表项或拆分后内容顺序错误',
  );
  const domMeasureLongListHiddenMarkerCount = domMeasureLongListPieces.filter((item) =>
    shouldHideLayoutListItemMarker(item),
  ).length;
  assert(
    domMeasureLongListPieces.every(
      (item) =>
        item.checked === true &&
        item.level === 2 &&
        item.textRuns.every(
          (run) =>
            run.styleOverrides.backgroundColor === '#fef3c7' &&
            run.marks.some((mark) => mark.type === 'underline'),
        ),
    ) &&
      !shouldHideLayoutListItemMarker(domMeasureLongListPieces[0]!) &&
      domMeasureLongListHiddenMarkerCount === domMeasureLongListPieces.length - 1,
    'M2 冒烟失败：真实测量分页引擎列表项续页后没有保留样式层级或隐藏续页符号',
  );
  const domMeasureTableContract = withTestPageMetrics({
    ...contract,
    contentHeightPx: 120,
    columnCount: 1,
  });
  const domMeasureTableBlock: LayoutBlock = {
    id: 'dom-measure-table-row-smoke',
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
          id: 'dom-measure-table-row-smoke-header',
          sourceRange: null,
          heightPx: null,
          cells: [
            {
              id: 'dom-measure-table-row-smoke-header-cell-1',
              sourceRange: null,
              textRuns: [
                {
                  id: 'dom-measure-table-row-smoke-header-cell-1-run',
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
              id: 'dom-measure-table-row-smoke-header-cell-2',
              sourceRange: null,
              textRuns: [
                {
                  id: 'dom-measure-table-row-smoke-header-cell-2-run',
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
        ...Array.from({ length: 4 }, (_, rowIndex) => ({
          id: `dom-measure-table-row-smoke-row-${rowIndex + 1}`,
          sourceRange: null,
          heightPx: null,
          cells: [
            {
              id: `dom-measure-table-row-smoke-row-${rowIndex + 1}-cell-1`,
              sourceRange: null,
              textRuns: [
                {
                  id: `dom-measure-table-row-smoke-row-${rowIndex + 1}-cell-1-run`,
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
              id: `dom-measure-table-row-smoke-row-${rowIndex + 1}-cell-2`,
              sourceRange: null,
              textRuns: [
                {
                  id: `dom-measure-table-row-smoke-row-${rowIndex + 1}-cell-2-run`,
                  text: rowIndex === 0 ? '这是一段很长的表格内容，用于模拟真实行高测量。'.repeat(10) : `第 ${rowIndex + 1} 行 B`,
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
  const domMeasureTableRowJobs: TableRowMeasurementJob[] = [];
  paginateBlocks([domMeasureTableBlock], domMeasureTableContract, {
    algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
    tableRowMeasurementJobs: domMeasureTableRowJobs,
  });
  assert(
    domMeasureTableRowJobs.some((job) => job.sourceBlockId === domMeasureTableBlock.id),
    'M2 冒烟失败：真实测量分页引擎没有为表格行生成测量任务',
  );
  const domMeasureMeasuredTablePages = paginateBlocks([domMeasureTableBlock], domMeasureTableContract, {
    algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
    measuredTableRowHeights: {
      'dom-measure-table-row-smoke-header': 32,
      'dom-measure-table-row-smoke-row-1': 88,
      'dom-measure-table-row-smoke-row-2': 32,
      'dom-measure-table-row-smoke-row-3': 32,
      'dom-measure-table-row-smoke-row-4': 32,
    },
  });
  const domMeasureMeasuredTableFragments = domMeasureMeasuredTablePages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === 'table' && block.metadata.kind === 'table');
  const domMeasureMeasuredRowIds = domMeasureMeasuredTableFragments.flatMap((block) =>
    block.metadata.kind === 'table'
      ? block.metadata.rows
          .map((row) => row.id)
          .filter((rowId) => !rowId.includes('repeat-header'))
          .map((rowId) => rowId.replace(/-dom-fragment-\d+$/, ''))
      : [],
  );
  assert(
    domMeasureMeasuredTableFragments.length > 1 &&
      domMeasureMeasuredTableFragments[0]?.metadata.kind === 'table' &&
      domMeasureMeasuredTableFragments[0].metadata.rows.length === 2 &&
      domMeasureMeasuredRowIds.join('|') === domMeasureTableBlock.metadata.rows.map((row) => row.id).join('|'),
    'M2 冒烟失败：真实测量分页引擎没有优先使用真实行高切分页表格，或切分后行顺序错误',
  );
  const domMeasureSecondTableFragment = domMeasureMeasuredTableFragments[1];
  const domMeasureSecondFragmentHeaderText =
    domMeasureSecondTableFragment?.metadata.kind === 'table'
      ? domMeasureSecondTableFragment.metadata.rows[0]?.cells
          .map((cell) => cell.textRuns.map((run) => run.text).join(''))
          .join('|')
      : '';
  assert(
    domMeasureSecondTableFragment?.metadata.kind === 'table' &&
      domMeasureSecondTableFragment.metadata.rows[0]?.id.includes('repeat-header') &&
      domMeasureSecondTableFragment.metadata.rows[0]?.cells.every((cell) => cell.isHeader) &&
      domMeasureSecondFragmentHeaderText === '列 A|列 B',
    'M2 冒烟失败：真实测量分页引擎表格续页没有重复表头',
  );
  const domMeasureLastTableFragment = domMeasureMeasuredTableFragments.at(-1);
  assert(
    domMeasureLastTableFragment?.metadata.kind === 'table' &&
      domMeasureLastTableFragment.metadata.rows[0]?.id.includes('repeat-header'),
    'M2 冒烟失败：真实测量分页引擎后续续页没有继续重复表头',
  );

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
    styleSettings: restoredProject.styleSettings,
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
    'height:1122.52px',
    'overflow: hidden',
    'class="table-shell"',
    'class="preview-table"',
    'table-layout: fixed',
    'class="table-cell-content"',
    `<header class="page-header"><span>讲义：${restoredProject.document.title}</span>`,
    '<span>1/',
    '<footer class="page-footer"><span>讲义模板 · 雪山静境</span><span>内部练习</span>',
    '<span>A4 / 纵向</span>',
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
    '--page-user-background-color:#f7fbff',
    '--page-user-background-image:url(&quot;layout-asset://local/C%3A%5C%E6%B5%8B%E8%AF%95%E8%83%8C%E6%99%AF%5Cpaper.png&quot;)',
    '--page-user-background-size:cover',
    'background-image:var(--page-user-background-image)',
    '--page-heading1-rule:#F2B84B',
    '--page-heading2-marker:#2F6F64',
    'data-theme-id="snowMountain"',
    ".page[data-theme-id='snowMountain']",
    "url(\"data:image/svg+xml,%3Csvg",
    "width='420' height='72'",
    "width='14' height='14'",
    'toc-block-export',
  ];

  for (const fragment of expectedHtmlFragments) {
    assert(html.includes(fragment), `M2 冒烟失败：导出 HTML 缺少关键片段 ${fragment}`);
  }

  const handDrawnPages = paginateBlocks(
    restoredHandDrawnProject.document.blocks,
    handDrawnContract,
    {
      styles: restoredHandDrawnProject.document.styles,
    },
  );
  const handDrawnHtml = buildExportHtml({
    pages: handDrawnPages,
    title: '手绘主题导出验证',
    styles: restoredHandDrawnProject.document.styles,
    styleSettings: restoredHandDrawnProject.styleSettings,
  });
  for (const fragment of [
    'data-theme-id="handDrawn"',
    '笔记模板',
    '手绘札记',
    '--page-surface-bg:#FFFDF4',
    '--page-table-border:#3A2E25',
    '--page-heading1-decoration-padding-bottom:10px',
    '--page-heading2-decoration-underline-height:8px',
    '--page-heading2-decoration-marker-inset-left:12px',
    '.page[data-theme-id=',
    'data:image/svg+xml',
    'toc-block-export',
  ]) {
    assert(handDrawnHtml.includes(fragment), `M2 冒烟失败：手绘主题导出 HTML 缺少关键片段 ${fragment}`);
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
  const longTocContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 520,
    contentHeightPx: 170,
  });
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
  const measuredContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 100,
  });
  const measuredPages = paginateBlocks([measuredBlockA, measuredBlockB], measuredContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
    measuredBlockHeights: {
      [measuredBlockA.id]: 80,
      [measuredBlockB.id]: 40,
    },
  });
  const remeasuredPages = paginateBlocks([measuredBlockA, measuredBlockB], measuredContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
    measuredBlockHeights: {
      [measuredBlockA.id]: 40,
      [measuredBlockB.id]: 40,
    },
  });
  assert(
    measuredPages.length === 2 &&
      measuredPages[0]?.blocks.length === 1 &&
      measuredPages[1]?.blocks[0]?.id === measuredBlockB.id,
    'M2 冒烟失败：分页测试算法1没有优先使用测量高度进行分页',
  );
  assert(
    remeasuredPages.length === 1 &&
      remeasuredPages[0]?.blocks.map((block) => block.id).join('|') ===
        `${measuredBlockA.id}|${measuredBlockB.id}`,
    'M2 冒烟失败：分页测试算法1没有响应测量高度变化',
  );
  const bottomSafeAreaPages = paginateBlocks(
    [measuredBlockA, measuredBlockB],
    withTestPageMetrics({
      ...resolveStyleContract(defaultStyleSettings),
      contentHeightPx: 48,
    }),
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
    },
  );
  assert(
    bottomSafeAreaPages.length === 2 &&
      bottomSafeAreaPages[0]?.blocks[0]?.id === measuredBlockA.id &&
      bottomSafeAreaPages[1]?.blocks[0]?.id === measuredBlockB.id,
    'M2 冒烟失败：分页测试算法1默认页底安全边界没有阻止内容贴底进入页脚区域',
  );

  const dualColumnHeadingBlock: LayoutBlock = {
    id: 'm2-dual-column-heading',
    type: 'heading',
    sourceRange: null,
    blockStyleRef: 'heading1',
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [
      {
        id: 'm2-dual-column-heading-run',
        text: '双栏分页回归',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'heading',
      depth: 1,
      text: '双栏分页回归',
    },
  };
  const dualColumnParagraphBlocks: LayoutBlock[] = Array.from({ length: 18 }, (_, index) => ({
    id: `m2-dual-column-paragraph-${index + 1}`,
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: 'paragraph',
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [
      {
        id: `m2-dual-column-paragraph-${index + 1}-run`,
        text: `词条 ${index + 1} adj. 回归验证内容，需要在双栏分页里继续保持片段顺序和原始块顺序稳定。`,
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: `词条 ${index + 1} adj. 回归验证内容，需要在双栏分页里继续保持片段顺序和原始块顺序稳定。`,
    },
  }));
  const dualColumnContract = withTestPageMetrics({
    ...resolveStyleContract({
      ...defaultStyleSettings,
      columns: {
        count: 2,
        gapMm: 8,
        divider: false,
        headingsSpanAll: false,
      },
    }),
    contentWidthPx: 520,
    contentHeightPx: 360,
    columnCount: 2,
    columnGapPx: 30,
  });
  const dualColumnPages = paginateBlocks([dualColumnHeadingBlock, ...dualColumnParagraphBlocks], dualColumnContract);
  const dualColumnBlockBaseIds = dualColumnPages
    .flatMap((page) => page.blocks)
    .map((block) => block.id.replace(/-(?:frag|rest)-\d+-\d+$/, ''));
  const dualColumnAllBlockIds = dualColumnPages.flatMap((page) => page.blocks.map((block) => block.id));
  assert(
    dualColumnPages.length >= 2 &&
      dualColumnPages[0]?.blocks[0]?.id === dualColumnHeadingBlock.id &&
      dualColumnAllBlockIds.some((id) => id.includes('-frag-')) &&
      dualColumnAllBlockIds.some((id) => id.includes('-rest-')) &&
      Array.from(new Set(dualColumnBlockBaseIds)).join('|') ===
        [dualColumnHeadingBlock.id, ...dualColumnParagraphBlocks.map((block) => block.id)].join('|'),
    'M2 冒烟失败：分页测试算法1双栏分页没有按两栏容量正确换页或运行时片段顺序异常',
  );
  const dualColumnDomMeasurePages = paginateBlocks(
    [dualColumnHeadingBlock, ...dualColumnParagraphBlocks],
    dualColumnContract,
    {
      algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
    },
  );
  assert(
    dualColumnDomMeasurePages.length === dualColumnPages.length,
    'M2 冒烟失败：真实测量分页引擎在多栏场景下没有保守回退到现有分页结果',
  );

  const createColumnHeadingBlock = (id: string, depth: 1 | 2 | 3, text: string): LayoutBlock => ({
    id,
    type: 'heading',
    sourceRange: null,
    blockStyleRef: `heading${depth}`,
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [
      {
        id: `${id}-run`,
        text,
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'heading',
      depth,
      text,
    },
  });
  const createColumnParagraphBlock = (id: string, text: string): LayoutBlock => ({
    id,
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: 'paragraph',
    blockStyleOverrides: {},
    pagination: {},
    textRuns: [
      {
        id: `${id}-run`,
        text,
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text,
    },
  });
  const headingParticipationBlocks = [
    createColumnParagraphBlock('m2-heading-participation-fill', '填充第一栏高度'),
    createColumnHeadingBlock('m2-heading-participation-h2', 2, '二级标题参与分栏'),
  ];
  const headingParticipationContract = withTestPageMetrics({
    ...dualColumnContract,
    contentHeightPx: 112,
    blockStyles: {
      ...dualColumnContract.blockStyles,
      heading2: {
        ...dualColumnContract.blockStyles.heading2,
        keepWithNext: false,
        marginTop: 0,
        marginBottom: 0,
        lineHeight: 40,
      },
      paragraph: {
        ...dualColumnContract.blockStyles.paragraph,
        marginTop: 0,
        marginBottom: 0,
        lineHeight: 80,
      },
    },
  });
  const headingParticipationPages = paginateBlocks(headingParticipationBlocks, headingParticipationContract);
  assert(
    headingParticipationPages.length === 1 &&
      headingParticipationPages[0]?.blocks.map((block) => block.id).join('|') ===
        'm2-heading-participation-fill|m2-heading-participation-h2',
    'M2 冒烟失败：分栏默认应让二级标题参与分栏并进入下一栏，而不是强制跨栏换页',
  );
  const headingSpanAllContract = withTestPageMetrics({
    ...headingParticipationContract,
    headingsSpanAll: true,
  });
  const headingSpanAllPages = paginateBlocks(headingParticipationBlocks, headingSpanAllContract);
  assert(
    headingSpanAllPages.length === 2 &&
      headingSpanAllPages[0]?.blocks.map((block) => block.id).join('|') === 'm2-heading-participation-fill' &&
      headingSpanAllPages[1]?.blocks[0]?.id === 'm2-heading-participation-h2',
    'M2 冒烟失败：标题不参与分栏开关开启后，二级标题没有按跨栏规则换到下一页',
  );
  const headingSpanExportHtml = buildExportHtml({
    pages: [
      {
        pageNumber: 1,
        blocks: [
          createColumnHeadingBlock('m2-heading-export-h1', 1, '一级标题跨栏'),
          createColumnHeadingBlock('m2-heading-export-h2-default', 2, '二级标题默认入栏'),
        ],
        contract: headingParticipationContract,
        warnings: [],
      },
      {
        pageNumber: 2,
        blocks: [createColumnHeadingBlock('m2-heading-export-h2-span', 2, '二级标题跨栏')],
        contract: headingSpanAllContract,
        warnings: [],
      },
    ],
    title: '标题分栏导出验证',
  });
  assert(
    headingSpanExportHtml.includes('<h1 class="column-span-all"') &&
      headingSpanExportHtml.includes('<h2>') &&
      headingSpanExportHtml.includes('<h2 class="column-span-all"'),
    'M2 冒烟失败：导出 HTML 没有按一级标题固定跨栏、二级标题默认入栏和开关跨栏输出 class',
  );
  assert(
    headingSpanExportHtml.includes('class="page-body page-body-columns"><div class="page-column-flow">'),
    'M2 冒烟失败：导出 HTML 没有输出多栏正文分栏流结构',
  );
  const columnOverflowText = Array.from({ length: 26 }, (_, index) => `双栏长段落内容${index + 1}`).join('，');
  const columnOverflowPages = paginateBlocks(
    [
      createColumnParagraphBlock('m2-column-overflow-fill', '先占住第一栏高度'),
      createColumnParagraphBlock('m2-column-overflow-long-text', columnOverflowText),
    ],
    withTestPageMetrics({
      ...dualColumnContract,
      contentWidthPx: 260,
      contentHeightPx: 120,
      columnCount: 2,
      columnGapPx: 20,
      blockStyles: {
        ...dualColumnContract.blockStyles,
        paragraph: {
          ...dualColumnContract.blockStyles.paragraph,
          marginTop: 0,
          marginBottom: 0,
          lineHeight: 24,
        },
      },
    }),
  );
  const columnOverflowFragments = columnOverflowPages
    .flatMap((page) => page.blocks)
    .filter((block) => block.id.startsWith('m2-column-overflow-long-text'));
  const restoredColumnOverflowText = columnOverflowFragments
    .map((block) => block.textRuns.map((run) => run.text).join(''))
    .join('');
  assert(
    columnOverflowPages.length >= 2 &&
      columnOverflowFragments.length >= 2 &&
      restoredColumnOverflowText === columnOverflowText,
    'M2 冒烟失败：双栏长段落没有按当前栏高度续排，可能仍依赖第三栏或裁掉内容',
  );
  const dualColumnBreakPages = paginateBlocks(
    [
      dualColumnHeadingBlock,
      dualColumnParagraphBlocks[0],
      {
        id: 'm2-dual-column-break',
        type: 'columnBreak',
        sourceRange: null,
        blockStyleRef: null,
        blockStyleOverrides: {},
        textRuns: [],
        pagination: { columnBreakAfter: true },
        metadata: {
          kind: 'columnBreak',
          command: '/columnbreak',
        },
      },
      ...dualColumnParagraphBlocks.slice(1, 4),
    ],
    dualColumnContract,
  );
  assert(
    dualColumnBreakPages.length === 1 &&
      dualColumnBreakPages[0]?.blocks.filter((block) => block.type === 'columnBreak').length === 0,
    'M2 冒烟失败：分栏断点不应作为可见分页结果残留',
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
  const tinyMaxFillContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 24,
  });
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
  const visualLineContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 96,
    contentHeightPx: 48,
  });
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

  const maxFillEnglishTailText = [
    'Intellectual clarity and political will to act.',
    'In other words, structural unemployment is a fake problem.',
    'It mainly serves as an excuse for',
  ].join(' ');
  const maxFillEnglishTailBlock: LayoutBlock = {
    id: 'm2-max-fill-english-tail-paragraph',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 24,
      spaceBefore: 0,
      spaceAfter: 16,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-english-tail-run',
        text: maxFillEnglishTailText,
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: { fontSize: 16 },
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: maxFillEnglishTailText,
    },
  };
  const englishTailContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 260,
    contentHeightPx: 96,
  });
  const englishTailPages = paginateBlocks([maxFillEnglishTailBlock], englishTailContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const englishTailTexts = englishTailPages.flatMap((page) =>
    page.blocks.map((block) => block.textRuns.map((run) => run.text).join('')),
  );
  assert(
    englishTailTexts.join('') === maxFillEnglishTailText,
    'M2 冒烟失败：分页测试算法1英文段落跨页后文本顺序不正确',
  );
  assert(
    englishTailPages.length === 1,
    `M2 冒烟失败：分页测试算法1英文段落仍因重复段后距误分页，实际页数 ${englishTailPages.length}`,
  );
  assert(
    englishTailPages[0]?.blocks[0]?.metadata.kind === 'paragraph' &&
      englishTailPages[0].blocks[0].metadata.text === maxFillEnglishTailText,
    `M2 冒烟失败：分页测试算法1英文段落未保持整段留在当前页，第一页实际为“${
      englishTailPages[0]?.blocks[0]?.metadata.kind === 'paragraph'
        ? englishTailPages[0].blocks[0].metadata.text
        : ''
    }”`,
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
  const largeFontContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 72,
  });
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
    withTestPageMetrics({
      ...resolveStyleContract(defaultStyleSettings),
      contentHeightPx: 100,
    }),
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
  const tailMisbreakContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 656,
    contentHeightPx: 72,
  });
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

  const tailMeasuredOverflowPages = paginateBlocks(
    [maxFillTailMisbreakListBlock],
    withTestPageMetrics({
      ...resolveStyleContract(defaultStyleSettings),
      contentWidthPx: 656,
      contentHeightPx: 100,
    }),
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
      measuredBlockHeights: {
        [maxFillTailMisbreakListBlock.id]: 112,
      },
    },
  );
  assert(
    tailMeasuredOverflowPages.length > 1,
    `M2 冒烟失败：分页测试算法1仍忽略接近一行的实测高度偏差，实际页数 ${tailMeasuredOverflowPages.length}`,
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
    withTestPageMetrics({
      ...resolveStyleContract(defaultStyleSettings),
      contentWidthPx: 656,
      contentHeightPx: 212,
    }),
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

  // 验证混排文本（中文+英文+数字）通过唯一字体测量接口分页，不再让分页算法自己散落宽度估算。
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
  const mixedContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 42, // 很窄：约 3 个中文字符宽，强制多行跨页
    contentHeightPx: 48, // 约 2 行，强制分页
  });
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
  setFontMetricsProvider({
    measureTextWidth(text, style) {
      const fontSize = style.fontSize;
      const scale = style.fontFamily === 'LAYOUT3_wide_font_metric_test' ? 1.6 : 0.45;
      return Array.from(text).reduce((total, char) => total + (/\s/u.test(char) ? fontSize * 0.25 : fontSize * scale), 0);
    },
  });
  const fontMetricNarrowBlock: LayoutBlock = {
    ...mixedTextBlock,
    id: 'm2-font-metric-narrow-block',
    textRuns: [
      {
        ...mixedTextBlock.textRuns[0],
        id: 'm2-font-metric-narrow-run',
        text: '字体测量接口分页校验文字'.repeat(12),
        styleOverrides: { fontSize: 14, fontFamily: 'LAYOUT3_narrow_font_metric_test' },
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '字体测量接口分页校验文字'.repeat(12),
    },
  };
  const fontMetricWideBlock: LayoutBlock = {
    ...fontMetricNarrowBlock,
    id: 'm2-font-metric-wide-block',
    textRuns: [
      {
        ...fontMetricNarrowBlock.textRuns[0],
        id: 'm2-font-metric-wide-run',
        styleOverrides: { fontSize: 14, fontFamily: 'LAYOUT3_wide_font_metric_test' },
      },
    ],
  };
  const fontMetricContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 92,
    contentHeightPx: 72,
  });
  const narrowFontPages = paginateBlocks([fontMetricNarrowBlock], fontMetricContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  const wideFontPages = paginateBlocks([fontMetricWideBlock], fontMetricContract, {
    algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
  });
  assert(
    wideFontPages.length > narrowFontPages.length,
    `M2 冒烟失败：分页测试算法1没有通过字体测量接口响应字体宽度变化，窄字体 ${narrowFontPages.length} 页，宽字体 ${wideFontPages.length} 页`,
  );
  setFontMetricsProvider(createDeterministicFontMetricsProvider());

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
  const wideMaxFillContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 2000,
    contentHeightPx: 2000,
  });
  const narrowMaxFillContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentWidthPx: 80,
    contentHeightPx: 48,
  });
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
  const tinyListContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 120,
  });
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

  const maxFillRegressionFillerBlock: LayoutBlock = {
    id: 'm2-max-fill-column-regression-filler',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 28,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    pagination: {},
    textRuns: [
      {
        id: 'm2-max-fill-column-regression-filler-run',
        text: '页尾占位\n页尾占位\n页尾占位\n页尾占位\n页尾占位\n页尾占位\n页尾占位',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    metadata: {
      kind: 'paragraph',
      text: '页尾占位\n页尾占位\n页尾占位\n页尾占位\n页尾占位\n页尾占位\n页尾占位',
    },
  };
  const maxFillRegressionListBlock: LayoutBlock = {
    id: 'm2-max-fill-column-regression-list',
    type: 'list',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {
      lineHeight: 28,
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
      items: Array.from({ length: 8 }, (_, itemIndex) => ({
        id: `m2-max-fill-column-regression-list-item-${itemIndex + 1}`,
        sourceRange: null,
        textRuns: [
          {
            id: `m2-max-fill-column-regression-list-run-${itemIndex + 1}`,
            text: `第 ${itemIndex + 1} 项`,
            sourceRange: null,
            marks: [],
            charStyleRef: null,
            styleOverrides: {},
            annotations: [],
          },
        ],
        level: 1,
        checked: null,
      })),
    },
  };
  const maxFillRegressionContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 224,
    contentWidthPx: 520,
  });
  const maxFillRegressionListPages = paginateBlocks(
    [maxFillRegressionFillerBlock, maxFillRegressionListBlock],
    maxFillRegressionContract,
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
    },
  );
  const regressionSecondPageList = maxFillRegressionListPages[1]?.blocks.find(
    (block) => block.type === 'list' && block.metadata.kind === 'list',
  );
  assert(
    regressionSecondPageList?.type === 'list' &&
      regressionSecondPageList.metadata.kind === 'list' &&
      regressionSecondPageList.metadata.items.length > 1,
    'M2 冒烟失败：分页测试算法1列表换页后仍复用第一页页尾旧高度，导致续页只放 1 项',
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
    withTestPageMetrics({
      ...tinyListContract,
      contentHeightPx: 24,
      contentWidthPx: 656,
    }),
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
  const tinyTableContract = withTestPageMetrics({
    ...resolveStyleContract(defaultStyleSettings),
    contentHeightPx: 150,
    contentWidthPx: 520,
  });
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

  const maxFillRegressionTableBlock: LayoutBlock = {
    id: 'm2-max-fill-column-regression-table',
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
          id: 'm2-max-fill-column-regression-table-header',
          sourceRange: null,
          heightPx: 28,
          cells: [
            {
              id: 'm2-max-fill-column-regression-table-header-cell-1',
              sourceRange: null,
              textRuns: [
                {
                  id: 'm2-max-fill-column-regression-table-header-cell-1-run',
                  text: '表头 A',
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
              id: 'm2-max-fill-column-regression-table-header-cell-2',
              sourceRange: null,
              textRuns: [
                {
                  id: 'm2-max-fill-column-regression-table-header-cell-2-run',
                  text: '表头 B',
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
        ...Array.from({ length: 8 }, (_, rowIndex) => ({
          id: `m2-max-fill-column-regression-table-row-${rowIndex + 1}`,
          sourceRange: null,
          heightPx: 28,
          cells: [
            {
              id: `m2-max-fill-column-regression-table-row-${rowIndex + 1}-cell-1`,
              sourceRange: null,
              textRuns: [
                {
                  id: `m2-max-fill-column-regression-table-row-${rowIndex + 1}-cell-1-run`,
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
              id: `m2-max-fill-column-regression-table-row-${rowIndex + 1}-cell-2`,
              sourceRange: null,
              textRuns: [
                {
                  id: `m2-max-fill-column-regression-table-row-${rowIndex + 1}-cell-2-run`,
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
  const maxFillRegressionTablePages = paginateBlocks(
    [maxFillRegressionFillerBlock, maxFillRegressionTableBlock],
    maxFillRegressionContract,
    {
      algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID,
    },
  );
  const regressionSecondPageTable = maxFillRegressionTablePages[1]?.blocks.find(
    (block) => block.type === 'table' && block.metadata.kind === 'table',
  );
  assert(
    regressionSecondPageTable?.type === 'table' &&
      regressionSecondPageTable.metadata.kind === 'table' &&
      regressionSecondPageTable.metadata.rows.length > 2,
    'M2 冒烟失败：分页测试算法1表格换页后仍复用第一页页尾旧高度，导致续页只放表头或 1 行',
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

  useAppStore.getState().loadDocument({
    title: '分页批次单篇优化验证',
    filePath: null,
    source: '# 分页批次单篇优化验证',
    documentFormat: 'layout',
    layoutDocument: createEmptyLayoutDocument({
      title: '分页批次单篇优化验证',
      source: '# 分页批次单篇优化验证',
    }),
  });
  useAppStore.getState().addPaginationTrainingSamplesToBatch({
    documentId: 'm2-pagination-batch-ready-document',
    documentTitle: '分页批次单篇优化验证',
    samples: [
      {
        sampleId: 'm2-pagination-batch-ready-sample',
        breakId: 'm2-pagination-batch-ready-break',
        documentId: 'm2-pagination-batch-ready-document',
        documentTitle: '分页批次单篇优化验证',
        pageNumber: 1,
        breakIndex: 1,
        verdict: 'incorrect',
        problemTags: ['blankSpaceTooLarge'],
        severity: 'medium',
        pageRemainingHeightPx: 160,
        pageFillRatio: 0.62,
        before: {
          blockId: 'm2-pagination-batch-before',
          blockType: '段落',
          textPreview: '分页前内容',
        },
        after: {
          blockId: 'm2-pagination-batch-after',
          blockType: '段落',
          textPreview: '分页后内容',
        },
        rootCauses: ['heightEstimationError'],
      },
    ],
  });
  assert(
    useAppStore.getState().paginationBatchAnalysis.isReady,
    'M2 冒烟失败：分页批次加入 1 篇有效文章后应允许应用优化',
  );
  useAppStore.getState().applyPaginationBatchOptimization();
  assert(
    useAppStore.getState().hasAppliedPaginationBatchOptimization &&
      useAppStore.getState().paginationOptimizationSettings !== null,
    'M2 冒烟失败：分页批次 1 篇就绪后没有生成运行时优化参数',
  );
  useAppStore.getState().clearPaginationBatchOptimization();

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
  } finally {
    if (previousLocalStorage === undefined) {
      delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: previousLocalStorage,
      });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
