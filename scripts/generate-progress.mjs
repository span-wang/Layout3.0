import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const progressDir = path.join(rootDir, 'progress');
const tasksDir = path.join(progressDir, 'tasks');

// 统一把 Markdown 表格中的特殊字符转义掉，避免生成后的表格错位。
function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function normalizeContent(value) {
  return value.replace(/\r\n/g, '\n');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loadTaskFiles() {
  const names = (await fs.readdir(tasksDir))
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));

  const phaseTaskFiles = [];
  for (const name of names) {
    phaseTaskFiles.push(await readJson(path.join(tasksDir, name)));
  }

  return phaseTaskFiles;
}

function renderTable(headers, rows) {
  const headerRow = `| ${headers.map(escapeCell).join(' | ')} |`;
  const dividerRow = `|${headers.map(() => '---').join('|')}|`;
  const bodyRows = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`);
  return [headerRow, dividerRow, ...bodyRows].join('\n');
}

function renderOrderedList(items) {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function joinCodeList(items) {
  return items.map((item) => `\`${item}\``).join('、');
}

function renderTaskBoundarySection(task) {
  const boundary = task.executionBoundary;
  if (!boundary?.confirmed) {
    return [];
  }

  const lines = [
    `### \`${task.id}\` ${task.title}`,
    '',
    `- 状态：${boundary.statusLabel ?? '已确认边界'}`,
  ];

  if (boundary.summary) {
    lines.push(`- 边界摘要：${boundary.summary}`);
  }

  if (Array.isArray(boundary.inScope) && boundary.inScope.length > 0) {
    lines.push('- 本步纳入：');
    lines.push(...boundary.inScope.map((item) => `  - ${item}`));
  }

  if (Array.isArray(boundary.interactionRules) && boundary.interactionRules.length > 0) {
    lines.push('- 交互规则：');
    lines.push(...boundary.interactionRules.map((item) => `  - ${item}`));
  }

  if (Array.isArray(boundary.writebackRules) && boundary.writebackRules.length > 0) {
    lines.push('- 数据写回规则：');
    lines.push(...boundary.writebackRules.map((item) => `  - ${item}`));
  }

  if (Array.isArray(boundary.consistencyRules) && boundary.consistencyRules.length > 0) {
    lines.push('- 显示一致性：');
    lines.push(...boundary.consistencyRules.map((item) => `  - ${item}`));
  }

  if (Array.isArray(boundary.outOfScope) && boundary.outOfScope.length > 0) {
    lines.push('- 本步明确不纳入：');
    lines.push(...boundary.outOfScope.map((item) => `  - ${item}`));
  }

  if (Array.isArray(boundary.deferredTo) && boundary.deferredTo.length > 0) {
    lines.push('- 后续归属任务：');
    lines.push(...boundary.deferredTo.map((item) => `  - ${item}`));
  }

  lines.push('');
  return lines;
}

