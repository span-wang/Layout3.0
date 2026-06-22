import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildExportHtml } from '../src/services/exportHtml.ts';
import { parseMarkdown } from '../src/engine/parser/index.ts';
import { paginateBlocks } from '../src/engine/typesetting/index.ts';

const outputDir = path.resolve('out', 'm1-smoke');
const outputPath = path.join(outputDir, 'm1-smoke.pdf');
const electronCliPath = path.resolve('node_modules', 'electron', 'cli.js');
const exportScriptPath = path.join(outputDir, 'm1-smoke-export.cjs');

async function runElectronExport(html: string): Promise<void> {
  const script = [
    'const { app, BrowserWindow } = require(\'electron\');',
    "const fs = require('node:fs/promises');",
    "const path = require('node:path');",
    `const outputPath = ${JSON.stringify(outputPath)};`,
    `const html = ${JSON.stringify(html)};`,
    `const outputDir = path.dirname(outputPath);`,
    'async function main() {',
    '  await app.whenReady();',
    '  await fs.mkdir(outputDir, { recursive: true });',
    '  const win = new BrowserWindow({ show: false, autoHideMenuBar: true, webPreferences: { sandbox: false } });',
    '  try {',
    "    await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));",
    "    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready : Promise.resolve()');",
    "    const pdfBuffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });",
    '    await fs.writeFile(outputPath, pdfBuffer);',
    '  } finally {',
    '    if (!win.isDestroyed()) {',
    '      win.destroy();',
    '    }',
    '  }',
    '  app.exit(0);',
    '}',
    'main().catch((error) => {',
    '  console.error(error.stack || error.message || String(error));',
    '  app.exit(1);',
    '});',
  ].join('\n');

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(exportScriptPath, script, 'utf8');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [electronCliPath, exportScriptPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
    });

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Electron 导出失败，退出码：${code ?? 'unknown'}`));
    });
  });

  await fs.rm(exportScriptPath, { force: true });
}

async function main(): Promise<void> {
  const source = [
    '# M1 Smoke Test',
    '',
    '这是一个用于验证编辑、解析、分页与导出的最小冒烟文档。',
    '',
    '- 第一项',
    '- 第二项',
    '',
    '> 引用块用于验证嵌套渲染。',
    '',
    '```ts',
    "const code = 'hello';",
    '```',
    '',
  ].join('\n');

  const parsed = await parseMarkdown(source);
  const pages = paginateBlocks(parsed.blocks);
  const html = buildExportHtml({ pages, title: 'M1 冒烟验证' });

  await fs.mkdir(outputDir, { recursive: true });
  await runElectronExport(html);

  const stat = await fs.stat(outputPath);
  console.log(
    JSON.stringify({ pages: pages.length, blocks: parsed.blocks.length, outputPath, bytes: stat.size }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
