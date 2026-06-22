# LAYOUT3.0 产品开发文档

> 本文档是 LAYOUT3.0（基于 Layout2.0 功能设计）的完整开发指南，涵盖项目概述、技术架构、模块设计、数据模型、接口协议、开发流程与质量保障。本文档与《功能设计及需求.md》配套使用，功能需求部分以需求文档为准，本文档聚焦于"如何实现"。

---

# 第一部分：项目概述

## 1.1 产品定位回顾

LAYOUT3.0 是一款面向教育内容生产者（教师、教培机构、学生）的「Markdown 驱动 + 可视化排版」工具。核心链路：

```
导入/新建文档 → Markdown 编辑/解析 → 结构化文档模型
→ 自动排版 → 分页预览 → 可视化微调
→ 样式模板套用 → 校验 → 导出/保存
```

## 1.2 核心技术决策

| 决策项         | 选择                           | 理由                                   |
| ----------- | ---------------------------- | ------------------------------------ |
| 桌面框架        | Electron ^32 + electron-vite | Chromium PDF 打印管线无缝复用，分页引擎保真度最高      |
| 前端框架        | React ^18 + TypeScript ^5.5  | 生态成熟，组件化架构适合三栏布局                     |
| Markdown 解析 | unified + remark 生态          | mdast → rehype → hast 管线天然匹配三层架构     |
| 编辑器内核       | CodeMirror 6                 | 轻量（<200KB），AST 可直接驱动排版引擎             |
| 公式渲染        | KaTeX                        | 比 MathJax 快 2–3 倍，与 remark-math 集成成熟 |
| 状态管理        | Zustand + Immer              | API 简洁，订阅驱动解耦，撤销重做中间件成熟              |
| 排版引擎        | 自研 TypeScript + DOM 渲染       | 精细排版控制（孤寡行/表头跨页）需逐元素测量               |
| PDF 导出      | Electron PrintToPDF API      | 渲染 DOM 即为打印输入，零转换损耗                  |
| 数据持久化       | IndexedDB（Dexie.js）+ 本地 fs   | 工程文件本地管理，IndexedDB 支持草稿快照            |

## 1.3 核心能力分层

产品能力划分为五层，每层对应独立的工程模块：

| 层级 | 名称 | 职责 |
|---|---|---|
| 内容层 | Editor Module | Markdown 源码输入、图片资源管理、公式源码管理 |
| 结构层 | Parser Module | Markdown → mdast → hast 解析管线 |
| 样式层 | Style Module | 模板系统、样式规则引擎、样式优先级管理 |
| 排版层 | Typesetting Engine | 分页算法、溢出处理、页码计算、目录生成 |
| 交互层 | UI Components | 三栏布局、视图切换、属性面板、工具栏 |

---

# 第二部分：项目架构

## 2.1 整体架构图

```
┌──────────────────────────────────────────────────────────────┐
│                         Electron 桌面层                        │
│  ┌────────────┐     ┌────────────────────────────────────┐ │
│  │   主进程    │     │          渲染进程 (Vite + React)    │ │
│  │ (Node.js)  │ IPC │                                    │ │
│  │            │◄───►│  ┌────────────────────────────────┐ │ │
│  │ · 文件系统  │     │  │       UI Components            │ │ │
│  │ · 窗口管理  │     │  │  · 工具栏 · 三栏布局 · 右键菜单  │ │ │
│  │ · PDF导出  │     │  │  · 浮动工具条 · Toast · 模态框  │ │ │
│  │ · 原生菜单  │     │  └────────────────────────────────┘ │ │
│  │ · 系统集成  │     │  ┌──────────┬──────────────────────┐ │ │
│  └────────────┘     │  │ 状态管理层 │   解析管线           │ │ │
│                      │  │  Zustand  │ remark → rehype     │ │ │
│                      │  │  + Immer  │ → hast              │ │ │
│                      │  ├──────────┴──────────────────────┤ │ │
│                      │  │        排版引擎 (自研 TS)        │ │ │
│                      │  │  · 分页算法  · 样式计算          │ │ │
│                      │  │  · 溢出处理  · 目录生成           │ │ │
│                      │  ├─────────────────────────────────┤ │ │
│                      │  │        渲染层                   │ │ │
│                      │  │  · DOM 分页渲染  · KaTeX 公式   │ │ │
│                      │  │  · 表格组件   · 辅助线/网格       │ │ │
│                      │  └─────────────────────────────────┘ │ │
│                      └────────────────────────────────────┘ │
│                      ┌────────────────────────────────────┐ │
│                      │         预加载脚本 (Bridge)         │ │
│                      │  · IPC 通道封装  · 文件系统抽象      │ │
│                      │  · 平台能力接口  · 安全上下文隔离    │ │ │
│                      └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## 2.2 模块依赖关系

```
┌─────────────────────────────────────────────────────┐
│                     UI Components                     │
│  (React 组件：工具栏/面板/画布/编辑器/AI面板)          │
└──────────────────────────┬──────────────────────────┘
                           │ 订阅/调用
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│   Zustand      │ │  Typesetting   │ │   Parser       │
│   状态管理层   │ │   排版引擎     │ │   解析管线     │
│                │ │                │ │                │
│ · 文档状态     │ │ · 分页计算     │ │ · remark       │
│ · 选中状态     │ │ · 样式应用     │ │ · rehype       │
│ · 视图状态     │ │ · 溢出处理     │ │ · remark-math  │
│ · 撤销重做     │ │ · 目录生成     │ │ · remark-gfm   │
│ · 模板状态     │ │                │ │                │
│                │ │                │ │                │
└───────┬────────┘ └───────┬────────┘ └───────┬────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
              ┌─────────────────────────┐
              │     导出层 / 文件层      │
              │  · Electron PrintToPDF   │
              │  · Dexie.js (IndexedDB) │
              │  · 文件系统读写           │
              └─────────────────────────┘
