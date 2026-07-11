import type { RagflowMetadata, RagflowMetadataPrimitive } from './ragflow/types';
import type { MaterialVersionRecord } from './types';
import { RegistryError } from './types';

function readPrimitive(
  metadata: Record<string, unknown>,
  ...fieldNames: string[]
): RagflowMetadataPrimitive {
  for (const fieldName of fieldNames) {
    const value = metadata[fieldName];
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      return value;
    }
  }
  return null;
}

function readString(metadata: Record<string, unknown>, ...fieldNames: string[]): string | null {
  for (const fieldName of fieldNames) {
    const value = metadata[fieldName];
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}

function normalizeSourceHash(contentHash: string): string {
  const normalized = contentHash.trim().toLowerCase().replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new RegistryError('METADATA_VALIDATION', '待写入 RAGFlow 的 source_hash 必须是 64 位 SHA-256。');
  }
  return normalized;
}

/**
 * 构造暂存索引的受控 metadata。身份、状态与 profile 字段始终由 SQLite 版本列覆盖，
 * 不能被人工 metadata 中的同名字段替换。
 */
export function buildLayout3PendingMetadata(
  version: MaterialVersionRecord,
  indexGeneration: string,
): RagflowMetadata {
  const generation = indexGeneration.trim();
  if (!generation) {
    throw new RegistryError('METADATA_VALIDATION', 'index_generation 不能为空。');
  }

  const metadata = version.metadata;
  const parserProfile = version.parserProfile
    ?? readString(metadata, 'parserProfile', 'parser_profile');
  const embeddingProfile = version.embeddingProfile
    ?? readString(metadata, 'embeddingProfile', 'embedding_profile');

  return {
    metadata_schema: 'layout3_ingestion_v1',
    metadata_schema_version: version.metadataSchemaVersion,
    canonical_id: version.canonicalId,
    publication_branch_key: version.publicationBranchKey,
    version_id: version.versionId,
    version_no: version.versionNo,
    version: readPrimitive(metadata, 'version'),
    status: 'pending',
    index_generation: generation,
    content_hash: normalizeSourceHash(version.contentHash),
    source_hash: normalizeSourceHash(version.contentHash),
    stable_title: readPrimitive(metadata, 'stableTitle', 'stable_title'),
    domain: readPrimitive(metadata, 'domain'),
    subject: readPrimitive(metadata, 'subject'),
    language: readPrimitive(metadata, 'language'),
    education_stage: readPrimitive(metadata, 'educationStage', 'education_stage'),
    grade: readPrimitive(metadata, 'grade'),
    semester: readPrimitive(metadata, 'semester'),
    edition: readPrimitive(metadata, 'edition'),
    curriculum_year: readPrimitive(metadata, 'curriculumYear', 'curriculum_year'),
    unit: readPrimitive(metadata, 'unit'),
    chapter: readPrimitive(metadata, 'chapter'),
    material_type: readPrimitive(metadata, 'materialType', 'material_type'),
    effective_from: readPrimitive(metadata, 'effectiveFrom', 'effective_from'),
    effective_to: readPrimitive(metadata, 'effectiveTo', 'effective_to'),
    parser_profile: parserProfile,
    embedding_profile: embeddingProfile,
    profile_bundle_hash: version.profileBundleHash,
  };
}