function priorityRank(priority) {
  const matches = [...priority.matchAll(/P(\d)/g)];
  if (matches.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(...matches.map((match) => Number(match[1])));
}

function statusSortRank(status) {
  const rankMap = {
    '进行中': 0,
    '阻塞': 1,
    '未开始': 2,
    '暂缓': 3,
    '已完成': 4,
  };

  return rankMap[status] ?? 99;
}

function findCurrentPhase(phases) {
  return phases.find((phase) => phase.status !== '已完成') ?? phases.at(-1);
}

function findCurrentMilestone(milestones) {
  return milestones.find((milestone) => milestone.status === '进行中')
    ?? milestones.find((milestone) => milestone.status !== '已完成')
    ?? milestones.at(-1);
}

function summarizePhaseStatus(tasks) {
  if (tasks.length === 0) {
    return '未开始';
  }

  if (tasks.every((task) => task.status === '已完成')) {
    return '已完成';
  }

  if (tasks.every((task) => task.status === '未开始')) {
    return '未开始';
  }

  if (tasks.every((task) => task.status === '暂缓')) {
    return '暂缓';
  }

  if (tasks.some((task) => task.status === '阻塞')) {
    return '阻塞';
  }

  return '进行中';
}

function summarizeMilestoneStatus(tasks) {
  if (tasks.length === 0 || tasks.every((task) => task.status === '未开始')) {
    return '未开始';
  }

  if (tasks.every((task) => task.status === '已完成')) {
    return '已完成';
  }

  if (tasks.some((task) => task.status === '阻塞')) {
    return '阻塞';
  }

  if (tasks.every((task) => task.status === '暂缓')) {
    return '暂缓';
  }

  return '进行中';
}

function isStandaloneLogTaskId(taskId) {
  return taskId.startsWith('GOV-') || taskId.startsWith('DOC-') || taskId.startsWith('OPS-');
}

function buildProgressDocument({
  config,
  phaseTaskMap,
  allTasks,
  risks,
  techDebts,
  logs,
}) {
  const currentPhase = findCurrentPhase(config.phases);
  const currentMilestone = findCurrentMilestone(config.milestones);
  const activePhaseTasks = phaseTaskMap.get(currentPhase.id) ?? [];
  const inProgressTasks = allTasks
    .filter((task) => task.status === '进行中')
    .sort((left, right) => left.order - right.order);
  const nextTasks = activePhaseTasks
    .filter((task) => task.status !== '已完成' && task.status !== '暂缓')
    .sort((left, right) => {
      const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return left.order - right.order;
    })
    .slice(0, 3);
  const confirmedBoundaryTasks = activePhaseTasks
    .filter((task) => task.executionBoundary?.confirmed && task.status === '未开始')
    .sort((left, right) => left.order - right.order);
  const blockedOrPausedTasks = allTasks
    .filter((task) => task.status === '阻塞' || task.status === '暂缓')
    .sort((left, right) => left.order - right.order);
  const recentLogs = [...logs].slice(-5).reverse();

  const sections = [
    '# 项目开发进度',
    '',
    '> 本文件由 `progress/config.json`、`progress/tasks/*.json`、`progress/risks.json`、`progress/tech-debts.json`、`progress/logs.json` 自动生成。',
    '>',
    '> 请不要直接手改本文件；手改内容会在下次执行 `npm run progress:build` 时被覆盖。',
    '',
    '## 1. 文档目的',
    '',
    '本文件用于跟踪 `LAYOUT3.0` 的实际开发推进情况，统一记录阶段目标、当前状态、里程碑达成情况、风险与阻塞，以及每一步完成后的变更日志。',
    '',
    '进度跟踪以以下文档为唯一业务基线：',
    '',
    ...config.baselineDocuments.map((document) => `- \`${document}\``),
    '',
    '结构化进度源以 `progress/` 目录中的 JSON 文件为唯一真相源；若需求、技术方案、阶段规划发生变更，应先更新基线文档，再更新结构化进度源并重新生成本文件。',
    '',
    '## 2. 跟踪原则',
    '',
    renderOrderedList(config.trackingPrinciples),
    '',
    '## 3. 进度单位定义',
    '',
    '“推进一步进度”定义为一次可以独立验收的最小开发推进，至少满足以下条件：',
    '',
    ...config.stepCompletionRequirements.map((item) => `- ${item}`),
    '',
    '符合以下情况时，才可以写入“已完成”：',
    '',
    ...config.completedExamples.map((item) => `- ${item}`),
    '',
    '以下情况不计为完成一步：',
    '',
    ...config.nonCompletionExamples.map((item) => `- ${item}`),
    '',
    '## 4. 状态定义',
    '',
    renderTable(
      ['状态', '含义', '使用规则'],
      config.statusDefinitions.map((item) => [`\`${item.status}\``, item.meaning, item.rule]),
    ),
    '',
    '## 5. 跟踪维度',
    '',
    '### 5.1 阶段维度',
    '',
    renderTable(
      ['阶段', '目标', '计划周期', '当前状态'],
      config.phases.map((phase) => [phase.label, phase.goal, phase.plannedCycle, `\`${phase.status}\``]),
    ),
    '',
    '### 5.2 里程碑维度',
    '',
    renderTable(
      ['里程碑', '完成标准', '当前状态'],
      config.milestones.map((milestone) => [milestone.label, milestone.completion, `\`${milestone.status}\``]),
    ),
    '',
    '### 5.3 模块维度',
    '',
    renderTable(
      ['模块', '对应能力层', '当前状态', '说明'],
      config.modules.map((module) => [module.name, module.capabilityLayer, `\`${module.status}\``, module.summary]),
    ),
    '',
    '### 5.4 优先级维度',
    '',
    renderTable(
      ['优先级', '范围', '跟踪要求'],
      config.priorities.map((priority) => [`\`${priority.level}\``, priority.scope, priority.trackingRule]),
    ),
    '',
    '## 6. 当前执行快照',
    '',
    renderTable(
      ['当前阶段', '当前里程碑', '进行中任务数', '建议下一步', '阻塞/暂缓任务数'],
      [[
        `${currentPhase.label}（\`${currentPhase.status}\`）`,
        `${currentMilestone.label}（\`${currentMilestone.status}\`）`,
        String(inProgressTasks.length),
        nextTasks.length > 0 ? nextTasks.map((task) => `\`${task.id}\` ${task.title}`).join('；') : '暂无待推进任务',
        String(blockedOrPausedTasks.length),
      ]],
    ),
    '',
    '当前结构化源更新检查清单：',
    '',
    renderOrderedList(config.updateChecklist),
    '',
    inProgressTasks.length > 0
      ? `当前标记为 \`进行中\` 的任务：${inProgressTasks.map((task) => `\`${task.id}\` ${task.title}`).join('；')}`
      : '当前没有显式标记为 `进行中` 的任务；说明本轮开发正处于“等待确认下一步”或“已完成当前小步、待启动下一步”的状态。',
    '',
    blockedOrPausedTasks.length > 0
      ? `当前阻塞或暂缓任务：${blockedOrPausedTasks.map((task) => `\`${task.id}\` ${task.title}（${task.status}）`).join('；')}`
      : '当前没有阻塞或暂缓任务。',
    '',
    '当前已确认边界的待开发任务：',
    '',
    ...(confirmedBoundaryTasks.length > 0
      ? confirmedBoundaryTasks.flatMap((task) => renderTaskBoundarySection(task))
      : ['当前没有已写回边界的待开发任务。', '']),
    '最近完成的 5 条进度记录：',
    '',
    renderTable(
      ['日期', '任务 ID', '步骤', '动作', '结果'],
      recentLogs.map((log) => [log.date, log.taskIds.join(' / '), log.step, log.action, log.result]),
    ),
    '',
    '## 7. 当前阶段拆解',
    '',
    '以下拆解来自 `progress/tasks/` 目录中的任务卡，后续每完成一步都在结构化源和进度日志中同步更新。',
    '',
  ];

  for (const phase of config.phases) {
    const phaseTasks = [...(phaseTaskMap.get(phase.id) ?? [])].sort((left, right) => left.order - right.order);
    sections.push(`### ${phase.label}`);
    sections.push('');
    sections.push(
      renderTable(
        ['任务 ID', '序号', '步骤', '优先级', '对应模块', '当前状态', '完成标准'],
        phaseTasks.map((task) => [
          `\`${task.id}\``,
          task.sequence,
          task.title,
          `\`${task.priority}\``,
          task.moduleIds.map((moduleId) => {
            const module = config.modules.find((item) => item.id === moduleId);
            return module ? module.name : moduleId;
          }).join(' / '),
          `\`${task.status}\``,
          task.acceptance,
        ]),
      ),
    );
    sections.push('');
  }

  sections.push('## 8. 风险与阻塞跟踪');
  sections.push('');
  sections.push(
    renderTable(
      ['日期', '类型', '描述', '影响范围', '当前处理'],
      risks.map((risk) => [risk.date, risk.type, risk.description, risk.impactScope, risk.currentHandling]),
    ),
  );
  sections.push('');
  sections.push('## 9. 技术债务跟踪');
  sections.push('');
  sections.push(
    renderTable(
      ['技术债务', '来源阶段', '当前状态', '偿还计划'],
      techDebts.map((debt) => [debt.debt, debt.sourcePhase, `\`${debt.status}\``, debt.repaymentPlan]),
    ),
  );
  sections.push('');
  sections.push('## 10. 进度日志');
  sections.push('');
  sections.push(
    renderTable(
      ['日期', '任务 ID', '阶段/里程碑', '步骤', '动作', '结果', '验证方式', '影响文件', '下一步'],
      logs.map((log) => [
        log.date,
        log.taskIds.join(' / '),
        log.phaseMilestone,
        log.step,
        log.action,
        log.result,
        log.verification.join('；'),
        joinCodeList(log.affectedFiles),
        log.next,
      ]),
    ),
  );
  sections.push('');
  sections.push('## 11. 维护说明');
  sections.push('');
  sections.push('- 手工维护入口：`progress/config.json`、`progress/tasks/*.json`、`progress/risks.json`、`progress/tech-debts.json`、`progress/logs.json`。');
  sections.push('- 自动生成产物：`项目开发进度.md`、`当前执行看板.md`。');
  sections.push('- 每次确认并完成一个可独立验收的小步后，必须先更新结构化源，再执行 `npm run progress:build`。');
  sections.push('- 若需校验生成产物是否与结构化源一致，执行 `npm run progress:check`。');

  return `${sections.join('\n')}\n`;
}

