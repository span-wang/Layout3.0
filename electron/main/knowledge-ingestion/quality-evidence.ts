import { createHash } from 'node:crypto';
import type { DocumentLocatorMap, DocxBlockLocator, PdfPageLocator } from './processing';
import { RegistryError } from './types';

export interface QualityQuestionDraft {
  question: string;
  evidence: string;
}

export interface PreparedQualityQuestion {
  questionKey: string;
  question: string;
  evidenceExcerpt: string;
  evidenceSha256: string;
  startOffset: number;
  endOffset: number;
  locatorLabel: string;
}

function normalizeQuestion(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeEvidence(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function formatDocxBlock(block: DocxBlockLocator): string {
  const heading = block.headingPath.length > 0
    ? `标题路径“${block.headingPath.join(' / ')}”`
    : '正文起始区域';
  if (block.blockType === 'table') {
    return `${heading}，表格 ${block.tableNumber ?? '未知'}`;
  }
  if (block.blockType === 'heading') {
    return `${heading}，标题段 ${block.paragraphNumber ?? '未知'}`;
  }
  return `${heading}，段落 ${block.paragraphNumber ?? '未知'}`;
}

function formatPdfPage(page: PdfPageLocator): string {
  return `PDF 第 ${page.pageNumber} 页`;
}

function resolveLocatorLabel(
  locatorMap: DocumentLocatorMap,
  startOffset: number,
  endOffset: number,
): string {
  if (locatorMap.sourceFormat === 'docx') {
    const overlaps = locatorMap.blocks.filter((block) => (
      block.startOffset < endOffset && block.endOffset > startOffset
    ));
    if (overlaps.length === 0) {
      throw new RegistryError('QUALITY_BLOCK', '正文证据无法映射到 DOCX 标题、段落或表格定位。');
    }
    const first = formatDocxBlock(overlaps[0]);
    const last = formatDocxBlock(overlaps[overlaps.length - 1]);
    return first === last ? first : `${first} 至 ${last}`;
  }

  const overlaps = locatorMap.pages.filter((page) => (
    page.startOffset < endOffset && page.endOffset > startOffset
  ));
  if (overlaps.length === 0) {
    throw new RegistryError('QUALITY_BLOCK', '正文证据无法映射到 PDF 原始页码。');
  }
  const first = formatPdfPage(overlaps[0]);
  const last = formatPdfPage(overlaps[overlaps.length - 1]);
  return first === last ? first : `${first} 至 ${last}`;
}

/**
 * V1 由用户提供问题和正文证据。证据必须在受管正文中唯一出现，避免同一句话对应多个位置时
 * 系统凭猜测选择来源；后续 LLM 只能生成候选，仍需经过同一验证。
 */
export function prepareQualityQuestions(input: {
  bodyText: string;
  locatorMap: DocumentLocatorMap;
  expectedSourceHash: string;
  questions: QualityQuestionDraft[];
}): PreparedQualityQuestion[] {
  if (input.questions.length < 3 || input.questions.length > 5) {
    throw new RegistryError('INPUT_VALIDATION', '质量检查必须填写 3～5 条冒烟问题。');
  }
  if (input.locatorMap.sourceHash !== input.expectedSourceHash) {
    throw new RegistryError('QUALITY_BLOCK', '来源定位工件与当前资料版本哈希不一致。');
  }

  const seenQuestions = new Set<string>();
  return input.questions.map((draft, index) => {
    const question = normalizeQuestion(draft.question);
    const evidenceExcerpt = normalizeEvidence(draft.evidence);
    if (question.length < 4 || question.length > 500) {
      throw new RegistryError('INPUT_VALIDATION', `第 ${index + 1} 条冒烟问题需为 4～500 个字符。`);
    }
    if (evidenceExcerpt.length < 6 || evidenceExcerpt.length > 2_000) {
      throw new RegistryError('INPUT_VALIDATION', `第 ${index + 1} 条正文证据需为 6～2000 个字符。`);
    }
    const questionIdentity = question.toLocaleLowerCase();
    if (seenQuestions.has(questionIdentity)) {
      throw new RegistryError('INPUT_VALIDATION', `第 ${index + 1} 条冒烟问题与前面的内容重复。`);
    }
    seenQuestions.add(questionIdentity);

    const startOffset = input.bodyText.indexOf(evidenceExcerpt);
    const lastOffset = input.bodyText.lastIndexOf(evidenceExcerpt);
    if (startOffset < 0) {
      throw new RegistryError('QUALITY_BLOCK', `第 ${index + 1} 条正文证据未在已核验正文工件中找到。`);
    }
    if (startOffset !== lastOffset) {
      throw new RegistryError('QUALITY_BLOCK', `第 ${index + 1} 条正文证据在资料中出现多次，请补充更长的唯一片段。`);
    }
    const endOffset = startOffset + evidenceExcerpt.length;
    return {
      questionKey: `question-${index + 1}`,
      question,
      evidenceExcerpt,
      evidenceSha256: createHash('sha256').update(evidenceExcerpt, 'utf8').digest('hex'),
      startOffset,
      endOffset,
      locatorLabel: resolveLocatorLabel(input.locatorMap, startOffset, endOffset),
    };
  });
}
