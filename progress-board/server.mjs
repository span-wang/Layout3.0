import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const boardDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(boardDir, '..');
const progressDir = path.join(rootDir, 'progress');
const tasksDir = path.join(progressDir, 'tasks');
const publicDir = path.join(boardDir, 'public');
const port = Number(process.env.PROGRESS_BOARD_PORT ?? 5070);

const mimeMap = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(message);
}

function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('请求体不是合法 JSON。'));
      }
    });
    request.on('error', reject);
  });
}

async function readJsonWithRaw(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return {
    raw,
    data: JSON.parse(raw),
  };
}

function createRevision(rawSegments) {
  return createHash('sha1')
    .update(rawSegments.join('\n===progress-board===\n'))
    .digest('hex');
}

async function loadBoardSnapshot() {
  const configEntry = await readJsonWithRaw(path.join(progressDir, 'config.json'));
  const riskEntry = await readJsonWithRaw(path.join(progressDir, 'risks.json'));
  const debtEntry = await readJsonWithRaw(path.join(progressDir, 'tech-debts.json'));
  const logEntry = await readJsonWithRaw(path.join(progressDir, 'logs.json'));
  const taskFileNames = (await fs.readdir(tasksDir))
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));

  const taskFiles = [];
  const rawSegments = [configEntry.raw, riskEntry.raw, debtEntry.raw, logEntry.raw];
  for (const fileName of taskFileNames) {
    const taskEntry = await readJsonWithRaw(path.join(tasksDir, fileName));
    taskFiles.push({
      fileName,
      ...taskEntry.data,
    });
    rawSegments.push(taskEntry.raw);
  }

  return {
    revision: createRevision(rawSegments),
    rootDir,
    config: configEntry.data,
    taskFiles,
    risks: riskEntry.data.items,
    techDebts: debtEntry.data.items,
    logs: logEntry.data.entries,
    rawFiles: {
      config: configEntry.raw,
      risks: riskEntry.raw,
      techDebts: debtEntry.raw,
      logs: logEntry.raw,
      taskFiles: taskFiles.map((taskFile, index) => ({
        fileName: taskFile.fileName,
        phaseId: taskFile.phaseId,
        raw: rawSegments[index + 4],
      })),
    },
  };
}

function toClientSnapshot(snapshot) {
  return {
    revision: snapshot.revision,
    rootDir: snapshot.rootDir,
    config: snapshot.config,
    taskFiles: snapshot.taskFiles,
    risks: snapshot.risks,
    techDebts: snapshot.techDebts,
    logs: snapshot.logs,
  };
}

function normalizeJsonContent(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateIncomingPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, '保存数据不能为空。');
  }

  if (!payload.config || !Array.isArray(payload.taskFiles)) {
    throw createHttpError(400, '缺少配置或任务文件数据。');
  }

  if (!Array.isArray(payload.risks) || !Array.isArray(payload.techDebts) || !Array.isArray(payload.logs)) {
    throw createHttpError(400, '风险、技术债或日志数据格式不正确。');
  }
}

async function runProgressBuild() {
  const scriptPath = path.join(rootDir, 'scripts', 'generate-progress.mjs');

  await execFileAsync(process.execPath, [scriptPath], { cwd: rootDir });
  await execFileAsync(process.execPath, [scriptPath, '--check'], { cwd: rootDir });
}

async function restoreSnapshot(rawFiles) {
  await fs.writeFile(path.join(progressDir, 'config.json'), rawFiles.config, 'utf8');
  await fs.writeFile(path.join(progressDir, 'risks.json'), rawFiles.risks, 'utf8');
  await fs.writeFile(path.join(progressDir, 'tech-debts.json'), rawFiles.techDebts, 'utf8');
  await fs.writeFile(path.join(progressDir, 'logs.json'), rawFiles.logs, 'utf8');

  for (const taskFile of rawFiles.taskFiles) {
    await fs.writeFile(path.join(tasksDir, taskFile.fileName), taskFile.raw, 'utf8');
  }
}