```

## 2.3 进程间通信协议

Electron 主进程与渲染进程通过 IPC 通信，定义以下通道：

| 通道名 | 方向 | 载荷 | 说明 |
|---|---|---|---|
| `file:open` | Renderer → Main | `{path: string}` | 打开本地文件 |
| `file:save` | Renderer → Main | `{path: string, content: Buffer}` | 保存文件 |
| `file:saveAs` | Renderer → Main | `{content: Buffer, defaultName: string}` | 另存为 |
| `file:readDir` | Renderer → Main | `{path: string}` | 读取目录 |
| `file:exportPdf` | Renderer → Main | `{html: string, options: PdfOptions}` | 导出 PDF |
| `file:exportPdfResult` | Main → Renderer | `{success: boolean, path?: string, error?: string}` | 导出结果回调 |
| `dialog:openFile` | Renderer → Main | `{filters: FileFilter[]}` | 打开系统文件对话框 |
| `dialog:saveFile` | Renderer → Main | `{defaultPath: string, filters: FileFilter[]}` | 打开系统保存对话框 |
| `app:getPath` | Renderer → Main | `{name: 'home'\|'documents'}` | 获取系统路径 |

### 预加载脚本安全原则

预加载脚本通过 `contextBridge.exposeInMainWorld` 暴露最小必要 API，不暴露任何 Node.js API：

```typescript
// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件操作
  openFile: (path: string) => ipcRenderer.invoke('file:open', path),
  saveFile: (path: string, content: Uint8Array) =>
    ipcRenderer.invoke('file:save', path, content),
  saveAs: (content: Uint8Array, defaultName: string) =>
    ipcRenderer.invoke('file:saveAs', content, defaultName),
  readDir: (path: string) => ipcRenderer.invoke('file:readDir', path),

  // 系统对话框
  openFileDialog: (filters: FileFilter[]) =>
    ipcRenderer.invoke('dialog:openFile', filters),
  saveFileDialog: (defaultPath: string, filters: FileFilter[]) =>
    ipcRenderer.invoke('dialog:saveFile', defaultPath, filters),

  // PDF 导出
  exportPdf: (html: string, options: PdfOptions) =>
    ipcRenderer.invoke('file:exportPdf', html, options),
  onExportResult: (callback: (result: ExportResult) => void) => {
    const handler = (_: unknown, result: ExportResult) => callback(result);
    ipcRenderer.on('file:exportPdfResult', handler);
    return () => ipcRenderer.removeListener('file:exportPdfResult', handler);
  },

  // 系统路径
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
});
```

---

# 第三部分：项目结构

## 3.1 目录结构

```
layout3.0/
├── electron/
│   ├── main/
│   │   ├── index.ts              # 主进程入口
│   │   ├── ipc-handlers.ts      # IPC 处理器注册
│   │   ├── file-handlers.ts     # 文件系统 IPC 处理
│   │   ├── pdf-handlers.ts      # PDF 导出 IPC 处理
│   │   ├── menu.ts              # 原生菜单定义
│   │   └── window.ts            # 窗口管理
│   └── preload/
│       └── index.ts             # 预加载脚本（Bridge）
│
├── src/
│   ├── main.tsx                  # React 应用入口
│   │
│   ├── components/               # UI 组件层
│   │   ├── layout/
│   │   │   ├── AppShell.tsx     # 根组件（面板布局）
│   │   │   ├── Toolbar.tsx      # 顶部工具栏
│   │   │   ├── LeftPanel.tsx    # 左侧面板（Tab 切换）
│   │   │   ├── RightPanel.tsx   # 右侧属性面板
│   │   │   ├── Canvas.tsx       # 中间画布区域
│   │   │   └── StatusBar.tsx    # 底部状态栏
│   │   ├── panels/
│   │   │   ├── FilePanel.tsx    # 文件管理面板
│   │   │   ├── OutlinePanel.tsx # 大纲面板
│   │   │   ├── SearchPanel.tsx  # 搜索面板
│   │   │   └── ResourcePanel.tsx # 资源库面板
│   │   ├── editor/
│   │   │   ├── MarkdownEditor.tsx    # CodeMirror 编辑器封装
│   │   │   └── FloatingToolbar.tsx   # 浮动工具条
│   │   ├── canvas/
│   │   │   ├── PageCanvas.tsx        # 分页画布
│   │   │   ├── Page.tsx              # 单页渲染
│   │   │   ├── ElementRenderer.tsx    # 元素渲染器（dispatch 到具体组件）
│   │   │   ├── TextElement.tsx        # 文本段落
│   │   │   ├── ImageElement.tsx       # 图片元素
│   │   │   ├── TableElement.tsx       # 表格元素
│   │   │   ├── EquationElement.tsx    # 公式元素
│   │   │   ├── NoteBoxElement.tsx     # 便利贴元素
│   │   │   └── PageNavigator.tsx       # 页面导航器
│   │   ├── properties/
│   │   │   ├── TextPropertyPanel.tsx  # 文本属性面板
│   │   │   ├── ImagePropertyPanel.tsx # 图片属性面板
│   │   │   ├── TablePropertyPanel.tsx # 表格属性面板
│   │   │   ├── PagePropertyPanel.tsx  # 页面设置面板
│   │   │   └── TemplatePanel.tsx      # 模板面板
│   │   ├── ai/
│   │   │   ├── AiPanel.tsx           # AI 面板主组件
│   │   │   ├── AiGenerateTab.tsx      # 生成 Tab
│   │   │   ├── AiOptimizeTab.tsx      # 优化 Tab
│   │   │   └── AiCheckTab.tsx         # 检查 Tab
│   │   ├── common/
│   │   │   ├── Toast.tsx             # 轻提示
│   │   │   ├── Modal.tsx              # 模态对话框
│   │   │   ├── ContextMenu.tsx        # 右键菜单
│   │   │   ├── CommandPalette.tsx     # 命令面板
│   │   │   ├── ProgressBar.tsx        # 进度条
│   │   │   ├── Tooltip.tsx           # 提示气泡
│   │   │   └── DropZone.tsx          # 文件拖拽放置区
│   │   └── guide/
│   │       └── OnboardingGuide.tsx    # 新手引导
│   │
│   ├── engine/                     # 核心引擎层（纯 TypeScript，无 React 依赖）
│   │   ├── parser/
│   │   │   ├── index.ts             # 解析管线入口
│   │   │   ├── remark.ts            # remark 插件配置
│   │   │   ├── rehype.ts           # rehype 插件配置
│   │   │   ├── plugins/
│   │   │   │   ├── remark-math.ts  # 数学公式解析
│   │   │   │   ├── rehype-toc.ts   # 目录生成
│   │   │   │   ├── rehype-table.ts # 表格结构增强
│   │   │   │   └── rehype-pagebreak.ts # 分页符处理
│   │   │   └── types.ts            # mdast/hast 类型扩展
│   │   │
│   │   ├── typesetting/
│   │   │   ├── index.ts            # 排版引擎入口
│   │   │   ├── Pager.ts            # 分页算法核心
│   │   │   ├── PageBreaker.ts      # 页面分割逻辑
│   │   │   ├── OverflowHandler.ts  # 溢出处理策略
│   │   │   ├── StyleApplier.ts     # 样式应用引擎
│   │   │   ├── HeaderFooter.ts     # 页眉页脚生成
│   │   │   └── TablePager.ts       # 表格跨页处理
│   │   │
│   │   ├── style/
│   │   │   ├── StyleEngine.ts      # 样式规则引擎
│   │   │   ├── TemplateManager.ts  # 模板管理器
│   │   │   ├── StylePriority.ts    # 样式优先级计算
│   │   │   └── tokens.ts           # 样式 token 定义
│   │   │
│   │   └── export/
│   │       ├── PdfExporter.ts      # PDF 导出器（封装 Electron API）
│   │       └── ImageExporter.ts    # 图片导出器
│   │
│   ├── store/                      # 状态管理层
│   │   ├── index.ts                # Store 入口
│   │   ├── slices/
│   │   │   ├── documentSlice.ts    # 文档状态（源码、结构化 JSON）
│   │   │   ├── selectionSlice.ts  # 选中状态（选中元素、选中页面）
│   │   │   ├── layoutSlice.ts     # 布局状态（分页结果、当前页）
│   │   │   ├── styleSlice.ts      # 样式状态（当前模板、局部样式）
│   │   │   ├── viewSlice.ts       # 视图状态（视图模式、缩放）
│   │   │   ├── uiSlice.ts         # UI 状态（面板显隐、模态框）
│   │   │   └── historySlice.ts    # 历史记录（撤销/重做）
│   │   ├── middleware/
│   │   │   ├── undoMiddleware.ts  # 撤销重做中间件
│   │   │   ├── persistMiddleware.ts # 持久化中间件（IndexedDB）
│   │   │   └── syncMiddleware.ts  # 编辑器-画布同步中间件
│   │   └── selectors/
│   │       ├── layoutSelectors.ts  # 分页相关选择器
│   │       └── styleSelectors.ts  # 样式相关选择器
│   │
│   ├── services/                   # 服务层
│   │   ├── FileService.ts         # 文件操作服务（封装 electronAPI）
│   │   ├── TemplateService.ts     # 模板服务（加载/保存/应用模板）
│   │   ├── AiService.ts           # AI 服务（封装 LLM API 调用）
│   │   ├── ExportService.ts       # 导出服务
│   │   └── HistoryService.ts      # 版本历史服务
│   │
│   ├── hooks/                      # 自定义 Hooks
│   │   ├── useDocument.ts        # 文档操作（CRUD）
│   │   ├── useSelection.ts        # 选中元素操作
│   │   ├── useLayout.ts           # 排版结果订阅
│   │   ├── useTemplate.ts         # 模板操作
│   │   ├── useExport.ts           # 导出操作
│   │   ├── useShortcuts.ts        # 快捷键注册
│   │   ├── useKeyboardNavigation.ts # 键盘导航
│   │   ├── useElementDrag.ts      # 元素拖拽
│   │   └── useAIPanel.ts         # AI 面板交互
│   │
│   ├── types/                      # 全局类型定义
│   │   ├── document.ts           # 文档结构类型
│   │   ├── element.ts            # 元素类型（heading/paragraph/table...）
│   │   ├── style.ts             # 样式类型
│   │   ├── template.ts           # 模板类型
│   │   ├── layout.ts            # 排版结果类型
│   │   └── api.ts               # Electron API 类型声明
│   │
│   ├── utils/                      # 工具函数
│   │   ├── dom.ts                # DOM 测量工具（getBoundingClientRect）
│   │   ├── colors.ts             # 颜色转换工具
│   │   ├── units.ts              # 单位转换（mm/px/pt）
│   │   ├── debounce.ts           # 防抖/节流
│   │   └── keyboard.ts          # 快捷键匹配工具
│   │
│   ├── constants/                  # 常量定义
│   │   ├── page-sizes.ts         # 纸张尺寸常量（A3/A4/B5...）
│   │   ├── fonts.ts              # 默认字体配置
│   │   ├── colors.ts             # 默认色板
│   │   └── defaults.ts           # 默认样式配置
│   │
│   └── styles/                    # 全局样式
│       ├── globals.css           # Tailwind 入口 + CSS 变量
│       ├── canvas.css            # 画布样式
│       ├── editor.css            # 编辑器样式（CodeMirror 主题）
│       └── components.css       # 通用组件样式
│
├── resources/
│   ├── templates/                  # 内置模板
│   │   ├── lecture.json          # 极简讲义模板
│   │   ├── textbook.json         # 教辅资料模板
│   │   ├── academic.json        # 学术论文模板
│   │   └── color-notes.json      # 彩色笔记模板
│   └── icons/                    # 应用图标
│
├── electron-builder.yml          # electron-builder 配置
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── .eslintrc.js
```

---

# 第四部分：核心模块详细设计

## 4.1 文档状态模型

文档状态是整个应用的单一数据来源，使用 Zustand 管理：

```typescript
// store/slices/documentSlice.ts
interface DocumentState {
  // 元信息
  id: string;
  title: string;
  path: string | null;           // 本地路径，未保存时为 null
  lastModified: number;
  isDirty: boolean;

