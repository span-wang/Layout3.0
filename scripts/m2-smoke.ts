import {
  applyBlockStyleOverridesToBlock,
  applyPageNumbersToTocItems,
  applyTextStyleToBlock,
  buildHeadingPageNumberMap,
  buildTocItems,
  createLayoutDocumentFromMarkdown,
  estimateImageVisibleHeightPx,
  insertEquationBlockAfterNode,
  insertTocBlockAfterNode,
  mergeTableCellsByRange,
  parseLayoutProjectFile,
  resolveImageLayout,
  resolveTableColumnWidths,
  resolveTableRowHeightPx,
  serializeLayoutProjectFile,
  updateLayoutImageAttributes,
  updateTableColumnAlignByCell,
  updateTableHeaderRowByCell,
  type LayoutBlock,
} from '../src/engine/document-model/index.ts';
import { renderInlineEquationToHtml, splitInlineEquations } from '../src/engine/document-model/equation';
import { cloneStyleSettings } from '../src/engine/style/styleSettings.ts';
import { defaultStyleSettings } from '../src/engine/style/presets.ts';
import { resolveStyleContract } from '../src/engine/style/resolveContract.ts';
import { buildExportHtml } from '../src/services/exportHtml.ts';
import {
  ESTIMATED_COST_PAGINATION_ALGORITHM_ID,
  paginateBlocks,
} from '../src/engine/typesetting/index.ts';

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
    applyTextStyleToBlock(paragraphBlock, { start: 0, end: 6 }, {
      fontSize: 19,
      color: '#0f766e',
      highlightColor: '#fef3c7',
    }),
    {
      textAlign: 'justify',
      lineHeight: 31,
      firstLineIndent: 28,
      spaceBefore: 6,
      spaceAfter: 12,
    },
  );
  document = { ...document, blocks: replaceBlock(document.blocks, styledParagraph) };

  assert(
    styledParagraph.textRuns.some((run) => run.styleOverrides.fontSize === 19),
    'M2 冒烟失败：文字样式没有写入 TextRun',
  );
  assert(
    styledParagraph.blockStyleOverrides.textAlign === 'justify' &&
      styledParagraph.blockStyleOverrides.firstLineIndent === 28,
    'M2 冒烟失败：段落样式没有写入 blockStyleOverrides',
  );

  const tableBlock = document.blocks.find((block) => block.type === 'table' && block.metadata.kind === 'table');
  assert(tableBlock && tableBlock.metadata.kind === 'table', 'M2 冒烟失败：未找到可用于表格验证的表格块');
  const firstCellId = tableBlock.metadata.rows[0]?.cells[0]?.id;
  assert(firstCellId, 'M2 冒烟失败：表格缺少第一个单元格');

  const tableWithHeader = updateTableHeaderRowByCell(tableBlock, firstCellId, true).block;
  const tableWithAlign = updateTableColumnAlignByCell(tableWithHeader, firstCellId, 'center').block;
  assert(tableWithAlign.type === 'table' && tableWithAlign.metadata.kind === 'table', 'M2 冒烟失败：表格属性写回后类型异常');
  const tableWithSize: LayoutBlock = {
    ...tableWithAlign,
    metadata: {
      ...tableWithAlign.metadata,
      columnWidthsPx: [180, 120, null],
      rows: tableWithAlign.metadata.rows.map((row, rowIndex) => ({
        ...row,
        heightPx: rowIndex === 0 ? 58 : 46,
      })),
    },
  };
  document = { ...document, blocks: replaceBlock(document.blocks, tableWithSize) };

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
  assert(
    document.blocks.some(
      (block) => block.id === equationInsertResult.insertedBlockId && block.type === 'equation',
    ),
    'M2 冒烟失败：公式块插入后没有进入文档模型',
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
      rendered.length > 0 && !rendered.startsWith('$'),
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

  const styleSettings = cloneStyleSettings({
    ...defaultStyleSettings,
    templateId: 'lecture',
    marginMode: 'custom',
    customMarginsMm: {
      top: 18,
      right: 16,
      bottom: 18,
      left: 16,
    },
    paginationAlgorithmId: ESTIMATED_COST_PAGINATION_ALGORITHM_ID,
  });
  const serialized = serializeLayoutProjectFile({ document, styleSettings });
  const restoredProject = parseLayoutProjectFile(serialized);
  assert(restoredProject.document.blocks.length === document.blocks.length, 'M2 冒烟失败：layout 工程文件没有恢复完整块数量');
  assert(restoredProject.styleSettings.templateId === 'lecture', 'M2 冒烟失败：layout 工程文件没有恢复模板设置');
  assert(
    restoredProject.styleSettings.paginationAlgorithmId === ESTIMATED_COST_PAGINATION_ALGORITHM_ID,
    'M2 冒烟失败：layout 工程文件没有恢复分页算法选择',
  );

  const contract = resolveStyleContract(restoredProject.styleSettings);
  assert(contract.templateLabel.includes('讲义'), 'M2 冒烟失败：模板设置没有进入样式契约');
  const pages = paginateBlocks(restoredProject.document.blocks, contract, {
    algorithmId: restoredProject.styleSettings.paginationAlgorithmId,
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

  const html = buildExportHtml({ pages, title: restoredProject.document.title });
  const expectedHtmlFragments = [
    'font-size:19px',
    'text-align:justify',
    'text-indent:28px',
    '<th',
    'width:180px',
    'height:58px',
    'image-wrap-square',
    'image-wrap-side-right',
    'transform:translate(-10px, -12px)',
    'equation-shell',
    'toc-entry-export',
    '讲义模板',
  ];

  for (const fragment of expectedHtmlFragments) {
    assert(html.includes(fragment), `M2 冒烟失败：导出 HTML 缺少关键片段 ${fragment}`);
  }

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
