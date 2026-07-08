import type {
  WorkspaceDirectoryEntry,
  LeftPanelTab,
  SelectOption,
  TemplateOption,
  WorkspaceViewMode,
  WorkspaceFileItem,
} from '@/types/workspace';

export const starterMarkdown = '';

export const starterMarkdownPlaceholder = '这里展示导入时保留的 Markdown 源码快照，后续编辑只写入 layout 工程数据。';
export const starterTitle = '未命名文档';

export const leftPanelTabs: LeftPanelTab[] = ['文件', '大纲', '搜索', '资源'];

export const workspaceViewModes: Array<{
  id: WorkspaceViewMode;
  label: string;
  description: string;
}> = [
  { id: 'split', label: '分屏视图', description: '同时查看源码快照与分页结果' },
  { id: 'preview', label: '预览视图', description: '聚焦分页画布与排版效果' },
];

export const sampleFiles: WorkspaceFileItem[] = [{ id: 'untitled', name: starterTitle }];

export const emptyFolderHints = [
  '当前文件夹为空，可以新建 layout 文档或文件夹。',
  '双击文件列表中的 Markdown / layout 文件后，系统会导入为结构化工程文档继续编辑。',
];

export const initialDirectoryEntries: WorkspaceDirectoryEntry[] = [];

export const outlineTips = [
  '根据标题层级自动生成章节大纲',
  '后续将支持点击大纲跳转到对应页面',
];

export const searchHints = [
  '后续支持全文搜索、替换与结果定位',
  '当前先保留面板入口和状态提示',
];

export const resourceHints = [
  '资源库读取当前文档保存的图片与字体资源',
  '完整资源入库、丢失检查和批量清理后续单独扩展',
];

export const pageSizeOptions: SelectOption[] = [
  { value: 'A4', label: 'A4' },
  { value: 'B5', label: 'B5' },
];

export const marginOptions: SelectOption[] = [
  { value: 'normal', label: '普通' },
  { value: 'narrow', label: '窄边距' },
  { value: 'wide', label: '宽边距' },
];

export const templateOptions: TemplateOption[] = [
  { id: 'lecture', name: '讲义模板' },
  { id: 'notes', name: '笔记模板' },
];