  // 内容层
  source: string;                // Markdown 源码

  // 结构层
  ast: HAST;                      // rehype 输出的 HTML AST
  toc: TocItem[];                 // 目录数据

  // 资源
  resources: ResourceItem[];      // 图片等资源列表

  // 草稿（异常恢复用）
  draftSource: string;
  draftTimestamp: number;
}
```

### 文档状态流转

```
用户输入 Markdown
      │
      ▼
CodeMirror DocChange 事件
      │
      ▼
debounce 300ms → dispatch('document/updateSource')
      │
      ▼
解析管线异步执行（Worker）
      │
      ├── remark.parse(source) → mdast
      ├── remark.transform(mdast) → plugins
      └── rehype.stringify(mdast) → hast
      │
      ▼
dispatch('document/updateAst') + dispatch('document/updateToc')
      │
      ▼
排版引擎订阅 ast 变化
      │
      ▼
重新计算分页
      │
      ▼
dispatch('layout/updatePages')
      │
      ▼
Canvas 重新渲染
```

## 4.2 排版引擎设计

### 4.2.1 分页算法

排版引擎接收 HAST，输出分页结果。核心接口：

```typescript
// engine/typesetting/index.ts
interface PageBreakOpportunity {
  nodeId: string;
  breakType: 'none' | 'allowed' | 'forced';
  cost: number;                      // 分页代价，用于选择最优分页点
}

