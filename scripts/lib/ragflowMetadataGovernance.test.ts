import assert from 'node:assert/strict';
import test from 'node:test';
import {
  governDocumentMetadata,
  inferAccountingChapters,
  inferEnglishUnits,
} from './ragflowMetadataGovernance';

const englishDataset = {
  id: 'english',
  code: 'english_grade7_rj_v1' as const,
  domain: 'english_education' as const,
  defaultSubject: 'english' as const,
};

const accountingDataset = {
  id: 'accounting',
  code: 'intermediate_accounting_v1' as const,
  domain: 'accounting_certification' as const,
  defaultSubject: 'unknown' as const,
};

test('英语单元规则支持 Starter、多单元范围和加号文件名', () => {
  assert.deepEqual(inferEnglishUnits('01 Starter Unit 1-3(词汇与句型).docx'), ['starter_unit_1', 'starter_unit_2', 'starter_unit_3']);
  assert.deepEqual(inferEnglishUnits('Unit+5+默写手册.docx'), ['unit_5']);
  assert.deepEqual(inferEnglishUnits('Units 1- 2 单元主题写作.docx'), ['unit_1', 'unit_2']);
  assert.deepEqual(inferEnglishUnits('新七 starter2-3.pdf'), ['starter_unit_2', 'starter_unit_3']);
});

test('英语治理生成稳定字段并隔离零切片文档', () => {
  const entry = governDocumentMetadata(englishDataset, {
    id: 'doc-1',
    name: '19.Unit 5 Fun Clubs(语法)(解析版).docx',
    chunk_count: 0,
    run: 'DONE',
  });
  assert.equal(entry.governedMetadata.unit, 'unit_5');
  assert.equal(entry.governedMetadata.content_role, 'grammar');
  assert.equal(entry.governedMetadata.status, 'quarantine');
  assert.equal(entry.governedMetadata.canonical_id, 'english_grade7_rj_v1:doc-1');
});

test('会计规则保留旧字段证据并规范化科目、章节与角色', () => {
  const entry = governDocumentMetadata(accountingDataset, {
    id: 'doc-2',
    name: '知识点/13第十三章 收入(PDF笔记版).pdf',
    chunk_count: 59,
    run: 'DONE',
    meta_fields: { subject: '实务', type: '知识点' },
  });
  assert.equal(entry.governedMetadata.subject, 'intermediate_accounting');
  assert.equal(entry.governedMetadata.chapter, 'chapter_13');
  assert.equal(entry.governedMetadata.content_role, 'knowledge_summary');
  assert.deepEqual(entry.existingMetadata, { subject: '实务', type: '知识点' });
});

test('会计章节规则支持文件名中的多个章节', () => {
  assert.deepEqual(inferAccountingChapters('第9、12、14章.pdf'), ['chapter_9', 'chapter_12', 'chapter_14']);
  assert.deepEqual(inferAccountingChapters('第一章-第二章.pdf'), ['chapter_1', 'chapter_2']);
});