function buildBoardDocument({
  config,
  phaseTaskMap,
  allTasks,
  risks,
  logs,
}) {
  const currentPhase = findCurrentPhase(config.phases);
  const currentMilestone = findCurrentMilestone(config.milestones);
  const activePhaseTasks = phaseTaskMap.get(currentPhase.id) ?? [];
  const inProgressTasks = allTasks
    .filter((task) => task.status === '进行中')
    .sort((left, right) => left.order - right.order);
  const nextTasks = activePhaseTasks
    .filter((task) => task.status !== '已完成' && task.status !== '暂缓' && !task.executionBoundary?.confirmed)
    .sort((left, right) => {
      const byPriority = priorityRank(left.priority) - priorityRank(right.priority);
      if (byPriority !== 0) {
        return byPriority;
      }

      return left.order - right.order;
    })
    .slice(0, 3);
  const confirmedBoundaryTasks = activePhaseTasks
    .filter((task) => task.executionBoundary?.confirmed && task.status === '未开始')
    .sort((left, right) => left.order - right.order);
  const pausedTasks = activePhaseTasks
    .filter((task) => task.status === '暂缓' || task.status === '阻塞')
    .sort((left, right) => left.order - right.order);
  const recentLogs = [...logs].slice(-8).reverse();
  const recentRisks = [...risks].slice(-3).reverse();

  const sections = [
    '# 当前执行看板',
    '',
    '> 本文件由 `npm run progress:build` 自动生成，请不要直接手改。',
    '',
    '## 当前焦点',
    '',
    renderTable(
      ['项目当前阶段', '当前里程碑', '当前状态'],
      [[currentPhase.label, currentMilestone.label, `${currentPhase.status} / ${currentMilestone.status}`]],
    ),
    '',
    '## 正在进行',
    '',
    inProgressTasks.length > 0
      ? renderTable(
        ['任务 ID', '步骤', '优先级', '状态', '完成标准'],
        inProgressTasks.map((task) => [`\`${task.id}\``, task.title, `\`${task.priority}\``, `\`${task.status}\``, task.acceptance]),
      )
      : '当前没有显式标记为 `进行中` 的任务。',
    '',
    '## 待确认的下一步',
    '',
    nextTasks.length > 0
      ? renderTable(
        ['任务 ID', '步骤', '优先级', '当前状态', '说明'],
        nextTasks.map((task) => [`\`${task.id}\``, task.title, `\`${task.priority}\``, `\`${task.status}\``, '按 AGENTS 约定，开始改代码前仍需先确认该任务的执行方案与细节。']),
      )
      : '当前阶段没有可继续推进的开放任务。',
    '',
    '## 已确认边界，待开始',
    '',
    ...(confirmedBoundaryTasks.length > 0
      ? confirmedBoundaryTasks.flatMap((task) => renderTaskBoundarySection(task))
      : ['当前没有已确认边界的待开发任务。']),
    '',
    '## 暂缓与阻塞',
    '',
    pausedTasks.length > 0
      ? renderTable(
        ['任务 ID', '步骤', '状态', '完成标准'],
        pausedTasks.map((task) => [`\`${task.id}\``, task.title, `\`${task.status}\``, task.acceptance]),
      )
      : '当前阶段没有标记为 `暂缓` 或 `阻塞` 的任务。',
    '',
    '## 最近风险',
    '',
    renderTable(
      ['日期', '类型', '描述', '当前处理'],
      recentRisks.map((risk) => [risk.date, risk.type, risk.description, risk.currentHandling]),
    ),
    '',
    '## 最近进度日志',
    '',
    renderTable(
      ['日期', '任务 ID', '步骤', '动作', '下一步'],
      recentLogs.map((log) => [log.date, log.taskIds.join(' / '), log.step, log.action, log.next]),
    ),
    '',
    '## 使用规则',
    '',
    '- 真相源在 `progress/` 目录，不在本文件。',
    '- 完成一步后，先更新任务卡、风险或日志，再执行 `npm run progress:build`。',
    '- 提交前可执行 `npm run progress:check`，确保生成文件没有漏更新。',
  ];

  return `${sections.join('\n')}\n`;
}

