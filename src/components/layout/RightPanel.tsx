import { marginOptions, pageSizeOptions, templateOptions } from '@/constants/workspace';
import type { WorkspaceViewMode } from '@/types/workspace';

interface RightPanelProps {
  currentPageCount: number;
  headingCount: number;
  sourceLength: number;
  workspaceViewMode: WorkspaceViewMode;
}

function getViewModeLabel(workspaceViewMode: WorkspaceViewMode): string {
  switch (workspaceViewMode) {
    case 'source':
      return '源码视图';
    case 'preview':
      return '预览视图';
    default:
      return '分屏视图';
  }
}

export function RightPanel({
  currentPageCount,
  headingCount,
  sourceLength,
  workspaceViewMode,
}: RightPanelProps): JSX.Element {
  return (
    <aside className="right-panel" aria-label="属性设置">
      <section className="property-group property-summary">
        <h2>工作区摘要</h2>
        <div className="summary-grid">
          <div className="summary-card">
            <span>当前视图</span>
            <strong>{getViewModeLabel(workspaceViewMode)}</strong>
          </div>
          <div className="summary-card">
            <span>分页结果</span>
            <strong>{currentPageCount} 页</strong>
          </div>
          <div className="summary-card">
            <span>大纲标题</span>
            <strong>{headingCount} 个</strong>
          </div>
          <div className="summary-card">
            <span>源码长度</span>
            <strong>{sourceLength} 字符</strong>
          </div>
        </div>
      </section>

      <section className="property-group">
        <h2>页面</h2>

        <label>
          纸张
          <select defaultValue={pageSizeOptions[0].value}>
            {pageSizeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          页边距
          <select defaultValue={marginOptions[0].value}>
            {marginOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="panel-note-list">
          <p>页面参数将在后续样式层中接入真实分页配置。</p>
        </div>
      </section>

      <section className="property-group">
        <h2>模板</h2>
        <div className="template-list">
          {templateOptions.map((template, index) => (
            <button
              className={index === 0 ? 'template-swatch active' : 'template-swatch'}
              type="button"
              key={template.id}
            >
              {template.name}
            </button>
          ))}
        </div>
        <div className="panel-note-list">
          <p>当前先保留模板入口，后续接入模板应用与优先级规则。</p>
        </div>
      </section>

      <section className="property-group">
        <h2>排版控制</h2>
        <div className="empty-panel-state">
          <p>后续将在这里补充分页控制、标题同页和元素不跨页等专业排版设置。</p>
        </div>
      </section>
    </aside>
  );
}