interface PageLayout {
  pageNumber: number;
  width: number;                      // 单位：px（以 96dpi 计算）
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  elements: LayoutElement[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

interface LayoutElement {
  id: string;
  hastNode: hast.Node;
  x: number;
  y: number;
  width: number;
  height: number;
  style: ComputedStyle;
  breakBefore: boolean;
  breakAfter: boolean;
  keepWithNext: boolean;
  pageNumber: number;
}

class TypesettingEngine {
  private pageWidth: number;
  private pageHeight: number;
  private margins: Margins;

  // 主入口
  layout(ast: hast.Root, documentStyle: DocumentStyle): PageLayout[];

  // 逐节点布局
  private layoutBlock(node: hast.Node, context: LayoutContext): LayoutBlock;

  // 分页决策
  private computePageBreaks(blocks: LayoutBlock[], style: DocumentStyle): PageBreak[];

  // 单页构建
  private buildPage(blocks: LayoutBlock[], startIdx: number): PageLayout;

  // 溢出处理
  private handleOverflow(element: LayoutElement, page: PageLayout): OverflowAction;
}
```

### 4.2.2 分页决策规则（优先级从高到低）

```typescript
// engine/typesetting/PageBreaker.ts
const PAGE_BREAK_RULES: PageBreakRule[] = [
  // 1. 强制分页符（用户手动插入）
  { selector: '[data-page-break="forced"]', action: 'BREAK_BEFORE' },

  // 2. 固定元素（keepOnPage）
  { selector: '[data-keep-on-page]', action: 'NO_BREAK_AROUND' },

  // 3. 孤寡行控制：标题尽量不出现在页尾
  {
    selector: '[data-heading]',
    rule: 'orphaned-heading',
    action: 'KEEP_WITH_NEXT',
    minLinesOnPage: 2,
  },

  // 4. 表格跨页处理
  {
    selector: '[data-table]',
    rule: 'table-header-repeat',
    action: 'REPEAT_TABLE_HEADER',
    headerRows: 1,
  },

  // 5. 图片不拆分（优先缩放，其次移至下一页）
  {
    selector: '[data-image]',
    rule: 'no-image-split',
    actions: ['SCALE_DOWN', 'MOVE_TO_NEXT'],
    maxScale: 0.8,
  },

  // 6. 公式不跨页
  {
    selector: '[data-equation]',
    rule: 'no-equation-split',
    action: 'KEEP_INTACT',
  },

  // 7. 列表项避免分页（单个列表项跨页时考虑合并）
  {
    selector: '[data-list-item]',
    rule: 'avoid-list-fragment',
    minLines: 3,
  },
];
```

### 4.2.3 溢出处理策略

```typescript
// engine/typesetting/OverflowHandler.ts
type OverflowAction = 'SCALE_DOWN' | 'MOVE_TO_NEXT' | 'SHRINK_FONT' | 'WARN_USER' | 'ALLOW_OVERFLOW';

function computeOverflowAction(
  element: LayoutElement,
  page: PageLayout,
  overflow: number
): OverflowAction {
  const available = page.height - element.y - page.margin.bottom;
  const overflowRatio = overflow / available;

  switch (element.type) {
    case 'image':
      if (overflowRatio < 0.2) return 'SCALE_DOWN';       // 溢出少，缩放
      if (overflowRatio < 0.5) return 'MOVE_TO_NEXT';    // 溢出较多，移下一页
      return 'WARN_USER';                                  // 溢出严重，提示用户

    case 'table':
      if (element.allowPageBreak) return 'MOVE_TO_NEXT';  // 允许跨页则移走
      return 'WARN_USER';                                  // 不允许跨页则提示

    case 'equation':
      return 'MOVE_TO_NEXT';                              // 公式整体移走

    case 'paragraph':
    case 'heading':
      return 'ALLOW_OVERFLOW';                             // 文本自动流入下一页

    default:
      return 'WARN_USER';
  }
}
```

## 4.3 解析管线设计

### 4.3.1 unified 处理流程

```typescript
// engine/parser/index.ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import { remarkToc } from './plugins/rehype-toc';
import { remarkPageBreak } from './plugins/rehype-pagebreak';

export interface ParseResult {
  hast: hast.Root;          // HTML AST，供排版引擎消费
  toc: TocItem[];            // 目录数据
  errors: ParseError[];      // 解析错误（公式解析失败等）
  meta: DocumentMeta;        // 文档元信息（字数、标题列表等）
}

export async function parseMarkdown(source: string): Promise<ParseResult> {
  const file = await unified()
    .use(remarkParse)                // Markdown → mdast
    .use(remarkGfm)                  // GFM 扩展（表格、任务列表）
    .use(remarkMath)                 // 数学公式（行内 + 独立）
    .use(remarkRehype, { allowDangerousHtml: true }) // mdast → hast
    .use(remarkToc, { maxLevel: 3 }) // 目录生成
    .use(rehypeKatex)                // LaTeX → MathML
    .use(rehypePageBreak)            // 分页符处理
    .use(rehypeStringify)             // hast → HTML 字符串（供导出）
    .process(source);

  const vfile = file as VFile & { toc: TocItem[]; meta: DocumentMeta };
  return {
    hast: parse(vfile.toString()),    // 重新解析 HTML 得到 hast
    toc: vfile.data.toc ?? [],
    errors: extractErrors(vfile),
    meta: vfile.data.meta ?? {},
  };
}
```

### 4.3.2 目录生成插件

```typescript
// engine/parser/plugins/rehype-toc.ts
import { Plugin } from 'unified';

export const remarkToc: Plugin<[{ maxLevel?: number }], hast.Root, hast.Root> =
  (options = {}) => (tree: hast.Root) => {
    const toc: TocItem[] = [];
    let pageNumber = 1;

    visit(tree, 'element', (node: hast.Element, index, parent) => {
      if (node.tagName === 'h1' || node.tagName === 'h2' || node.tagName === 'h3') {
        const level = parseInt(node.tagName[1]);
        if (level <= (options.maxLevel ?? 3)) {
          const text = extractText(node);
          const id = generateSlug(text);
          toc.push({ id, text, level, pageNumber });
        }
      }
    });

    // 将 toc 挂载到 vFile.data（通过 data API）
    (tree as any).data = { ...(tree as any).data, toc };
  };
```

## 4.4 模板系统设计

### 4.4.1 模板数据结构

```typescript
// types/template.ts
interface Template {
  id: string;
  name: string;
  category: 'lecture' | 'textbook' | 'academic' | 'notes' | 'custom';
  description?: string;
  thumbnail?: string;            // base64 缩略图
  createdAt: number;

  // 页面设置
  page: PageSettings;

  // 字体体系
  typography: {
    baseFontFamily: string;
    headingFontFamily?: string;
    baseFontSize: number;        // pt
    lineHeight: number;
    headings: Record<1 | 2 | 3 | 4 | 5 | 6, HeadingStyle>;
  };

  // 元素默认样式
  elements: {
    paragraph: ParagraphStyle;
    blockquote: BlockquoteStyle;
    codeBlock: CodeBlockStyle;
    table: TableStyle;
    image: ImageStyle;
    equation: EquationStyle;
    noteBox: NoteBoxStyle;
  };

  // 页眉页脚
  header?: HeaderFooterStyle;
  footer?: HeaderFooterStyle;

  // 背景
  background?: BackgroundStyle;
}

interface PageSettings {
  size: 'A3' | 'A4' | 'B5' | 'custom';
  width?: number;                // mm
  height?: number;              // mm
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  columns: number;
  columnGap?: number;
  columnDivider?: boolean;
}
```

### 4.4.2 样式优先级

样式按以下优先级从高到低生效：

```
手动局部样式（用户在属性面板中直接修改）
  > 元素模板（仅影响单个元素）
  > 整套模板（影响全文，由用户主动应用）
  > 文档默认样式（内置默认配置）
```

```typescript
// engine/style/StylePriority.ts
function computeStyle(
  element: LayoutElement,
  template: Template,
  localOverrides: Partial<ElementStyle>
): ComputedStyle {
  const base = template.elements[element.type] ?? template.elements.paragraph;
  const templateStyle = resolveTemplateStyle(element, template);
  const merged = { ...base, ...templateStyle };
  const final = { ...merged, ...localOverrides };
  return finalizeStyle(final);
}
```

## 4.5 PDF 导出设计

### 4.5.1 导出流程

```typescript
// engine/export/PdfExporter.ts
interface PdfExportOptions {
  pages: 'all' | 'current' | 'range';
  range?: string;               // e.g. "1-5, 8, 10-12"
  includeBackground: boolean;
  includeHeaderFooter: boolean;
  quality: 'print' | 'screen';
  imageQuality: number;         // 0-100
}

async function exportPdf(
  pages: PageLayout[],
  options: PdfExportOptions
): Promise<Buffer> {
  // 1. 将分页结果渲染为 HTML 字符串
  const html = renderPagesToHtml(pages, options);

  // 2. 调用 Electron PrintToPDF
  const buffer = await electronAPI.exportPdf(html, {
    printBackground: options.includeBackground,
    pageSize: 'A4',              // 映射自 page.size
    margins: pages[0].margin,   // 映射自 page.margins（mm → px）
    scale: 1.0,
  });

  return buffer;
}
```

### 4.5.2 导出前检查

```typescript
// services/ExportService.ts
interface ExportCheckItem {
  type: 'error' | 'warning' | 'info';
  page?: number;
  element?: string;
  message: string;
  suggestion: string;
  action?: () => void;          // 可一键修复的操作
}

async function performExportCheck(doc: DocumentState): Promise<ExportCheckItem[]> {
  const issues: ExportCheckItem[] = [];

  // 检查图片
  for (const img of doc.resources.filter(r => r.type === 'image')) {
    if (!img.exists) {
      issues.push({
        type: 'error',
        page: img.pageNumber,
        element: img.id,
        message: `图片 ${img.name} 路径失效`,
        suggestion: '重新选择图片文件',
        action: () => openImageReplacer(img.id),
      });
    }
  }

  // 检查公式
  const ast = doc.ast;
  visit(ast, 'element', (node) => {
    if (node.properties?.['data-equation-error']) {
      issues.push({
        type: 'error',
        message: `公式解析失败：${getEquationError(node)}`,
        suggestion: '点击编辑公式',
      });
    }
  });

  // 检查溢出
  for (const page of doc.layout) {
    for (const el of page.elements) {
      if (el.overflow) {
        issues.push({
          type: 'warning',
          page: page.pageNumber,
          element: el.id,
          message: '内容溢出页面边界',
          suggestion: '缩小元素或调整分页',
        });
      }
    }
  }

  return issues;
}
```

## 4.6 AI 服务设计

### 4.6.1 AI 能力接口

```typescript
// services/AiService.ts
type AiProvider = 'openai' | 'anthropic' | 'custom';

interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;             // 支持自定义 endpoint（如代理服务器）
  model: string;
  temperature?: number;
}

interface AiGenerateOptions {
  type: 'lecture' | 'summary' | 'exercise' | 'exam';
  topic: string;
  grade?: string;               // 年级
  subject?: string;            // 科目
  length?: 'short' | 'medium' | 'long';
}

interface AiOptimizeOptions {
  text: string;
  mode: 'polish' | 'rewrite' | 'summary' | 'expand' | 'simplify' | 'formalize';
  style?: 'lecture' | 'notes';
}

interface AiCheckResult {
  page: number;
  type: 'error' | 'warning' | 'suggestion';
  elementId?: string;
  message: string;
  suggestion: string;
  autoFixable: boolean;
  fixAction?: () => string;    // 返回修复后的文本
}

class AiService {
  async generate(options: AiGenerateOptions): Promise<string> {
    const prompt = this.buildGeneratePrompt(options);
    return this.streamGenerate(prompt); // 流式返回
  }