function validateData({ config, phaseTaskFiles, allTasks, risks, techDebts, logs }) {
  const allowedStatuses = new Set(config.statusDefinitions.map((item) => item.status));
  const phaseIds = new Set(config.phases.map((phase) => phase.id));
  const moduleIds = new Set(config.modules.map((module) => module.id));
  const milestoneIds = new Set(config.milestones.map((milestone) => milestone.id));
  const taskMap = new Map();
  const logMap = new Map();

  for (const phase of config.phases) {
    assert(allowedStatuses.has(phase.status), `阶段状态非法：${phase.label} -> ${phase.status}`);
  }

  for (const milestone of config.milestones) {
    assert(allowedStatuses.has(milestone.status), `里程碑状态非法：${milestone.id} -> ${milestone.status}`);
  }

  for (const module of config.modules) {
    assert(allowedStatuses.has(module.status), `模块状态非法：${module.name} -> ${module.status}`);
  }

  assert(phaseTaskFiles.length === config.phases.length, '任务文件数量必须与阶段数量一致。');

  for (const phaseTaskFile of phaseTaskFiles) {
    assert(phaseIds.has(phaseTaskFile.phaseId), `未知阶段任务文件：${phaseTaskFile.phaseId}`);
    for (const task of phaseTaskFile.tasks) {
      assert(!taskMap.has(task.id), `重复的任务 ID：${task.id}`);
      assert(allowedStatuses.has(task.status), `任务状态非法：${task.id} -> ${task.status}`);
      assert(Array.isArray(task.moduleIds) && task.moduleIds.length > 0, `任务缺少模块：${task.id}`);
      assert(Array.isArray(task.milestoneIds) && task.milestoneIds.length > 0, `任务缺少里程碑：${task.id}`);
      task.moduleIds.forEach((moduleId) => assert(moduleIds.has(moduleId), `任务引用未知模块：${task.id} -> ${moduleId}`));
      task.milestoneIds.forEach((milestoneId) => assert(milestoneIds.has(milestoneId), `任务引用未知里程碑：${task.id} -> ${milestoneId}`));
      taskMap.set(task.id, task);
    }
  }

  for (const log of logs) {
    assert(!logMap.has(log.id), `重复的日志 ID：${log.id}`);
    assert(Array.isArray(log.taskIds) && log.taskIds.length > 0, `日志缺少任务 ID：${log.id}`);
    assert(Array.isArray(log.verification) && log.verification.length > 0, `日志缺少验证方式：${log.id}`);
    assert(Array.isArray(log.affectedFiles) && log.affectedFiles.length > 0, `日志缺少影响文件：${log.id}`);
    for (const taskId of log.taskIds) {
      assert(taskMap.has(taskId) || isStandaloneLogTaskId(taskId), `日志引用未知任务 ID：${log.id} -> ${taskId}`);
    }
    logMap.set(log.id, log);
  }

  for (const task of allTasks) {
    if (task.status === '已完成' || task.status === '进行中') {
      const hasLog = logs.some((log) => log.taskIds.includes(task.id));
      assert(hasLog, `任务缺少日志记录：${task.id}`);
    }
  }

  for (const phase of config.phases) {
    const phaseTasks = allTasks.filter((task) => task.phaseId === phase.id);
    const expectedStatus = summarizePhaseStatus(phaseTasks);
    if (phase.status === '未开始') {
      assert(expectedStatus === '未开始', `阶段状态与任务状态不一致：${phase.label}`);
    }
    if (phase.status === '已完成') {
      assert(expectedStatus === '已完成', `阶段状态与任务状态不一致：${phase.label}`);
    }
  }

  for (const milestone of config.milestones) {
    const milestoneTasks = allTasks.filter((task) => task.milestoneIds.includes(milestone.id));
    const expectedStatus = summarizeMilestoneStatus(milestoneTasks);
    if (milestone.status === '未开始') {
      assert(expectedStatus === '未开始', `里程碑状态与任务状态不一致：${milestone.id}`);
    }
    if (milestone.status === '已完成') {
      assert(expectedStatus === '已完成', `里程碑状态与任务状态不一致：${milestone.id}`);
    }
  }

  for (const risk of risks) {
    assert(risk.id, '风险条目缺少 ID。');
  }

  for (const debt of techDebts) {
    assert(debt.id, '技术债务条目缺少 ID。');
    assert(allowedStatuses.has(debt.status), `技术债务状态非法：${debt.id} -> ${debt.status}`);
  }
}

