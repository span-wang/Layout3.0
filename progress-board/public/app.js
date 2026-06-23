const appElement = document.getElementById('app');

const state = {
  loading: true,
  saving: false,
  dirty: false,
  activeTab: 'tasks',
  data: null,
  filterPhaseId: 'all',
  filterQuery: '',
  selectedTaskKey: null,
  selectedRiskId: null,
  selectedDebtId: null,
  selectedLogId: null,
  message: null,
  hasInitializedFilter: false,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeLinesInput(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function linesToTextarea(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function buildTaskKey(phaseId, taskId) {
  return `${phaseId}::${taskId}`;
}

function getStatusDefinitions() {
  return state.data?.config?.statusDefinitions ?? [];
}

function getPriorityDefinitions() {
  return state.data?.config?.priorities ?? [];
}

function getAllTasks() {
  if (!state.data) {
    return [];
  }

  return state.data.taskFiles.flatMap((taskFile) =>
    taskFile.tasks.map((task) => ({
      ...task,
      phaseId: taskFile.phaseId,
      fileName: taskFile.fileName,
    })),
  );
}

function getPhaseById(phaseId) {
  return state.data?.config?.phases?.find((phase) => phase.id === phaseId) ?? null;
}

function getCurrentPhase() {
  const phases = state.data?.config?.phases ?? [];
  return phases.find((phase) => phase.status !== '已完成') ?? phases.at(-1) ?? null;
}

function getCurrentMilestone() {
  const milestones = state.data?.config?.milestones ?? [];
  return milestones.find((item) => item.status === '进行中')
    ?? milestones.find((item) => item.status !== '已完成')
    ?? milestones.at(-1)
    ?? null;
}

function getSelectedTaskContext() {
  if (!state.data || !state.selectedTaskKey) {
    return null;
  }

  const [phaseId, taskId] = state.selectedTaskKey.split('::');
  const taskFile = state.data.taskFiles.find((item) => item.phaseId === phaseId);
  if (!taskFile) {
    return null;
  }

  const taskIndex = taskFile.tasks.findIndex((task) => task.id === taskId);
  if (taskIndex < 0) {
    return null;
  }

  return {
    taskFile,
    task: taskFile.tasks[taskIndex],
    taskIndex,
  };
}

function choosePreferredTask(phaseId = state.filterPhaseId) {
  const tasks = getAllTasks();
  if (tasks.length === 0) {
    return null;
  }

  const currentPhase = getCurrentPhase();
  const scopedTasks = tasks.filter((task) => {
    if (phaseId && phaseId !== 'all') {
      return task.phaseId === phaseId;
    }

    return task.phaseId === currentPhase?.id;
  });
  const candidateTasks = scopedTasks.length > 0 ? scopedTasks : tasks;

  return candidateTasks.find((task) => task.status === '进行中')
    ?? candidateTasks.find((task) => task.executionBoundary?.confirmed)
    ?? candidateTasks[0]
    ?? null;
}

function getSelectedRisk() {
  if (!state.data || !state.selectedRiskId) {
    return null;
  }

  return state.data.risks.find((risk) => risk.id === state.selectedRiskId) ?? null;
}

function getSelectedDebt() {
  if (!state.data || !state.selectedDebtId) {
    return null;
  }

  return state.data.techDebts.find((debt) => debt.id === state.selectedDebtId) ?? null;
}

function getSelectedLog() {
  if (!state.data || !state.selectedLogId) {
    return null;
  }

  return state.data.logs.find((log) => log.id === state.selectedLogId) ?? null;
}

function ensureSelections() {
  if (!state.data) {
    return;
  }

  const preferredTask = choosePreferredTask();
  if (!getSelectedTaskContext() && preferredTask) {
    state.selectedTaskKey = buildTaskKey(preferredTask.phaseId, preferredTask.id);
  }

  if (!getSelectedRisk() && state.data.risks.length > 0) {
    state.selectedRiskId = state.data.risks[0].id;
  }

  if (!getSelectedDebt() && state.data.techDebts.length > 0) {
    state.selectedDebtId = state.data.techDebts[0].id;
  }

  if (!getSelectedLog() && state.data.logs.length > 0) {
    state.selectedLogId = state.data.logs[0].id;
  }
}

function setMessage(type, text) {
  state.message = { type, text };
}

function setDirty() {
  state.dirty = true;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || '请求失败。');
  }

  return payload;
}

async function loadBoardData(messageText = '') {
  state.loading = true;
  render();

  try {
    const payload = await fetchJson('/api/board-data');
    state.data = payload;
    state.dirty = false;
    if (!state.hasInitializedFilter) {
      state.filterPhaseId = getCurrentPhase()?.id ?? 'all';
      state.hasInitializedFilter = true;
    }
    if (messageText) {
      setMessage('success', messageText);
    } else if (!state.message) {
      setMessage('info', '已载入最新真相源。保存后会自动同步生成 Markdown 展示文档。');
    }
    ensureSelections();
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '载入失败。');
  } finally {
    state.loading = false;
    render();
  }
}

async function saveBoardData() {
  if (!state.data || state.saving) {
    return;
  }

  state.saving = true;
  setMessage('info', '正在保存真相源，并重新生成展示文档...');
  render();

  try {
    const payload = {
      revision: state.data.revision,
      config: state.data.config,
      taskFiles: state.data.taskFiles.map((taskFile) => ({
        fileName: taskFile.fileName,
        phaseId: taskFile.phaseId,
        tasks: taskFile.tasks,
      })),
      risks: state.data.risks,
      techDebts: state.data.techDebts,
      logs: state.data.logs,
    };

    const response = await fetchJson('/api/save', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    await loadBoardData(response.message);
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '保存失败。');
  } finally {
    state.saving = false;
    render();
  }
}