  async optimize(text: string, options: AiOptimizeOptions): Promise<string> {
    const prompt = this.buildOptimizePrompt(text, options);
    return this.streamGenerate(prompt);
  }

  async checkDocument(ast: hast.Root): Promise<AiCheckResult[]> {
    const structuredDoc = this.structureDocument(ast);
    const prompt = this.buildCheckPrompt(structuredDoc);
    const response = await this.generateNonStream(prompt);
    return this.parseCheckResults(response);
  }

  private async streamGenerate(prompt: string): Promise<string> {
    // 使用 OpenAI SDK 或 Anthropic SDK 的流式接口
    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    });

    let result = '';
    for await (const chunk of stream) {
      result += chunk.choices[0]?.delta?.content ?? '';
      this.onChunk?.(result);  // 实时回调，用于流式 UI
    }
    return result;
  }
}
```

---

# 第五部分：接口与协议

## 5.1 组件间通信协议

### 5.1.1 Zustand Store 接口

```typescript
// store/index.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { undo } from 'zundo';
import { documentSlice } from './slices/documentSlice';
import { selectionSlice } from './slices/selectionSlice';
import { layoutSlice } from './slices/layoutSlice';
import { styleSlice } from './slices/styleSlice';
import { viewSlice } from './slices/viewSlice';
import { uiSlice } from './slices/uiSlice';

