import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { remarkTextMarks } from './remark-text-marks';

export function createRemarkProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    // remarkTextMarks 必须在所有解析插件之后运行，
    // 确保 ++text++ 和 \underline{} 等文本标记不会被其他插件提前拆分
    .use(remarkTextMarks);
}