function selectTab(tabId) {
  state.activeTab = tabId;
  ensureSelections();
  render();
}

function createBlankTask() {
  const currentPhase = getCurrentPhase();
  const targetPhaseId = state.filterPhaseId !== 'all' ? state.filterPhaseId : currentPhase?.id ?? state.data.taskFiles[0]?.phaseId;
  const taskFile = state.data.taskFiles.find((item) => item.phaseId === targetPhaseId) ?? state.data.taskFiles[0];
  const maxOrder = taskFile.tasks.reduce((max, task) => Math.max(max, Number(task.order) || 0), 0);
  const defaultMilestone = getCurrentMilestone()?.id ?? state.data.config.milestones[0]?.id ?? 'M2';
  const defaultModule = state.data.config.modules[0]?.id ?? '';
  const task = {
    id: `TEMP-${Date.now().toString().slice(-6)}`,
    sequence: String(taskFile.tasks.length + 1),
    order: maxOrder + 10,
    title: '待补充任务标题',
    priority: getPriorityDefinitions()[0]?.level ?? 'P1',
    moduleIds: defaultModule ? [defaultModule] : [],
    milestoneIds: defaultMilestone ? [defaultMilestone] : [],
    status: '未开始',
    acceptance: '待补充验收标准。',
    executionBoundary: {
      confirmed: false,
      statusLabel: '',
      confirmedOn: '',
      summary: '',
      inScope: [],
      interactionRules: [],
      writebackRules: [],
      consistencyRules: [],
      outOfScope: [],
      deferredTo: [],
    },
  };

  taskFile.tasks.push(task);
  state.selectedTaskKey = buildTaskKey(taskFile.phaseId, task.id);
  setDirty();
  setMessage('info', '已新增任务草稿。保存前请检查任务 ID、模块和里程碑。');
  render();
}

function createBlankRisk() {
  const risk = {
    id: `RISK-${String(state.data.risks.length + 1).padStart(3, '0')}`,
    date: new Date().toISOString().slice(0, 10),
    type: '风险',
    description: '待补充风险描述。',
    impactScope: '待补充影响范围。',
    currentHandling: '待补充当前处理方式。',
  };
  state.data.risks.unshift(risk);
  state.selectedRiskId = risk.id;
  setDirty();
  render();
}

function createBlankDebt() {
  const debt = {
    id: `DEBT-${String(state.data.techDebts.length + 1).padStart(3, '0')}`,
    debt: '待补充技术债。',
    sourcePhase: '待补充来源阶段。',
    status: '未开始',
    repaymentPlan: '待补充偿还计划。',
  };
  state.data.techDebts.unshift(debt);
  state.selectedDebtId = debt.id;
  setDirty();
  render();
}

function createBlankLog() {
  const log = {
    id: `LOG-${String(state.data.logs.length + 1).padStart(3, '0')}`,
    date: new Date().toISOString().slice(0, 10),
    taskIds: [],
    phaseMilestone: '待补充阶段/里程碑',
    step: '待补充步骤',
    action: '待补充动作',
    result: '待补充结果',
    verification: [],
    affectedFiles: [],
    next: '待补充下一步',
  };
  state.data.logs.push(log);
  state.selectedLogId = log.id;
  setDirty();
  render();
}

function deleteSelectedTask() {
  const context = getSelectedTaskContext();
  if (!context) {
    return;
  }

  const shouldDelete = window.confirm(`确认删除任务 ${context.task.id} 吗？`);
  if (!shouldDelete) {
    return;
  }

  context.taskFile.tasks.splice(context.taskIndex, 1);
  state.selectedTaskKey = null;
  setDirty();
  ensureSelections();
  render();
}

function deleteSelectedRisk() {
  if (!getSelectedRisk()) {
    return;
  }

  const shouldDelete = window.confirm(`确认删除风险 ${state.selectedRiskId} 吗？`);
  if (!shouldDelete) {
    return;
  }

  state.data.risks = state.data.risks.filter((item) => item.id !== state.selectedRiskId);
  state.selectedRiskId = null;
  setDirty();
  ensureSelections();
  render();
}

function deleteSelectedDebt() {
  if (!getSelectedDebt()) {
    return;
  }

  const shouldDelete = window.confirm(`确认删除技术债 ${state.selectedDebtId} 吗？`);
  if (!shouldDelete) {
    return;
  }

  state.data.techDebts = state.data.techDebts.filter((item) => item.id !== state.selectedDebtId);
  state.selectedDebtId = null;
  setDirty();
  ensureSelections();
  render();
}

function deleteSelectedLog() {
  if (!getSelectedLog()) {
    return;
  }

  const shouldDelete = window.confirm(`确认删除日志 ${state.selectedLogId} 吗？`);
  if (!shouldDelete) {
    return;
  }

  state.data.logs = state.data.logs.filter((item) => item.id !== state.selectedLogId);
  state.selectedLogId = null;
  setDirty();
  ensureSelections();
  render();
}