export type Store = {
  document: DocumentState;
  selection: SelectionState;
  layout: LayoutState;
  style: StyleState;
  view: ViewState;
  ui: UIState;
};

export const useStore = create<Store>()(
  immer(
    undo(
      compose(
        (set, get) => ({
          ...documentSlice(set, get),
          ...selectionSlice(set, get),
          ...layoutSlice(set, get),
          ...styleSlice(set, get),
          ...viewSlice(set, get),
          ...uiSlice(set, get),
        })
      )
    )
  )
);

// 组件中订阅
const source = useStore(s => s.document.source);          // 订阅源码
const selectedElement = useStore(s => s.selection.element); // 订阅选中元素
const pages = useStore(s => s.layout.pages);             // 订阅分页结果

// 选择性订阅（避免不必要渲染）
const selectedElementStyle = useStore(
  s => s.document.ast && s.selection.elementId
    ? getElementStyle(s.document.ast, s.selection.elementId)
    : null,
  shallow
);
```

### 5.1.2 编辑器与画布同步协议

```typescript
// store/middleware/syncMiddleware.ts
// 订阅 CodeMirror 编辑器的 DocChange 事件，驱动解析管线

let parseDebounceTimer: ReturnType<typeof setTimeout>;

editorView.dom.addEventListener('blur', () => {
  // ...
});

editorView.dispatch({
  tr: editorView.state.tr,
});

// 编辑器变更 → 更新源码 → 防抖解析 → 更新 AST → 触发排版重算
editorView.state.doc.plugin(EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    const source = update.state.doc.toString();
    dispatch({ type: 'document/updateSource', payload: source });

    clearTimeout(parseDebounceTimer);
    parseDebounceTimer = setTimeout(async () => {
      const result = await parseMarkdown(source);
      dispatch({ type: 'document/updateAst', payload: result.ast });
      dispatch({ type: 'document/updateToc', payload: result.toc });
    }, 300);
  }
}));
```

## 5.2 模块间关键接口契约

| 接口名 | 所在模块 | 输入 | 输出 | 说明 |
|---|---|---|---|---|
| `parseMarkdown(source)` | Parser | `string` (Markdown) | `ParseResult` (hast + toc + errors) | 解析管线入口 |
| `engine.layout(ast, style)` | Typesetting | `hast.Root`, `DocumentStyle` | `PageLayout[]` | 排版引擎入口 |
| `computeOverflowAction(el, page)` | Typesetting | `LayoutElement`, `PageLayout` | `OverflowAction` | 溢出处理 |
| `applyTemplate(doc, template, scope)` | Style | `DocumentState`, `Template`, `'all'\|'selection'\|'type'` | `DocumentState` | 模板应用 |
| `exportPdf(pages, options)` | Export | `PageLayout[]`, `PdfExportOptions` | `Buffer` | PDF 导出 |
| `ai.generate(options)` | AI | `AiGenerateOptions` | `string` (stream) | AI 生成 |
| `ai.check(ast)` | AI | `hast.Root` | `AiCheckResult[]` | AI 检查 |
| `fileService.open(path)` | File | `string` | `DocumentState` | 打开文件 |
| `fileService.save(state, path)` | File | `DocumentState`, `string` | `void` | 保存文件 |

---

# 第六部分：开发流程

## 6.1 开发阶段规划

```
第一阶段：基础架构（MVP 核心）    → 预计 6–8 周
  ├── Electron + Vite + React 脚手架
  ├── 项目结构初始化（目录、TypeScript 配置）
  ├── Zustand Store 基础架构
  ├── CodeMirror Markdown 编辑器集成
  ├── 解析管线（remark + rehype）集成
  ├── 基础排版引擎（DOM 分页）
  ├── 三栏 UI 骨架（工具栏 + 左面板 + 画布 + 右面板）
  ├── PDF 导出（Electron PrintToPDF）
  └── 文件管理（新建/打开/保存）

第二阶段：排版深化                → 预计 4–6 周
  ├── 精细分页算法（孤寡行/表头跨页/溢出处理）
  ├── 表格可视化编辑（调整行列、合并单元格）
  ├── 图片环绕布局
  ├── 公式渲染（KaTeX）
  ├── 目录自动生成与跳转
  ├── 页眉页脚系统
  ├── 大纲面板
  └── 基础模板系统

第三阶段：AI 与体验               → 预计 4–6 周
  ├── AI 面板（生成/优化/检查）
  ├── 命令面板
  ├── 多视图切换（源码/分屏/预览）
  ├── 搜索与替换
  ├── 首次使用引导
  └── 撤销重做完善

第四阶段：完善与发布              → 预计 2–4 周
  ├── 模板库系统（内置模板 + 用户模板管理）
  ├── 导出检查面板
  ├── 性能优化（大型文档）
  ├── 打包与发布
  └── 文档与帮助
