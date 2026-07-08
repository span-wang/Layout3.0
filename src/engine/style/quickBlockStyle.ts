import type {
  BlockStyleOverrides,
  LayoutBlock,
  LayoutStyleSheet,
} from '@/engine/document-model';

export type QuickBlockStyleScope =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code';

export const quickBlockStyleScopeKeys: Record<QuickBlockStyleScope, string> = {
  heading1: 'quickBlockStyle.heading1',
  heading2: 'quickBlockStyle.heading2',
  heading3: 'quickBlockStyle.heading3',
  heading4: 'quickBlockStyle.heading4',
  paragraph: 'quickBlockStyle.paragraph',
  list: 'quickBlockStyle.list',
  table: 'quickBlockStyle.table',
  code: 'quickBlockStyle.code',
};

const supportedTextAlignValues = new Set<BlockStyleOverrides['textAlign']>([
  'left',
  'center',
  'right',
  'justify',
]);

function clampRoundedNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function isQuickBlockStylePatchEmpty(patch: BlockStyleOverrides): boolean {
  return Object.values(patch).every((value) => value === undefined);
}

function normalizeQuickBlockStylePatch(patch: BlockStyleOverrides): BlockStyleOverrides {
  const nextPatch: BlockStyleOverrides = {};

  if (patch.textAlign && supportedTextAlignValues.has(patch.textAlign)) {
    nextPatch.textAlign = patch.textAlign;
  }

  if (patch.lineHeight !== undefined && Number.isFinite(patch.lineHeight)) {
    nextPatch.lineHeight = clampRoundedNumber(patch.lineHeight, 1, 200);
  }

  if (patch.spaceBefore !== undefined && Number.isFinite(patch.spaceBefore)) {
    nextPatch.spaceBefore = clampRoundedNumber(patch.spaceBefore, 0, 200);
  }

  if (patch.spaceAfter !== undefined && Number.isFinite(patch.spaceAfter)) {
    nextPatch.spaceAfter = clampRoundedNumber(patch.spaceAfter, 0, 200);
  }

  if (patch.indentLeft !== undefined && Number.isFinite(patch.indentLeft)) {
    nextPatch.indentLeft = clampRoundedNumber(patch.indentLeft, 0, 240);
  }

  if (patch.indentRight !== undefined && Number.isFinite(patch.indentRight)) {
    nextPatch.indentRight = clampRoundedNumber(patch.indentRight, 0, 240);
  }

  if (patch.firstLineIndent !== undefined && Number.isFinite(patch.firstLineIndent)) {
    nextPatch.firstLineIndent = clampRoundedNumber(patch.firstLineIndent, 0, 160);
  }

  if (patch.hangingIndent !== undefined && Number.isFinite(patch.hangingIndent)) {
    nextPatch.hangingIndent = clampRoundedNumber(patch.hangingIndent, 0, 160);
  }

  return nextPatch;
}

export function applyQuickBlockStyleToStyleSheet(
  styleSheet: LayoutStyleSheet,
  scope: QuickBlockStyleScope,
  patch: BlockStyleOverrides,
): LayoutStyleSheet {
  const normalizedPatch = normalizeQuickBlockStylePatch(patch);
  if (isQuickBlockStylePatchEmpty(normalizedPatch)) {
    return styleSheet;
  }

  const styleKey = quickBlockStyleScopeKeys[scope];
  const currentStyle = styleSheet.blockStyles[styleKey] ?? {};

  return {
    ...styleSheet,
    blockStyles: {
      ...styleSheet.blockStyles,
      // 同类块规则只记录“该类块的段落样式基线”，不批量污染每个块的局部覆盖。
      [styleKey]: {
        ...currentStyle,
        ...normalizedPatch,
      },
    },
  };
}

function getHeadingScope(block: LayoutBlock): QuickBlockStyleScope | null {
  if (block.type !== 'heading' || block.metadata.kind !== 'heading') {
    return null;
  }

  if (block.metadata.depth === 1) {
    return 'heading1';
  }

  if (block.metadata.depth === 2) {
    return 'heading2';
  }

  if (block.metadata.depth === 3) {
    return 'heading3';
  }

  return 'heading4';
}

export function getQuickBlockStyleScopeForBlock(block: LayoutBlock): QuickBlockStyleScope | null {
  const headingScope = getHeadingScope(block);
  if (headingScope) {
    return headingScope;
  }

  if (block.type === 'paragraph') {
    return 'paragraph';
  }

  if (block.type === 'list') {
    return 'list';
  }

  if (block.type === 'table') {
    return 'table';
  }

  if (block.type === 'code') {
    return 'code';
  }

  return null;
}

export function resolveQuickBlockStyleForBlock(
  block: LayoutBlock,
  styles: LayoutStyleSheet | null | undefined,
): BlockStyleOverrides {
  const scope = getQuickBlockStyleScopeForBlock(block);
  if (!scope) {
    return {};
  }

  return styles?.blockStyles[quickBlockStyleScopeKeys[scope]] ?? {};
}

export function resolveEffectiveBlockStyleOverrides(
  block: LayoutBlock,
  styles: LayoutStyleSheet | null | undefined,
): BlockStyleOverrides {
  return {
    ...resolveQuickBlockStyleForBlock(block, styles),
    ...block.blockStyleOverrides,
  };
}

function areBlockStyleOverridesEqual(left: BlockStyleOverrides, right: BlockStyleOverrides): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const typedKey = key as keyof BlockStyleOverrides;
    if (left[typedKey] !== right[typedKey]) {
      return false;
    }
  }

  return true;
}

function applyQuickBlockStyleRulesToBlock(
  block: LayoutBlock,
  styles: LayoutStyleSheet | null | undefined,
): LayoutBlock {
  const inheritedStyle = resolveQuickBlockStyleForBlock(block, styles);
  const mergedOverrides = isQuickBlockStylePatchEmpty(inheritedStyle)
    ? block.blockStyleOverrides
    : {
        ...inheritedStyle,
        ...block.blockStyleOverrides,
      };

  let nextMetadata = block.metadata;

  if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
    const nextBlocks = applyQuickBlockStyleRulesToBlocks(block.metadata.blocks, styles);
    if (nextBlocks !== block.metadata.blocks) {
      nextMetadata = {
        ...block.metadata,
        blocks: nextBlocks,
      };
    }
  }

  if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
    const nextBlocks = applyQuickBlockStyleRulesToBlocks(block.metadata.blocks, styles);
    if (nextBlocks !== block.metadata.blocks) {
      nextMetadata = {
        ...block.metadata,
        blocks: nextBlocks,
      };
    }
  }

  const shouldReuseOverrides = areBlockStyleOverridesEqual(mergedOverrides, block.blockStyleOverrides);
  if (shouldReuseOverrides && nextMetadata === block.metadata) {
    return block;
  }

  return {
    ...block,
    blockStyleOverrides: shouldReuseOverrides ? block.blockStyleOverrides : mergedOverrides,
    metadata: nextMetadata,
  };
}

export function applyQuickBlockStyleRulesToBlocks(
  blocks: LayoutBlock[],
  styles: LayoutStyleSheet | null | undefined,
): LayoutBlock[] {
  if (!styles || Object.keys(styles.blockStyles).length === 0) {
    return blocks;
  }

  let didChange = false;
  const nextBlocks = blocks.map((block) => {
    const nextBlock = applyQuickBlockStyleRulesToBlock(block, styles);
    if (nextBlock !== block) {
      didChange = true;
    }
    return nextBlock;
  });

  return didChange ? nextBlocks : blocks;
}