function updateSelectedTaskField(field, value) {
  const context = getSelectedTaskContext();
  if (!context) {
    return;
  }

  const previousTaskId = context.task.id;
  context.task[field] = field === 'order' ? Number(value) || 0 : value;
  if (field === 'id') {
    state.selectedTaskKey = buildTaskKey(context.taskFile.phaseId, context.task.id || previousTaskId);
  }
  setDirty();
}

function updateSelectedTaskBoundary(field, value, isLines = false, isBoolean = false) {
  const context = getSelectedTaskContext();
  if (!context) {
    return;
  }

  if (!context.task.executionBoundary) {
    context.task.executionBoundary = {
      confirmed: false,
      statusLabel: '',
      confirmedOn: '',
      summary: '',
      inScope: [],
      interactionRules: [],
      writebackRules: [],
      consistencyRules: [],
      outOfScope: [],
      deferredTo: [],
    };
  }

  if (isBoolean) {
    context.task.executionBoundary[field] = Boolean(value);
  } else if (isLines) {
    context.task.executionBoundary[field] = normalizeLinesInput(value);
  } else {
    context.task.executionBoundary[field] = value;
  }

  setDirty();
}

function toggleSelectedTaskArray(field, value, enabled) {
  const context = getSelectedTaskContext();
  if (!context) {
    return;
  }

  const current = Array.isArray(context.task[field]) ? context.task[field] : [];
  const next = enabled
    ? [...new Set([...current, value])]
    : current.filter((item) => item !== value);
  context.task[field] = next;
  setDirty();
}

function updateEntityField(collectionName, selectedIdKey, field, value, isLines = false) {
  if (!state.data) {
    return;
  }

  const selectedId = state[selectedIdKey];
  const collection = state.data[collectionName];
  const target = collection.find((item) => item.id === selectedId);
  if (!target) {
    return;
  }

  const previousId = target.id;
  target[field] = isLines ? normalizeLinesInput(value) : value;
  if (field === 'id') {
    state[selectedIdKey] = target.id || previousId;
  }
  setDirty();
}

function updateConfigEntity(collectionName, entityId, field, value, isLines = false) {
  const collection = state.data?.config?.[collectionName];
  const target = collection?.find((item) => item.id === entityId);
  if (!target) {
    return;
  }

  target[field] = isLines ? normalizeLinesInput(value) : value;
  setDirty();
}

function renderStatusOptions(selectedValue) {
  return getStatusDefinitions()
    .map((item) => `<option value="${escapeHtml(item.status)}" ${item.status === selectedValue ? 'selected' : ''}>${escapeHtml(item.status)}</option>`)
    .join('');
}

function renderPriorityOptions(selectedValue) {
  return getPriorityDefinitions()
    .map((item) => `<option value="${escapeHtml(item.level)}" ${item.level === selectedValue ? 'selected' : ''}>${escapeHtml(item.level)}</option>`)
    .join('');
}

function renderTaskCard(task) {
  const phase = getPhaseById(task.phaseId);
  const taskKey = buildTaskKey(task.phaseId, task.id);
  const selectedClass = state.selectedTaskKey === taskKey ? 'selected' : '';

  return `
    <article class="task-card ${selectedClass}">
      <div class="task-card-top">
        <button type="button" data-action="select-task" data-phase-id="${escapeHtml(task.phaseId)}" data-task-id="${escapeHtml(task.id)}">
          <div class="task-card-id">${escapeHtml(task.id)}</div>
        </button>
        <span class="pill warn">${escapeHtml(task.priority)}</span>
      </div>
      <button type="button" data-action="select-task" data-phase-id="${escapeHtml(task.phaseId)}" data-task-id="${escapeHtml(task.id)}">
        <h3>${escapeHtml(task.title)}</h3>
      </button>
      <p>${escapeHtml(phase?.label ?? task.phaseId)}</p>
      <p>${escapeHtml(task.acceptance)}</p>
      <div class="quick-grid">
        <label class="field">
          <span>快速改状态</span>
          <select class="select-input" data-action="task-quick-status" data-phase-id="${escapeHtml(task.phaseId)}" data-task-id="${escapeHtml(task.id)}">
            ${renderStatusOptions(task.status)}
          </select>
        </label>
      </div>
    </article>
  `;
}