```

## 6.2 技术债务管理

| 技术债务 | 影响 | 偿还计划 |
|---|---|---|
| MVP 使用 DOM + CSS 分页（无精细控制） | 排版精度不足 | 第二阶段重构为逐元素测量分页 |
| 排版引擎未使用 Web Worker | 大文档解析卡顿 | 第一阶段完成后迁移到 Worker |
| 表格仅支持基础编辑 | 复杂表格无法处理 | 第二阶段完善表格功能 |
| AI 服务未接入流式输出 | 生成体验差 | 第三阶段 AI 面板完成时接入 |
| 无插件系统 | 功能扩展困难 | P3 阶段规划 |

## 6.3 关键里程碑

| 里程碑 | 完成标准 |
|---|---|
| M1：可编辑可导出 | Markdown 编辑 → PDF 导出完整链路跑通 |
| M2：排版可用 | 分页、模板、页眉页脚基础能力就绪 |
| M3：可发布 | 性能达标（100 页文档 < 3s），无 P0 bug |
| M4：AI 就绪 | AI 面板三 Tab（生成/优化/检查）全部可用 |
| GA | 模板库、帮助文档、打包发布全部完成 |

---

# 第七部分：代码规范与质量保障

## 7.1 代码规范

### 7.1.1 TypeScript 规范

```typescript
// 1. 严格类型：所有函数参数和返回值必须有类型
function parseMarkdown(source: string): Promise<ParseResult> { ... }

// 2. 接口优于类型别名（类型别名用于联合/交叉类型）
interface PageLayout { pageNumber: number; elements: LayoutElement[]; }
type OverflowAction = 'SCALE_DOWN' | 'MOVE_TO_NEXT' | 'WARN_USER';

// 3. 避免 any，使用 unknown + 类型守卫
function safeParse(json: unknown): ParseResult {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Invalid JSON');
  }
  // ...
}

// 4. 引擎层纯 TypeScript，不依赖 React
// engine/typesetting/PageBreaker.ts — 无任何 React import
```

### 7.1.2 React 组件规范

```typescript
// 1. 组件按职责分类
// components/layout/   → 布局组件（AppShell, Toolbar, Panels）
// components/canvas/   → 画布组件（Page, ElementRenderer）
// components/common/  → 通用组件（Toast, Modal, Tooltip）

// 2. 优先使用函数组件 + Hooks
function PageCanvas() {
  const pages = useStore(s => s.layout.pages);
  const selectedElementId = useStore(s => s.selection.elementId);
  const dispatch = useStore(s => s.dispatch);

  const handleElementClick = useCallback((id: string) => {
    dispatch({ type: 'selection/setElement', payload: id });
  }, [dispatch]);

  return (/* ... */);
}

// 3. 组件props接口
interface PageProps {
  layout: PageLayout;
  isSelected: boolean;
  onElementClick: (id: string) => void;
  onPageClick: () => void;
}

// 4. 使用 Tailwind 处理样式，CSS 文件仅用于无法用 Tailwind 实现的复杂效果
```

### 7.1.3 引擎层规范

```typescript
// engine/typesetting/Pager.ts
// 引擎层是纯 TypeScript 类，不依赖任何 React / Zustand / Electron API
class Pager {
  constructor(config: PageConfig) {
    this.pageWidth = config.pageWidth;
    this.pageHeight = config.pageHeight;
    this.margins = config.margins;
  }

  layout(blocks: LayoutBlock[]): PageLayout[] {
    const pages: PageLayout[] = [];
    let currentPage = this.createPage(1);
    let currentY = this.margins.top;

    for (const block of blocks) {
      const { height } = this.measureBlock(block);

      if (currentY + height > this.pageHeight - this.margins.bottom) {
        pages.push(currentPage);
        currentPage = this.createPage(pages.length + 1);
        currentY = this.margins.top;
      }

      currentPage.elements.push(this.placeBlock(block, currentY));
      currentY += height;
    }

    if (currentPage.elements.length > 0) {
      pages.push(currentPage);
    }

    return pages;
  }
}
```

## 7.2 测试策略

### 7.2.1 测试分层

```
单元测试（Vitest）         → 引擎层（Parser, Typesetting, StyleEngine）
 覆盖率目标：> 80%

集成测试（Vitest + @testing-library/react）→ Store、组件交互
 覆盖目标：核心链路（编辑 → 解析 → 排版 → 导出）

E2E 测试（Playwright）     → 完整用户流程
 覆盖目标：新建 → 编辑 → 排版 → 导出 PDF
```

### 7.2.2 引擎层单元测试示例

```typescript
// engine/typesetting/__tests__/Pager.test.ts
import { describe, it, expect } from 'vitest';
import { Pager } from '../Pager';
import { createMockBlock } from '../__fixtures__/blocks';