async function saveBoardPayload(payload) {
  validateIncomingPayload(payload);

  const currentSnapshot = await loadBoardSnapshot();
  if (payload.revision !== currentSnapshot.revision) {
    throw createHttpError(409, '真相源已被外部改动，请先点“重新载入”再保存，避免覆盖最新内容。');
  }

  const currentTaskFileMap = new Map(
    currentSnapshot.taskFiles.map((taskFile) => [taskFile.phaseId, taskFile.fileName]),
  );
  const incomingTaskFileMap = new Map(payload.taskFiles.map((taskFile) => [taskFile.phaseId, taskFile]));

  if (incomingTaskFileMap.size !== currentTaskFileMap.size) {
    throw createHttpError(400, '任务文件数量与当前真相源不一致。');
  }

  for (const phaseId of incomingTaskFileMap.keys()) {
    if (!currentTaskFileMap.has(phaseId)) {
      throw createHttpError(400, `存在未知阶段任务文件：${phaseId}`);
    }
  }

  const writes = [
    {
      filePath: path.join(progressDir, 'config.json'),
      content: normalizeJsonContent(payload.config),
    },
    {
      filePath: path.join(progressDir, 'risks.json'),
      content: normalizeJsonContent({ items: payload.risks }),
    },
    {
      filePath: path.join(progressDir, 'tech-debts.json'),
      content: normalizeJsonContent({ items: payload.techDebts }),
    },
    {
      filePath: path.join(progressDir, 'logs.json'),
      content: normalizeJsonContent({ entries: payload.logs }),
    },
  ];

  for (const [phaseId, fileName] of currentTaskFileMap.entries()) {
    const incomingTaskFile = incomingTaskFileMap.get(phaseId);
    if (!incomingTaskFile) {
      throw createHttpError(400, `缺少阶段任务文件：${phaseId}`);
    }

    writes.push({
      filePath: path.join(tasksDir, fileName),
      content: normalizeJsonContent({
        phaseId: incomingTaskFile.phaseId,
        tasks: incomingTaskFile.tasks,
      }),
    });
  }

  try {
    for (const entry of writes) {
      await fs.writeFile(entry.filePath, entry.content, 'utf8');
    }

    // 保存后立即重建展示文档，保证真相源和 Markdown 展示层同步。
    await runProgressBuild();
  } catch (error) {
    await restoreSnapshot(currentSnapshot.rawFiles);

    try {
      await runProgressBuild();
    } catch {
      // 这里不再覆盖原始错误，避免吞掉真正的失败原因。
    }

    throw error;
  }

  return loadBoardSnapshot();
}

async function serveStaticFile(requestPath, response) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const resolvedPath = path.normalize(path.join(publicDir, normalizedPath));

  if (!resolvedPath.startsWith(publicDir)) {
    sendText(response, 403, '禁止访问。');
    return;
  }

  try {
    const fileBuffer = await fs.readFile(resolvedPath);
    const extension = path.extname(resolvedPath);
    response.writeHead(200, {
      'Content-Type': mimeMap.get(extension) ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(fileBuffer);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      sendText(response, 404, '文件不存在。');
      return;
    }

    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(response, 200, { ok: true, port });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/board-data') {
      const snapshot = await loadBoardSnapshot();
      sendJson(response, 200, toClientSnapshot(snapshot));
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/save') {
      const payload = await parseRequestBody(request);
      const snapshot = await saveBoardPayload(payload);

      sendJson(response, 200, {
        ok: true,
        message: '真相源与展示文档已同步保存。',
        revision: snapshot.revision,
      });
      return;
    }

    if (request.method === 'GET') {
      await serveStaticFile(requestUrl.pathname, response);
      return;
    }

    sendText(response, 405, '不支持的请求方法。');
  } catch (error) {
    const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 500;
    sendJson(response, statusCode, {
      ok: false,
      message: error instanceof Error ? error.message : '服务异常。',
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`进度看板已启动：http://127.0.0.1:${port}\n`);
});