function renderTaskDetail() {
  const context = getSelectedTaskContext();
  if (!context) {
    return `
      <div class="detail-empty">
        还没有选中任务。<br />
        先从左边任务卡中选一个，或者新增一个任务草稿。
      </div>
    `;
  }

  const boundary = context.task.executionBoundary ?? {
    confirmed: false,
    statusLabel: '',
    confirmedOn: '',
    summary: '',
    inScope: [],
    interactionRules: [],
    writebackRules: [],
    consistencyRules: [],
    outOfScope: [],
    deferredTo: [],
  };

  return `
    <div class="stack">
      <div class="section-card">
        <div class="section-card-head">
          <div>
            <h3>${escapeHtml(context.task.id)}</h3>
            <h4>${escapeHtml(context.task.title)}</h4>
          </div>
          <button class="button danger" type="button" data-action="delete-task">删除任务</button>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>任务 ID</span>
            <input class="text-input mono" data-scope="task" data-field="id" value="${escapeHtml(context.task.id)}" />
          </label>
          <label class="field">
            <span>步骤序号</span>
            <input class="text-input" data-scope="task" data-field="sequence" value="${escapeHtml(context.task.sequence)}" />
          </label>
          <label class="field full">
            <span>任务标题</span>
            <input class="text-input" data-scope="task" data-field="title" value="${escapeHtml(context.task.title)}" />
          </label>
          <label class="field">
            <span>优先级</span>
            <select class="select-input" data-scope="task" data-field="priority">
              ${renderPriorityOptions(context.task.priority)}
            </select>
          </label>
          <label class="field">
            <span>状态</span>
            <select class="select-input" data-scope="task" data-field="status">
              ${renderStatusOptions(context.task.status)}
            </select>
          </label>
          <label class="field">
            <span>排序值</span>
            <input class="text-input" type="number" data-scope="task" data-field="order" value="${escapeHtml(context.task.order)}" />
          </label>
          <label class="field full">
            <span>完成标准</span>
            <textarea class="text-area" data-scope="task" data-field="acceptance">${escapeHtml(context.task.acceptance)}</textarea>
          </label>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-head">
          <h4>模块归属</h4>
          <span class="mini-note">至少保留一个模块，避免 <code>progress:check</code> 校验失败。</span>
        </div>
        <div class="checkbox-grid">
          ${state.data.config.modules.map((module) => `
            <div class="checkbox-card">
              <label>
                <input
                  type="checkbox"
                  data-action="toggle-task-module"
                  data-module-id="${escapeHtml(module.id)}"
                  ${context.task.moduleIds.includes(module.id) ? 'checked' : ''}
                />
                <strong>${escapeHtml(module.name)}</strong>
              </label>
              <span>${escapeHtml(module.summary)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-head">
          <h4>里程碑归属</h4>
          <span class="mini-note">一个任务可同时挂多个里程碑。</span>
        </div>
        <div class="checkbox-grid">
          ${state.data.config.milestones.map((milestone) => `
            <div class="checkbox-card">
              <label>
                <input
                  type="checkbox"
                  data-action="toggle-task-milestone"
                  data-milestone-id="${escapeHtml(milestone.id)}"
                  ${context.task.milestoneIds.includes(milestone.id) ? 'checked' : ''}
                />
                <strong>${escapeHtml(milestone.label)}</strong>
              </label>
              <span>${escapeHtml(milestone.completion)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-head">
          <h4>执行边界</h4>
          <span class="mini-note">每行一条，保存时会自动写回数组字段。</span>
        </div>
        <div class="form-grid">
          <div class="checkbox-card full">
            <label>
              <input type="checkbox" data-scope="task-boundary" data-field="confirmed" ${boundary.confirmed ? 'checked' : ''} />
              <strong>本步边界已确认</strong>
            </label>
            <span>未勾选时仍会保留填写内容，但生成文档不会把它当成“已确认边界”。</span>
          </div>
          <label class="field">
            <span>边界状态文案</span>
            <input class="text-input" data-scope="task-boundary" data-field="statusLabel" value="${escapeHtml(boundary.statusLabel)}" />
          </label>
          <label class="field">
            <span>确认日期</span>
            <input class="text-input" data-scope="task-boundary" data-field="confirmedOn" value="${escapeHtml(boundary.confirmedOn)}" />
          </label>
          <label class="field full">
            <span>边界摘要</span>
            <textarea class="text-area" data-scope="task-boundary" data-field="summary">${escapeHtml(boundary.summary)}</textarea>
          </label>
          <label class="field full">
            <span>本步纳入</span>
            <textarea class="text-area" data-scope="task-boundary-lines" data-field="inScope">${escapeHtml(linesToTextarea(boundary.inScope))}</textarea>
          </label>
          <label class="field full">
            <span>交互规则</span>
            <textarea class="text-area" data-scope="task-boundary-lines" data-field="interactionRules">${escapeHtml(linesToTextarea(boundary.interactionRules))}</textarea>
          </label>
          <label class="field full">
            <span>数据写回规则</span>
            <textarea class="text-area" data-scope="task-boundary-lines" data-field="writebackRules">${escapeHtml(linesToTextarea(boundary.writebackRules))}</textarea>
          </label>
          <label class="field full">
            <span>显示一致性</span>
            <textarea class="text-area" data-scope="task-boundary-lines" data-field="consistencyRules">${escapeHtml(linesToTextarea(boundary.consistencyRules))}</textarea>
          </label>
          <label class="field full">
            <span>本步明确不纳入</span>
            <textarea class="text-area" data-scope="task-boundary-lines" data-field="outOfScope">${escapeHtml(linesToTextarea(boundary.outOfScope))}</textarea>
          </label>
          <label class="field full">
            <span>后续归属任务</span>
            <textarea class="text-area" data-scope="task-boundary-lines" data-field="deferredTo">${escapeHtml(linesToTextarea(boundary.deferredTo))}</textarea>
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderTasksView() {
  const phaseOptions = state.data.config.phases;
  const allTasks = getAllTasks();
  const searchText = state.filterQuery.trim().toLowerCase();
  const filteredTasks = allTasks
    .filter((task) => state.filterPhaseId === 'all' || task.phaseId === state.filterPhaseId)
    .filter((task) => {
      if (!searchText) {
        return true;
      }

      return `${task.id} ${task.title} ${task.acceptance}`.toLowerCase().includes(searchText);
    })
    .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0));

  const columns = getStatusDefinitions().map((item) => ({
    status: item.status,
    tasks: filteredTasks.filter((task) => task.status === item.status),
  }));

  return `
    <section class="panel">
      <div class="toolbar">
        <div class="toolbar-group">
          <label class="field">
            <span>阶段筛选</span>
            <select class="select-input" data-action="filter-phase">
              <option value="all" ${state.filterPhaseId === 'all' ? 'selected' : ''}>全部阶段</option>
              ${phaseOptions.map((phase) => `
                <option value="${escapeHtml(phase.id)}" ${phase.id === state.filterPhaseId ? 'selected' : ''}>
                  ${escapeHtml(phase.label)}
                </option>
              `).join('')}
            </select>
          </label>
          <label class="field">
            <span>任务搜索</span>
            <input class="text-input" data-action="filter-query" value="${escapeHtml(state.filterQuery)}" placeholder="输入任务 ID、标题或验收标准" />
          </label>
          <button class="button warning" type="button" data-action="add-task">新增任务草稿</button>
        </div>
        <div class="toolbar-note">
          当前筛选结果共 <strong>${filteredTasks.length}</strong> 个任务。拖不开范围时，先在任务详情里写清边界再保存。
        </div>
      </div>
      <div class="two-column">
        <div class="board-columns">
          ${columns.map((column) => `
            <section class="status-column">
              <header>
                <strong>${escapeHtml(column.status)}</strong>
                <span>${column.tasks.length}</span>
              </header>
              <div class="task-list">
                ${column.tasks.length > 0
                  ? column.tasks.map((task) => renderTaskCard(task)).join('')
                  : '<div class="line-note">这一列暂时没有任务。</div>'}
              </div>
            </section>
          `).join('')}
        </div>
        <aside class="detail-shell">
          ${renderTaskDetail()}
        </aside>
      </div>
    </section>
  `;
}

function renderConfigCards(collectionName, title, description, fieldMap) {
  const collection = state.data.config[collectionName];
  return `
    <section class="config-section">
      <header>
        <div>
          <h3>${escapeHtml(title)}</h3>
          <div class="toolbar-note">${escapeHtml(description)}</div>
        </div>
      </header>
      <div class="config-grid">
        ${collection.map((item) => `
          <article class="config-card">
            <strong>${escapeHtml(item.label ?? item.name ?? item.id)}</strong>
            ${fieldMap(item)}
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderConfigView() {
  return `
    <section class="panel">
      <div class="line-note">
        这里主要开放阶段、里程碑和模块状态的调整。更底层的生成文件路径、状态定义、跟踪原则等高级结构，当前仍建议直接改真相源 JSON。
      </div>
      <div class="stack">
        ${renderConfigCards('phases', '阶段状态', '阶段目标和状态会直接回写到 progress/config.json。', (phase) => `
          <label class="field">
            <span>状态</span>
            <select class="select-input" data-scope="config-phase" data-id="${escapeHtml(phase.id)}" data-field="status">
              ${renderStatusOptions(phase.status)}
            </select>
          </label>
          <label class="field">
            <span>计划周期</span>
            <input class="text-input" data-scope="config-phase" data-id="${escapeHtml(phase.id)}" data-field="plannedCycle" value="${escapeHtml(phase.plannedCycle)}" />
          </label>
          <label class="field full">
            <span>阶段目标</span>
            <textarea class="text-area" data-scope="config-phase" data-id="${escapeHtml(phase.id)}" data-field="goal">${escapeHtml(phase.goal)}</textarea>
          </label>
        `)}

        ${renderConfigCards('milestones', '里程碑状态', '里程碑完成标准与当前状态会一起保存。', (milestone) => `
          <label class="field">
            <span>状态</span>
            <select class="select-input" data-scope="config-milestone" data-id="${escapeHtml(milestone.id)}" data-field="status">
              ${renderStatusOptions(milestone.status)}
            </select>
          </label>
          <label class="field full">
            <span>完成标准</span>
            <textarea class="text-area" data-scope="config-milestone" data-id="${escapeHtml(milestone.id)}" data-field="completion">${escapeHtml(milestone.completion)}</textarea>
          </label>
        `)}

        ${renderConfigCards('modules', '模块状态', '模块摘要会出现在自动生成的进度文档中。', (module) => `
          <label class="field">
            <span>状态</span>
            <select class="select-input" data-scope="config-module" data-id="${escapeHtml(module.id)}" data-field="status">
              ${renderStatusOptions(module.status)}
            </select>
          </label>
          <label class="field">
            <span>能力层</span>
            <input class="text-input" data-scope="config-module" data-id="${escapeHtml(module.id)}" data-field="capabilityLayer" value="${escapeHtml(module.capabilityLayer)}" />
          </label>
          <label class="field full">
            <span>模块说明</span>
            <textarea class="text-area" data-scope="config-module" data-id="${escapeHtml(module.id)}" data-field="summary">${escapeHtml(module.summary)}</textarea>
          </label>
        `)}
      </div>
    </section>
  `;
}

function renderEntityList(tabName, items, selectedId, addAction) {
  return `
    <section class="panel">
      <div class="toolbar">
        <div class="toolbar-group">
          <button class="button warning" type="button" data-action="${addAction}">新增</button>
        </div>
        <div class="toolbar-note">点击左边卡片进入详情编辑，保存时会整体写回对应 JSON 文件。</div>
      </div>
      <div class="two-column">
        <div class="entity-list">
          ${items.map((item) => `
            <article class="entity-card ${item.id === selectedId ? 'selected' : ''}">
              <button type="button" data-action="select-${tabName}" data-id="${escapeHtml(item.id)}">
                <div class="entity-card-top">
                  <div class="task-card-id">${escapeHtml(item.id)}</div>
                  <span class="pill ${tabName === 'risks' ? 'danger' : ''}">${escapeHtml(item.status ?? item.type ?? item.date)}</span>
                </div>
                <h3>${escapeHtml(item.title ?? item.debt ?? item.description ?? item.step ?? item.id)}</h3>
                <p>${escapeHtml(item.currentHandling ?? item.repaymentPlan ?? item.result ?? item.phaseMilestone ?? '')}</p>
              </button>
            </article>
          `).join('')}
        </div>
        <aside class="detail-shell">
          ${tabName === 'risks' ? renderRiskDetail() : ''}
          ${tabName === 'debts' ? renderDebtDetail() : ''}
          ${tabName === 'logs' ? renderLogDetail() : ''}
        </aside>
      </div>
    </section>
  `;
}

function renderRiskDetail() {
  const risk = getSelectedRisk();
  if (!risk) {
    return '<div class="detail-empty">还没有风险条目，或当前没有选中任何风险。</div>';
  }

  return `
    <div class="stack">
      <div class="section-card">
        <div class="section-card-head">
          <div>
            <h3>${escapeHtml(risk.id)}</h3>
            <h4>${escapeHtml(risk.type)}</h4>
          </div>
          <button class="button danger" type="button" data-action="delete-risk">删除风险</button>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>风险 ID</span>
            <input class="text-input mono" data-scope="risk" data-field="id" value="${escapeHtml(risk.id)}" />
          </label>
          <label class="field">
            <span>日期</span>
            <input class="text-input" data-scope="risk" data-field="date" value="${escapeHtml(risk.date)}" />
          </label>
          <label class="field">
            <span>类型</span>
            <input class="text-input" data-scope="risk" data-field="type" value="${escapeHtml(risk.type)}" />
          </label>
          <label class="field full">
            <span>描述</span>
            <textarea class="text-area" data-scope="risk" data-field="description">${escapeHtml(risk.description)}</textarea>
          </label>
          <label class="field full">
            <span>影响范围</span>
            <textarea class="text-area" data-scope="risk" data-field="impactScope">${escapeHtml(risk.impactScope)}</textarea>
          </label>
          <label class="field full">
            <span>当前处理</span>
            <textarea class="text-area" data-scope="risk" data-field="currentHandling">${escapeHtml(risk.currentHandling)}</textarea>
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderDebtDetail() {
  const debt = getSelectedDebt();
  if (!debt) {
    return '<div class="detail-empty">还没有技术债条目，或当前没有选中任何技术债。</div>';
  }

  return `
    <div class="stack">
      <div class="section-card">
        <div class="section-card-head">
          <div>
            <h3>${escapeHtml(debt.id)}</h3>
            <h4>${escapeHtml(debt.debt)}</h4>
          </div>
          <button class="button danger" type="button" data-action="delete-debt">删除技术债</button>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>技术债 ID</span>
            <input class="text-input mono" data-scope="debt" data-field="id" value="${escapeHtml(debt.id)}" />
          </label>
          <label class="field">
            <span>状态</span>
            <select class="select-input" data-scope="debt" data-field="status">
              ${renderStatusOptions(debt.status)}
            </select>
          </label>
          <label class="field full">
            <span>技术债描述</span>
            <textarea class="text-area" data-scope="debt" data-field="debt">${escapeHtml(debt.debt)}</textarea>
          </label>
          <label class="field">
            <span>来源阶段</span>
            <input class="text-input" data-scope="debt" data-field="sourcePhase" value="${escapeHtml(debt.sourcePhase)}" />
          </label>
          <label class="field full">
            <span>偿还计划</span>
            <textarea class="text-area" data-scope="debt" data-field="repaymentPlan">${escapeHtml(debt.repaymentPlan)}</textarea>
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderLogDetail() {
  const log = getSelectedLog();
  if (!log) {
    return '<div class="detail-empty">还没有日志条目，或当前没有选中任何日志。</div>';
  }

  return `
    <div class="stack">
      <div class="section-card">
        <div class="section-card-head">
          <div>
            <h3>${escapeHtml(log.id)}</h3>
            <h4>${escapeHtml(log.phaseMilestone)}</h4>
          </div>
          <button class="button danger" type="button" data-action="delete-log">删除日志</button>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>日志 ID</span>
            <input class="text-input mono" data-scope="log" data-field="id" value="${escapeHtml(log.id)}" />
          </label>
          <label class="field">
            <span>日期</span>
            <input class="text-input" data-scope="log" data-field="date" value="${escapeHtml(log.date)}" />
          </label>
          <label class="field full">
            <span>任务 ID 列表（每行一个）</span>
            <textarea class="text-area" data-scope="log-lines" data-field="taskIds">${escapeHtml(linesToTextarea(log.taskIds))}</textarea>
          </label>
          <label class="field full">
            <span>阶段 / 里程碑</span>
            <input class="text-input" data-scope="log" data-field="phaseMilestone" value="${escapeHtml(log.phaseMilestone)}" />
          </label>
          <label class="field full">
            <span>步骤</span>
            <textarea class="text-area" data-scope="log" data-field="step">${escapeHtml(log.step)}</textarea>
          </label>
          <label class="field">
            <span>动作</span>
            <input class="text-input" data-scope="log" data-field="action" value="${escapeHtml(log.action)}" />
          </label>
          <label class="field full">
            <span>结果</span>
            <textarea class="text-area" data-scope="log" data-field="result">${escapeHtml(log.result)}</textarea>
          </label>
          <label class="field full">
            <span>验证方式（每行一个）</span>
            <textarea class="text-area" data-scope="log-lines" data-field="verification">${escapeHtml(linesToTextarea(log.verification))}</textarea>
          </label>
          <label class="field full">
            <span>影响文件（每行一个）</span>
            <textarea class="text-area" data-scope="log-lines" data-field="affectedFiles">${escapeHtml(linesToTextarea(log.affectedFiles))}</textarea>
          </label>
          <label class="field full">
            <span>下一步</span>
            <textarea class="text-area" data-scope="log" data-field="next">${escapeHtml(log.next)}</textarea>
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderMainContent() {
  if (!state.data) {
    return `
      <section class="panel">
        <div class="detail-empty">暂时没有成功载入数据。可以点“重新载入”再试一次。</div>
      </section>
    `;
  }

  if (state.activeTab === 'tasks') {
    return renderTasksView();
  }

  if (state.activeTab === 'config') {
    return renderConfigView();
  }

  if (state.activeTab === 'risks') {
    return renderEntityList('risks', state.data.risks, state.selectedRiskId, 'add-risk');
  }

  if (state.activeTab === 'debts') {
    return renderEntityList('debts', state.data.techDebts, state.selectedDebtId, 'add-debt');
  }

  return renderEntityList('logs', state.data.logs, state.selectedLogId, 'add-log');
}

function render() {
  if (state.loading) {
    appElement.innerHTML = `
      <div class="loading-shell">
        <div class="loading-card">
          <h1>正在载入独立进度看板</h1>
          <p>正在读取 progress/ 真相源，并准备任务、风险、技术债和日志数据。</p>
          <div class="loading-bar"></div>
        </div>
      </div>
    `;
    return;
  }

  const allTasks = getAllTasks();
  const currentPhase = getCurrentPhase();
  const currentMilestone = getCurrentMilestone();
  const inProgressCount = allTasks.filter((task) => task.status === '进行中').length;
  const blockedCount = allTasks.filter((task) => task.status === '阻塞' || task.status === '暂缓').length;
  const latestLog = state.data?.logs?.at(-1);

  appElement.innerHTML = `
    <div class="board-app">
      <section class="hero">
        <div class="hero-top">
          <div class="hero-copy">
            <div class="hero-mark">PB</div>
            <h1>LAYOUT3.0 独立进度看板</h1>
            <p>这是和主项目界面分开的本地进度工作台。你在这里改的内容，会直接写回 progress/ 真相源，并自动重建 Markdown 展示文档。</p>
            <small>当前根目录：${escapeHtml(state.data?.rootDir ?? '')}</small>
          </div>
          <div class="hero-actions">
            <button class="button" type="button" data-action="reload">重新载入</button>
            <button class="button primary" type="button" data-action="save" ${state.saving ? 'disabled' : ''}>
              ${state.saving ? '保存中...' : state.dirty ? '保存并重建文档' : '保存'}
            </button>
          </div>
        </div>
        <div class="summary-grid">
          <article class="summary-card">
            <span>当前阶段</span>
            <strong>${escapeHtml(currentPhase?.label ?? '未识别')}</strong>
            <em>当前状态：${escapeHtml(currentPhase?.status ?? '未知')}</em>
          </article>
          <article class="summary-card">
            <span>当前里程碑</span>
            <strong>${escapeHtml(currentMilestone?.label ?? '未识别')}</strong>
            <em>当前状态：${escapeHtml(currentMilestone?.status ?? '未知')}</em>
          </article>
          <article class="summary-card">
            <span>任务进展</span>
            <strong>${inProgressCount} 个进行中 / ${blockedCount} 个阻塞或暂缓</strong>
            <em>共 ${allTasks.length} 个任务卡已载入看板。</em>
          </article>
          <article class="summary-card">
            <span>最近一条日志</span>
            <strong>${escapeHtml(latestLog?.id ?? '暂无')}</strong>
            <em>${escapeHtml(latestLog?.step ?? '保存后会继续围绕真相源更新。')}</em>
          </article>
        </div>
      </section>

      <div class="layout">
        <aside class="sidebar">
          <h2>工作区导航</h2>
          <button class="nav-button ${state.activeTab === 'tasks' ? 'active' : ''}" type="button" data-tab="tasks">
            <strong>任务看板</strong>
            <span>按状态分列查看任务，并编辑任务详情和执行边界。</span>
          </button>
          <button class="nav-button ${state.activeTab === 'config' ? 'active' : ''}" type="button" data-tab="config">
            <strong>项目设置</strong>
            <span>调整阶段、里程碑、模块状态与说明。</span>
          </button>
          <button class="nav-button ${state.activeTab === 'risks' ? 'active' : ''}" type="button" data-tab="risks">
            <strong>风险</strong>
            <span>维护阻塞、范围变化与当前处理方式。</span>
          </button>
          <button class="nav-button ${state.activeTab === 'debts' ? 'active' : ''}" type="button" data-tab="debts">
            <strong>技术债</strong>
            <span>维护待偿还问题与补偿计划。</span>
          </button>
          <button class="nav-button ${state.activeTab === 'logs' ? 'active' : ''}" type="button" data-tab="logs">
            <strong>进度日志</strong>
            <span>补充完成步骤、验证方式、影响文件和下一步。</span>
          </button>
        </aside>

        <main class="main">
          ${state.message ? `<div class="message ${escapeHtml(state.message.type)}">${escapeHtml(state.message.text)}</div>` : ''}
          ${renderMainContent()}
          <div class="footer-note">
            当前保存策略：先写回 progress/ JSON 真相源，再自动执行 scripts/generate-progress.mjs 与 --check。<br />
            如果外部刚改过 JSON，这里会拒绝覆盖，并提示你先重新载入。
          </div>
        </main>
      </div>
    </div>
  `;
}

appElement.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action], [data-tab]');
  if (!target) {
    return;
  }

  if (target.dataset.tab) {
    selectTab(target.dataset.tab);
    return;
  }

  const action = target.dataset.action;
  if (action === 'reload') {
    loadBoardData('已重新载入最新真相源。');
    return;
  }

  if (action === 'save') {
    saveBoardData();
    return;
  }

  if (action === 'select-task') {
    state.selectedTaskKey = buildTaskKey(target.dataset.phaseId, target.dataset.taskId);
    render();
    return;
  }

  if (action === 'add-task') {
    createBlankTask();
    return;
  }

  if (action === 'delete-task') {
    deleteSelectedTask();
    return;
  }

  if (action === 'select-risks') {
    state.selectedRiskId = target.dataset.id;
    render();
    return;
  }

  if (action === 'add-risk') {
    createBlankRisk();
    return;
  }

  if (action === 'delete-risk') {
    deleteSelectedRisk();
    return;
  }

  if (action === 'select-debts') {
    state.selectedDebtId = target.dataset.id;
    render();
    return;
  }

  if (action === 'add-debt') {
    createBlankDebt();
    return;
  }

  if (action === 'delete-debt') {
    deleteSelectedDebt();
    return;
  }

  if (action === 'select-logs') {
    state.selectedLogId = target.dataset.id;
    render();
    return;
  }

  if (action === 'add-log') {
    createBlankLog();
    return;
  }

  if (action === 'delete-log') {
    deleteSelectedLog();
  }
});

appElement.addEventListener('change', (event) => {
  const target = event.target;

  if (target.dataset.action === 'task-quick-status') {
    const taskFile = state.data.taskFiles.find((item) => item.phaseId === target.dataset.phaseId);
    const task = taskFile?.tasks.find((item) => item.id === target.dataset.taskId);
    if (task) {
      task.status = target.value;
      setDirty();
      render();
    }
    return;
  }

  if (target.dataset.action === 'filter-phase') {
    state.filterPhaseId = target.value;
    const preferredTask = choosePreferredTask(target.value);
    if (preferredTask) {
      state.selectedTaskKey = buildTaskKey(preferredTask.phaseId, preferredTask.id);
    }
    render();
    return;
  }

  if (target.dataset.action === 'toggle-task-module') {
    toggleSelectedTaskArray('moduleIds', target.dataset.moduleId, target.checked);
    render();
    return;
  }

  if (target.dataset.action === 'toggle-task-milestone') {
    toggleSelectedTaskArray('milestoneIds', target.dataset.milestoneId, target.checked);
    render();
    return;
  }

  if (target.dataset.scope === 'task') {
    updateSelectedTaskField(target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'task-boundary') {
    updateSelectedTaskBoundary(target.dataset.field, target.type === 'checkbox' ? target.checked : target.value, false, target.type === 'checkbox');
    return;
  }

  if (target.dataset.scope === 'task-boundary-lines') {
    updateSelectedTaskBoundary(target.dataset.field, target.value, true, false);
    return;
  }

  if (target.dataset.scope === 'risk') {
    updateEntityField('risks', 'selectedRiskId', target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'debt') {
    updateEntityField('techDebts', 'selectedDebtId', target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'log') {
    updateEntityField('logs', 'selectedLogId', target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'log-lines') {
    updateEntityField('logs', 'selectedLogId', target.dataset.field, target.value, true);
    return;
  }

  if (target.dataset.scope === 'config-phase') {
    updateConfigEntity('phases', target.dataset.id, target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'config-milestone') {
    updateConfigEntity('milestones', target.dataset.id, target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'config-module') {
    updateConfigEntity('modules', target.dataset.id, target.dataset.field, target.value);
  }
});

appElement.addEventListener('input', (event) => {
  const target = event.target;

  if (target.dataset.action === 'filter-query') {
    state.filterQuery = target.value;
    render();
    return;
  }

  if (target.dataset.scope === 'task') {
    updateSelectedTaskField(target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'task-boundary') {
    updateSelectedTaskBoundary(target.dataset.field, target.type === 'checkbox' ? target.checked : target.value, false, target.type === 'checkbox');
    return;
  }

  if (target.dataset.scope === 'task-boundary-lines') {
    updateSelectedTaskBoundary(target.dataset.field, target.value, true, false);
    return;
  }

  if (target.dataset.scope === 'risk') {
    updateEntityField('risks', 'selectedRiskId', target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'debt') {
    updateEntityField('techDebts', 'selectedDebtId', target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'log') {
    updateEntityField('logs', 'selectedLogId', target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'log-lines') {
    updateEntityField('logs', 'selectedLogId', target.dataset.field, target.value, true);
    return;
  }

  if (target.dataset.scope === 'config-phase') {
    updateConfigEntity('phases', target.dataset.id, target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'config-milestone') {
    updateConfigEntity('milestones', target.dataset.id, target.dataset.field, target.value);
    return;
  }

  if (target.dataset.scope === 'config-module') {
    updateConfigEntity('modules', target.dataset.id, target.dataset.field, target.value);
  }
});

loadBoardData();
