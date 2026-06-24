import type { LayoutBlockType } from '@/engine/document-model';

export interface BlockStyleControlSupport {
  sectionTitle: string;
  sectionHint: string;
  supportsTextAlign: boolean;
  supportsLineHeight: boolean;
  supportsIndentLeft: boolean;
  supportsIndentRight: boolean;
  supportsFirstLineIndent: boolean;
  supportsHangingIndent: boolean;
  supportsSpaceBefore: boolean;
  supportsSpaceAfter: boolean;
  note: string | null;
}

// 右侧“对象属性”面板只展示当前真实接通且相对稳定的样式控件，
// 避免 UI 先暴露一堆入口，实际预览、分页或导出又没有一致消费。
export function getBlockStyleControlSupportByBlockType(
  blockType: LayoutBlockType,
): BlockStyleControlSupport | null {
  switch (blockType) {
    case 'heading':
    case 'paragraph':
      return {
        sectionTitle: '段落样式',
        sectionHint: '始终作用到所属块，不跟文字选区绑定',
        supportsTextAlign: true,
        supportsLineHeight: true,
        supportsIndentLeft: true,
        supportsIndentRight: true,
        supportsFirstLineIndent: true,
        supportsHangingIndent: true,
        supportsSpaceBefore: true,
        supportsSpaceAfter: true,
        note: null,
      };
    case 'code':
      return {
        sectionTitle: '块级样式',
        sectionHint: '只显示当前稳定消费的样式项',
        supportsTextAlign: true,
        supportsLineHeight: true,
        supportsIndentLeft: false,
        supportsIndentRight: false,
        supportsFirstLineIndent: false,
        supportsHangingIndent: false,
        supportsSpaceBefore: true,
        supportsSpaceAfter: true,
        note: '代码块当前只开放对齐、行高和段前段后距；缩进体系后续再单独确认。',
      };
    case 'list':
      return {
        sectionTitle: '块级样式',
        sectionHint: '只显示当前稳定消费的样式项',
        supportsTextAlign: true,
        supportsLineHeight: true,
        supportsIndentLeft: false,
        supportsIndentRight: false,
        supportsFirstLineIndent: false,
        supportsHangingIndent: false,
        supportsSpaceBefore: true,
        supportsSpaceAfter: true,
        note: '列表当前只开放对齐、行高和段前段后距；列表结构、起始编号与任务勾选请继续使用上方“列表属性”。',
      };
    case 'table':
      return {
        sectionTitle: '块级样式',
        sectionHint: '只显示当前稳定消费的样式项',
        supportsTextAlign: false,
        supportsLineHeight: true,
        supportsIndentLeft: false,
        supportsIndentRight: false,
        supportsFirstLineIndent: false,
        supportsHangingIndent: false,
        supportsSpaceBefore: true,
        supportsSpaceAfter: true,
        note: '表格当前只开放行高和段前段后距；列对齐请继续使用上方“表格属性”中的“当前列对齐”入口。',
      };
    default:
      return null;
  }
}
