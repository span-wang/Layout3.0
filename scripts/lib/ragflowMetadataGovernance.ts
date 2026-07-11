import { createHash } from 'node:crypto';
import path from 'node:path';

export type MetadataScalar = string | number;
export type MetadataValue = MetadataScalar | MetadataScalar[];
export type ControlledMetadata = Record<string, MetadataValue>;

export interface RagflowGovernanceDocument {
  id: string;
  name: string;
  chunk_count?: number;
  run?: string;
  chunk_method?: string;
  meta_fields?: Record<string, unknown>;
}

export interface GovernanceDataset {
  id: string;
  code: 'english_grade7_rj_v1' | 'intermediate_accounting_v1';
  domain: 'english_education' | 'accounting_certification';
  defaultSubject: 'english' | 'unknown';
}

export interface GovernanceEntry {
  documentId: string;
  documentName: string;
  existingMetadata: Record<string, unknown>;
  governedMetadata: ControlledMetadata;
  changed: boolean;
  reviewReasons: string[];
}

const ACCOUNTING_SUBJECTS: Array<[RegExp, string]> = [
  [/经济法/, 'economic_law'],
  [/财务管理|财管/, 'financial_management'],
  [/实务|会计实务|会\s*计/, 'intermediate_accounting'],
];

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17,
  十八: 18, 十九: 19, 二十: 20, 二十一: 21, 二十二: 22, 二十三: 23,
};

export function governDocumentMetadata(
  dataset: GovernanceDataset,
  document: RagflowGovernanceDocument,
): GovernanceEntry {
  const existingMetadata = isRecord(document.meta_fields) ? document.meta_fields : {};
  const reviewReasons: string[] = [];
  const subject = dataset.domain === 'english_education'
    ? 'english'
    : inferAccountingSubject(document.name, existingMetadata);
  const units = dataset.domain === 'english_education' ? inferEnglishUnits(document.name) : [];
  const chapters = dataset.domain === 'accounting_certification' ? inferAccountingChapters(document.name) : [];
  const contentRole = inferContentRole(document.name, dataset.domain);
  const status = inferStatus(document);

  if (subject === 'unknown') reviewReasons.push('subject_unknown');
  if (dataset.domain === 'english_education' && units.length === 0) reviewReasons.push('unit_unknown');
  if (contentRole === 'unknown') reviewReasons.push('content_role_unknown');
  if (status !== 'ready') reviewReasons.push(`status_${status}`);

  const governedMetadata: ControlledMetadata = {
    metadata_schema: 'layout3_ragflow_v1',
    domain: dataset.domain,
    subject,
    unit: units.length === 0 ? 'unknown' : units.length === 1 ? units[0] : units,
    chapter: chapters.length === 0 ? 'unknown' : chapters.length === 1 ? chapters[0] : chapters,
    content_role: contentRole,
    resource_type: inferResourceType(document.name),
    year: inferYear(document.name) ?? 0,
    status,
    canonical_id: `${dataset.code}:${document.id}`,
    pair_id: buildPairId(dataset.code, document.name),
  };

  return {
    documentId: document.id,
    documentName: document.name,
    existingMetadata,
    governedMetadata,
    changed: !metadataEquals(existingMetadata, governedMetadata),
    reviewReasons,
  };
}

export function inferEnglishUnits(name: string): string[] {
  const normalized = name.replace(/\+/g, ' ');
  const units = new Set<string>();
  for (const match of normalized.matchAll(/\b(starter\s+)?units?\s*(\d+)\s*(?:[-~～至]\s*(?:unit\s*)?(\d+))?/gi)) {
    const prefix = match[1] ? 'starter_unit_' : 'unit_';
    const start = Number(match[2]);
    const end = match[3] ? Number(match[3]) : start;
    if (start > 0 && end >= start && end - start <= 12) {
      for (let unit = start; unit <= end; unit += 1) units.add(`${prefix}${unit}`);
    }
  }
  for (const match of normalized.matchAll(/\bstarter\s*(\d+)\s*(?:[-~～至]\s*(\d+))?/gi)) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start > 0 && end >= start && end - start <= 12) {
      for (let unit = start; unit <= end; unit += 1) units.add(`starter_unit_${unit}`);
    }
  }
  return [...units];
}