async function writeOrCheckFile(targetPath, content, checkOnly) {
  if (checkOnly) {
    const current = await fs.readFile(targetPath, 'utf8').catch(() => '');
    if (normalizeContent(current) !== normalizeContent(content)) {
      throw new Error(`生成产物未同步：${path.relative(rootDir, targetPath)}，请先执行 npm run progress:build`);
    }
    return;
  }

  await fs.writeFile(targetPath, content, 'utf8');
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const config = await readJson(path.join(progressDir, 'config.json'));
  const phaseTaskFiles = await loadTaskFiles();
  const risks = (await readJson(path.join(progressDir, 'risks.json'))).items;
  const techDebts = (await readJson(path.join(progressDir, 'tech-debts.json'))).items;
  const logs = (await readJson(path.join(progressDir, 'logs.json'))).entries;

  const allTasks = [];
  const phaseTaskMap = new Map();
  for (const phaseTaskFile of phaseTaskFiles) {
    const tasks = phaseTaskFile.tasks.map((task) => ({
      ...task,
      phaseId: phaseTaskFile.phaseId,
    }));
    phaseTaskMap.set(phaseTaskFile.phaseId, tasks);
    allTasks.push(...tasks);
  }

  validateData({ config, phaseTaskFiles, allTasks, risks, techDebts, logs });

  const progressDocument = buildProgressDocument({
    config,
    phaseTaskMap,
    allTasks,
    risks,
    techDebts,
    logs,
  });
  const boardDocument = buildBoardDocument({
    config,
    phaseTaskMap,
    allTasks,
    risks,
    logs,
  });

  const progressDocumentPath = path.join(rootDir, config.generatedFiles.progressDocument);
  const boardDocumentPath = path.join(rootDir, config.generatedFiles.boardDocument);

  await writeOrCheckFile(progressDocumentPath, progressDocument, checkOnly);
  await writeOrCheckFile(boardDocumentPath, boardDocument, checkOnly);

  if (!checkOnly) {
    process.stdout.write('进度文档已生成。\n');
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
  process.exit(1);
});
