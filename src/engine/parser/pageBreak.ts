export const PAGE_BREAK_COMMAND = '/pagebreak';
export const PAGE_BREAK_PLACEHOLDER = '[[LAYOUT_PAGEBREAK_FORCED_9F4E]]';

export function normalizePageBreakCommand(source: string): string {
  const lines = source.split(/\r?\n/u);
  let isInsideFence = false;

  return lines
    .map((line) => {
      const trimmedLine = line.trim();

      // 代码块中的 `/pagebreak` 只是普通文本，不能误触发强制分页。
      if (trimmedLine.startsWith('```') || trimmedLine.startsWith('~~~')) {
        isInsideFence = !isInsideFence;
        return line;
      }

      if (!isInsideFence && trimmedLine === PAGE_BREAK_COMMAND) {
        return PAGE_BREAK_PLACEHOLDER;
      }

      return line;
    })
    .join('\n');
}