export function inferAccountingChapters(name: string): string[] {
  const chapters = new Set<string>();
  for (const match of name.matchAll(/第?\s*(\d{1,2}(?:\s*[、,，]\s*\d{1,2})+)\s*章/g)) {
    for (const part of match[1].split(/[、,，]/)) {
      const value = Number(part.trim());
      if (value > 0 && value <= 30) chapters.add(`chapter_${value}`);
    }
  }
  for (const match of name.matchAll(/第\s*([一二三四五六七八九十]{1,3}|\d{1,2})\s*章/g)) {
    const value = /^\d+$/.test(match[1]) ? Number(match[1]) : CHINESE_NUMBERS[match[1]];
    if (value && value <= 30) chapters.add(`chapter_${value}`);
  }
  return [...chapters];
}

export function inferAccountingSubject(name: string, metadata: Record<string, unknown>): string {
  const evidence = `${String(metadata.subject ?? '')}\n${name}`;
  return ACCOUNTING_SUBJECTS.find(([pattern]) => pattern.test(evidence))?.[1] ?? 'unknown';
}

export function inferContentRole(
  name: string,
  domain: GovernanceDataset['domain'],
): string {
  const normalized = name.replace(/\s+/g, ' ');
  if (/答案|答案册/.test(normalized)) return 'answer';
  if (/题库\//.test(normalized) || /题目|试卷|模考|月考|习题|母题|小考|必刷题/.test(normalized)) return 'exercise';
  if (/教材\//.test(normalized) || /电子课本|教材帮|^新七\s*(?:starter|unit)/i.test(normalized)) return 'textbook';
  if (/词汇|单词|默写/.test(normalized)) return 'vocabulary';
  if (/语法/.test(normalized)) return 'grammar';
  if (/写作|作文/.test(normalized)) return 'writing';
  if (/音标|发音|\.mp3$/i.test(normalized)) return 'audio';
  if (/知识点\//.test(normalized) || /知识点|知识归纳|知识总结|笔记|考点|法条|公式|分录|总结|重点短语句型/.test(normalized)) {
    return 'knowledge_summary';
  }
  if (domain === 'english_education' && /^(?:starter\s+)?unit\s*\d+.*\.doc$/i.test(normalized)) return 'exercise';
  if (domain === 'english_education' && /^(?:starter\s+)?unit\s*\d+.*\.(?:pdf|docx)$/i.test(normalized)) return 'reference';
  if (domain === 'accounting_certification' && /讲义|学习计划/.test(normalized)) return 'reference';
  return 'unknown';
}

export function inferResourceType(name: string): string {
  const extension = path.extname(name).slice(1).toLowerCase();
  return ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'mp3'].includes(extension) ? extension : 'unknown';
}

export function inferYear(name: string): number | undefined {
  const fullYear = name.match(/\b(20\d{2})\b/);
  if (fullYear) return Number(fullYear[1]);
  const shortYear = name.match(/(?:^|[^\d])(2[4-9])(?:年|秋|考季|中级|斯尔|高顿)/);
  return shortYear ? 2000 + Number(shortYear[1]) : undefined;
}

export function inferStatus(document: RagflowGovernanceDocument): string {
  if (!document.chunk_count) return 'quarantine';
  const run = String(document.run ?? '').toUpperCase();
  if (run === 'FAIL') return 'parse_failed';
  if (run && run !== 'DONE') return 'unparsed';
  return 'ready';
}

function buildPairId(datasetCode: string, name: string): string {
  const normalizedName = name
    .toLowerCase()
    .replace(/\.[^.\/]+$/, '')
    .replace(/答案册?|题目册?|试卷|解析版|上传/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  const digest = createHash('sha1').update(`${datasetCode}:${normalizedName}`).digest('hex').slice(0, 16);
  return `${datasetCode}:pair:${digest}`;
}

function metadataEquals(left: Record<string, unknown>, right: ControlledMetadata): boolean {
  return JSON.stringify(sortRecord(left)) === JSON.stringify(sortRecord(right));
}

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
