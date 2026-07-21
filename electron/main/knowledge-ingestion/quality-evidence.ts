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

interface EvidenceRange {
  startOffset: number;
  endOffset: number;
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

/** 按正文行优先切分，让建议证据更短、更容易由用户核对和修改。 */
function collectLineRanges(bodyText: string): EvidenceRange[] {
  const ranges: EvidenceRange[] = [];
  const linePattern = /[^\r\n]+/g;
  for (const match of bodyText.matchAll(linePattern)) {
    if (match.index === undefined) continue;
    ranges.push({ startOffset: match.index, endOffset: match.index + match[0].length });
  }
  return ranges;
}

/** 单行过长时再按中英文句末切分，避免把整页 PDF 作为一条证据展示。 */
function collectSentenceRanges(bodyText: string): EvidenceRange[] {
  const ranges: EvidenceRange[] = [];
  const sentencePattern = /[^\r\n。！？!?；;]+[。！？!?；;]?/g;
  for (const match of bodyText.matchAll(sentencePattern)) {
    if (match.index === undefined) continue;
    ranges.push({ startOffset: match.index, endOffset: match.index + match[0].length });
  }
  return ranges;
}

function collectLocatorRanges(locatorMap: DocumentLocatorMap): EvidenceRange[] {
  return locatorMap.sourceFormat === 'docx'
    ? locatorMap.blocks
      .filter((block) => block.blockType !== 'heading')
      .map((block) => ({ startOffset: block.startOffset, endOffset: block.endOffset }))
    : locatorMap.pages.map((page) => ({ startOffset: page.startOffset, endOffset: page.endOffset }));
}

function findUniqueEvidenceExcerpt(
  bodyText: string,
  range: EvidenceRange,
): string | null {
  let startOffset = Math.max(0, range.startOffset);
  let endOffset = Math.min(bodyText.length, range.endOffset);
  while (startOffset < endOffset && /\s/.test(bodyText[startOffset]!)) startOffset += 1;
  while (endOffset > startOffset && /\s/.test(bodyText[endOffset - 1]!)) endOffset -= 1;
  const source = bodyText.slice(startOffset, endOffset);
  if (source.length < 6) return null;

  // 先取短片段，重复时逐步扩大到最多 2000 字符；超过该长度不能进入现有质量合同。
  for (const length of [160, 400, 900, 2_000]) {
    const excerpt = source.slice(0, Math.min(source.length, length)).trim();
    if (
      excerpt.length >= 6
      && bodyText.indexOf(excerpt) === bodyText.lastIndexOf(excerpt)
    ) {
      return excerpt;
    }
    if (source.length <= length) break;
  }
  return null;
}

function buildSuggestedQuestion(title: string, evidence: string): string {
  const topic = evidence
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?；;].*$/, '')
    .trim()
    .slice(0, 36);
  return `《${title}》中“${topic || '这段内容'}”主要说明了什么？`;
}

function resolveAutomaticSampleCount(locatorMap: DocumentLocatorMap): number {
  const structureCount = locatorMap.sourceFormat === 'docx'
    ? locatorMap.blocks.filter((block) => block.blockType !== 'heading').length
    : locatorMap.pages.length;
  if (structureCount <= 3) return 1;
  if (structureCount <= 6) return 2;
  return 3;
}

function selectCoverageDrafts(drafts: QualityQuestionDraft[], sampleCount: number): QualityQuestionDraft[] {
  const actualCount = Math.min(sampleCount, drafts.length);
  if (actualCount === 0) return [];
  if (actualCount === 1) return [drafts[0]!];
  return Array.from({ length: actualCount }, (_, index) => {
    const coverageIndex = Math.round((index * (drafts.length - 1)) / (actualCount - 1));
    return drafts[coverageIndex]!;
  });
}

/**
 * 自动索引健康检查从已核验正文中确定性挑选 1～3 个覆盖样本，复用同一份长度、唯一性和
 * 来源定位合同；不会调用外部 AI 或远端检索，也不对资料用途或全文语义质量作判断。
 */
export function prepareAutomaticQualityQuestions(input: {
  bodyText: string;
  locatorMap: DocumentLocatorMap;
  expectedSourceHash: string;
  title: string;
}): PreparedQualityQuestion[] {
  const title = input.title.trim() || '本资料';
  const drafts: QualityQuestionDraft[] = [];
  const usedEvidence = new Set<string>();
  const ranges = [
    ...collectLineRanges(input.bodyText),
    ...collectSentenceRanges(input.bodyText),
    ...collectLocatorRanges(input.locatorMap),
  ];
  for (const range of ranges) {
    const evidence = findUniqueEvidenceExcerpt(input.bodyText, range);
    if (!evidence || usedEvidence.has(evidence)) continue;
    usedEvidence.add(evidence);
    drafts.push({ question: buildSuggestedQuestion(title, evidence), evidence });
  }
  const selectedDrafts = selectCoverageDrafts(drafts, resolveAutomaticSampleCount(input.locatorMap));
  if (selectedDrafts.length === 0) {
    throw new RegistryError('QUALITY_BLOCK', '无法从已核验正文中选出唯一的索引健康检查样本。');
  }

  return prepareQualityQuestions({
    bodyText: input.bodyText,
    locatorMap: input.locatorMap,
    expectedSourceHash: input.expectedSourceHash,
    questions: selectedDrafts,
  });
}

/**
 * 自动索引健康样本必须在受管正文中唯一出现，避免同一句话对应多个位置时系统凭猜测选择来源。
 */
export function prepareQualityQuestions(input: {
  bodyText: string;
  locatorMap: DocumentLocatorMap;
  expectedSourceHash: string;
  questions: QualityQuestionDraft[];
}): PreparedQualityQuestion[] {
  if (input.questions.length < 1 || input.questions.length > 3) {
    throw new RegistryError('INPUT_VALIDATION', '自动索引健康检查必须包含 1～3 个样本。');
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