describe('Pager', () => {
  it('将内容分配到正确页数', () => {
    const pager = new Pager({
      pageWidth: 595,           // A4 width @ 72dpi
      pageHeight: 842,          // A4 height @ 72dpi
      margins: { top: 72, right: 72, bottom: 72, left: 72 },
    });

    const blocks = [
      createMockBlock('heading', 50),  // 50px 高
      createMockBlock('paragraph', 400),
      createMockBlock('paragraph', 400),
    ];

    const pages = pager.layout(blocks);

    expect(pages.length).toBe(1);
    expect(pages[0].elements).toHaveLength(3);
  });

  it('内容超出一页时自动分页', () => {
    const pager = new Pager({
      pageWidth: 595,
      pageHeight: 200,           // 故意设置较小的页面高度
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    });

    const blocks = [
      createMockBlock('paragraph', 300),
      createMockBlock('paragraph', 300),
    ];

    const pages = pager.layout(blocks);
    expect(pages.length).toBeGreaterThan(1);
  });

  it('强制分页符前断页', () => {
    const pager = new Pager({
      pageWidth: 595, pageHeight: 842,
      margins: { top: 72, right: 72, bottom: 72, left: 72 },
    });

    const blocks = [
      createMockBlock('paragraph', 200),
      createMockBlock('pagebreak', 0),         // 强制分页
      createMockBlock('paragraph', 200),
    ];

    const pages = pager.layout(blocks);
    expect(pages[0].elements).toHaveLength(2);  // 第一页：paragraph + pagebreak
    expect(pages[1].elements).toHaveLength(1);  // 第二页：paragraph
  });

  it('标题不出现在页尾（孤寡行控制）', () => {
    const pager = new Pager({
      pageWidth: 595, pageHeight: 250,  // 限制页面高度
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    });

    const blocks = [
      createMockBlock('paragraph', 150),
      createMockBlock('heading', 30, { keepWithNext: true }),
      createMockBlock('paragraph', 150),
    ];

    const pages = pager.layout(blocks);
    // 如果 heading 在第一页末尾，第二段也应移至下一页
    const firstPage = pages[0];
    const lastEl = firstPage.elements[firstPage.elements.length - 1];
    expect(lastEl.type).not.toBe('heading');
  });
});
```

### 7.2.3 解析管线测试

```typescript
// engine/parser/__tests__/pipeline.test.ts
describe('Markdown 解析管线', () => {
  it('解析标准 Markdown', async () => {
    const result = await parseMarkdown('# Hello\n\nParagraph text.');
    expect(result.toc).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('解析数学公式', async () => {
    const result = await parseMarkdown('Inline $x^2$ and display $$\\int_0^1$$');
    expect(result.errors).toHaveLength(0);
  });

  it('表格生成正确的结构', async () => {
    const result = await parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    const table = findNode(result.ast, 'table');
    expect(table).toBeDefined();
  });

  it('分页符被正确标记', async () => {
    const result = await parseMarkdown('Page 1\n\n<!-- pagebreak -->\n\nPage 2');
    const breaks = findAllNodes(result.ast, '[data-page-break]');
    expect(breaks.length).toBe(1);
  });
});
```

## 7.3 性能基准

| 指标 | 目标 | 测量方法 |
|---|---|---|
| 冷启动时间 | < 3s | 从双击应用到窗口显示 |
| 10 页文档首次解析 | < 500ms | 从 source 更新到 pages 更新 |
| 100 页文档解析 | < 3s | 同上 |
| 视图切换动画 | 60fps | Chrome DevTools Performance |
| PDF 导出（A4，10 页） | < 5s | 从触发到文件写入 |
| 大纲生成 | < 100ms | 从 ast 更新到 toc 更新 |
| 连续输入响应 | < 100ms | 从击键到屏幕更新（debounce 300ms 内） |

---

# 第八部分：附录

## 8.1 快捷键总表

| 快捷键 | 功能 | 生效范围 |
|---|---|---|
| Ctrl/Cmd + N | 新建文档 | 全局 |
| Ctrl/Cmd + O | 打开文件 | 全局 |
| Ctrl/Cmd + S | 保存 | 全局 |
| Ctrl/Cmd + Shift + S | 另存为 | 全局 |
| Ctrl/Cmd + W | 关闭文档 | 全局 |
| Ctrl/Cmd + P | 导出 PDF | 全局 |
| Ctrl/Cmd + Z | 撤销 | 全局 |
| Ctrl/Cmd + Shift + Z | 重做 | 全局 |
| Ctrl/Cmd + F | 搜索 | 全局 |
| Ctrl/Cmd + H | 替换 | 全局 |
| Ctrl/Cmd + G | 跳转到页 | 全局 |
| Ctrl/Cmd + B | 切换左面板 | 全局 |
| Ctrl/Cmd + R | 切换右面板 | 全局 |
| Ctrl/Cmd + 1 | 源码视图 | 全局 |
| Ctrl/Cmd + 2 | 分屏视图 | 全局 |
| Ctrl/Cmd + 3 | 预览视图 | 全局 |
| Ctrl/Cmd + / | AI 面板 / 命令面板 | 全局 |
| Escape | 取消选择 / 关闭浮层 | 上下文 |
| V | 选择工具 | 画布 |
| M | 框选工具 | 画布 |
| H | 手形拖拽工具 | 画布 |
| T | 插入表格 | 画布 |
| I | 插入图片 | 画布 |
| Enter | 进入文本编辑 | 画布元素 |
| [ / ] | 减小 / 增大字号 | 选中元素 |
| Ctrl/Cmd + L | 添加链接 | 选中文本 |
| Ctrl/Cmd + Shift + C | 复制样式 | 选中元素 |
| Ctrl/Cmd + Shift + V | 粘贴样式 | 目标元素 |

## 8.2 文件格式

| 扩展名 | 说明 | 结构 |
|---|---|---|
| `.layout` | 工程文件（主格式） | JSON，存储源码 + AST + 资源路径 + 样式 |
| `.md` | 纯 Markdown | 纯文本，导入时使用 |
| `.pdf` | 导出文件 | 二进制 |

`.layout` 文件结构：

```json
{
  "version": "3.0.0",
  "id": "uuid-v4",
  "title": "文档标题",
  "createdAt": 1718900000000,
  "updatedAt": 1718900000000,
  "source": "# Markdown 源码...",
  "resources": [
    { "id": "img-001", "type": "image", "path": "./resources/image.png", "name": "image.png" }
  ],
  "templateId": "lecture",
  "templateOverrides": { /* 用户局部样式修改 */ },
  "meta": {
    "wordCount": 1234,
    "pageCountEstimate": 10
  }
}
```

## 8.3 默认快捷键冲突处理

产品快捷键与系统/浏览器的潜在冲突：

| 冲突快捷键 | 竞品行为 | 处理方案 |
|---|---|---|
| F11 | 浏览器全屏 | 监听后 `preventDefault`，由应用接管全屏 |
| Ctrl/Cmd + W | 浏览器关闭标签 | 由 Electron 处理，不传递到 Chromium 默认行为 |
| Ctrl/Cmd + N | 浏览器新窗口 | 同上 |

## 8.4 依赖版本锁定

所有依赖在 `package.json` 中锁定精确版本范围：

```json
{
  "dependencies": {
    "electron": "^32.0.0",
    "react": "^18.3.0",
    "typescript": "^5.5.0",
    "unified": "^11.0.0",
    "remark-parse": "^11.0.0",
    "remark-gfm": "^4.0.0",
    "remark-math": "^6.0.0",
    "remark-rehype": "^11.0.0",
    "rehype-katex": "^7.0.0",
    "rehype-stringify": "^10.0.0",
    "@codemirror/view": "^6.0.0",
    "@codemirror/state": "^6.0.0",
    "@codemirror/lang-markdown": "^6.0.0",
    "katex": "^0.16.0",
    "zustand": "^5.0.0",
    "immer": "^10.0.0",
    "dexie": "^4.0.0",
    "lucide-react": "^0.400.0"
  }
}
```

## 8.5 文档维护

本文档与《功能设计及需求.md》同步维护：

- 功能需求变更 → 更新需求文档 → 更新本开发文档对应章节
- 技术方案变更 → 更新本开发文档 → 通知需求方确认影响范围
- 每次迭代发布后，更新本文档中的开发阶段规划
