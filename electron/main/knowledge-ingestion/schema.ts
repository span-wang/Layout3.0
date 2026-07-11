import type Database from 'better-sqlite3';

export interface RegistryMigration {
  version: number;
  name: string;
  sql: string;
}

export const REGISTRY_SCHEMA_VERSION = 4;

export const REGISTRY_MIGRATIONS: readonly RegistryMigration[] = [
  {
    version: 1,
    name: 'initial-registry-state-machine-schema',
    sql: `
      CREATE TABLE materials (
        canonical_id TEXT PRIMARY KEY,
        stable_title TEXT NOT NULL CHECK (length(trim(stable_title)) > 0),
        domain TEXT NOT NULL CHECK (length(trim(domain)) > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE publication_branches (
        canonical_id TEXT NOT NULL REFERENCES materials(canonical_id) ON DELETE RESTRICT,
        branch_key TEXT NOT NULL,
        branch_type TEXT NOT NULL CHECK (branch_type IN ('default', 'edition', 'curriculum', 'legal')),
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        default_strategy TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (canonical_id, branch_key)
      ) STRICT;

      CREATE UNIQUE INDEX publication_branches_one_default_per_material
      ON publication_branches(canonical_id)
      WHERE is_default = 1;

      CREATE TABLE material_versions (
        version_id TEXT PRIMARY KEY,
        canonical_id TEXT NOT NULL,
        publication_branch_key TEXT NOT NULL,
        version_no INTEGER NOT NULL CHECK (version_no > 0),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(trim(content_hash)) > 0),
        workflow_status TEXT NOT NULL CHECK (workflow_status IN (
          'pending_identification', 'pending_confirmation', 'processing', 'quality_check',
          'pending_publication', 'published', 'superseded', 'quarantined', 'archived'
        )),
        processing_health TEXT NOT NULL CHECK (processing_health IN (
          'pending', 'processing', 'healthy', 'degraded', 'failed'
        )),
        index_publication_status TEXT NOT NULL CHECK (index_publication_status IN (
          'pending', 'active', 'superseded', 'archived'
        )),
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
        metadata_schema_version TEXT NOT NULL DEFAULT '1.0.0',
        source_path TEXT,
        managed_source_path TEXT,
        parser_profile TEXT,
        embedding_profile TEXT,
        profile_bundle_hash TEXT,
        previous_version_id TEXT REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT,
        superseded_at TEXT,
        archived_at TEXT,
        last_verified_at TEXT,
        UNIQUE (canonical_id, publication_branch_key, version_no),
        UNIQUE (canonical_id, publication_branch_key, version_id),
        FOREIGN KEY (canonical_id, publication_branch_key)
          REFERENCES publication_branches(canonical_id, branch_key) ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX material_versions_branch_lookup
      ON material_versions(canonical_id, publication_branch_key, version_no DESC);

      CREATE TABLE material_publications (
        publication_id TEXT PRIMARY KEY,
        release_id TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        publication_branch_key TEXT NOT NULL,
        version_id TEXT NOT NULL,
        publication_status TEXT NOT NULL CHECK (publication_status IN ('active', 'superseded', 'archived')),
        effective_from TEXT,
        effective_to TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from < effective_to),
        FOREIGN KEY (canonical_id, publication_branch_key)
          REFERENCES publication_branches(canonical_id, branch_key) ON DELETE RESTRICT,
        FOREIGN KEY (canonical_id, publication_branch_key, version_id)
          REFERENCES material_versions(canonical_id, publication_branch_key, version_id) ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX material_publications_active_lookup
      ON material_publications(canonical_id, publication_branch_key, publication_status, effective_from, effective_to);

      CREATE TABLE ragflow_bindings (
        binding_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        index_generation TEXT NOT NULL,
        dataset_id TEXT NOT NULL CHECK (length(trim(dataset_id)) > 0),
        document_id TEXT NOT NULL CHECK (length(trim(document_id)) > 0),
        remote_status TEXT NOT NULL CHECK (remote_status IN ('pending', 'active', 'superseded', 'archived')),
        is_healthy INTEGER NOT NULL DEFAULT 1 CHECK (is_healthy IN (0, 1)),
        last_verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (index_generation, dataset_id, document_id)
      ) STRICT;

      CREATE INDEX ragflow_bindings_version_lookup
      ON ragflow_bindings(version_id, remote_status, is_healthy);

      CREATE TABLE audit_events (
        event_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
        after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX audit_events_entity_timeline
      ON audit_events(entity_type, entity_id, created_at, event_id);

      CREATE TABLE processing_jobs (
        job_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        stage TEXT NOT NULL CHECK (stage IN (
          'intake', 'fingerprint', 'identification', 'conversion', 'extraction', 'splitting',
          'upload', 'parse_wait', 'quality', 'publication_compensation'
        )),
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'cancelled'
        )),
        input_hash TEXT NOT NULL,
        profile_version TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
        next_retry_at TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        heartbeat_at TEXT,
        cancel_requested_at TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (version_id, stage, input_hash, profile_version)
      ) STRICT;

      CREATE INDEX processing_jobs_claim_order
      ON processing_jobs(status, next_retry_at, created_at);

      CREATE TRIGGER audit_events_no_update
      BEFORE UPDATE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'AUDIT_EVENTS_ARE_IMMUTABLE');
      END;

      CREATE TRIGGER audit_events_no_delete
      BEFORE DELETE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'AUDIT_EVENTS_ARE_IMMUTABLE');
      END;

      CREATE TRIGGER material_publications_validate_insert
      BEFORE INSERT ON material_publications
      WHEN NEW.publication_status = 'active'
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM publication_branches branch
          WHERE branch.canonical_id = NEW.canonical_id
            AND branch.branch_key = NEW.publication_branch_key
            AND (
              (branch.branch_type = 'legal' AND NEW.effective_from IS NULL)
              OR (branch.branch_type <> 'legal' AND (NEW.effective_from IS NOT NULL OR NEW.effective_to IS NOT NULL))
            )
        ) THEN RAISE(ABORT, 'PUBLICATION_EFFECTIVE_RANGE_INVALID') END;

        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM material_publications existing
          JOIN publication_branches branch
            ON branch.canonical_id = existing.canonical_id
           AND branch.branch_key = existing.publication_branch_key
          WHERE existing.canonical_id = NEW.canonical_id
            AND existing.publication_branch_key = NEW.publication_branch_key
            AND existing.publication_status = 'active'
            AND (
              branch.branch_type <> 'legal'
              OR (
                COALESCE(existing.effective_from, '0001-01-01T00:00:00.000Z')
                  < COALESCE(NEW.effective_to, '9999-12-31T23:59:59.999Z')
                AND COALESCE(NEW.effective_from, '0001-01-01T00:00:00.000Z')
                  < COALESCE(existing.effective_to, '9999-12-31T23:59:59.999Z')
              )
            )
        ) THEN RAISE(ABORT, 'PUBLICATION_ACTIVE_RANGE_CONFLICT') END;
      END;

      CREATE TRIGGER material_publications_validate_update
      BEFORE UPDATE OF canonical_id, publication_branch_key, publication_status, effective_from, effective_to
      ON material_publications
      WHEN NEW.publication_status = 'active'
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM publication_branches branch
          WHERE branch.canonical_id = NEW.canonical_id
            AND branch.branch_key = NEW.publication_branch_key
            AND (
              (branch.branch_type = 'legal' AND NEW.effective_from IS NULL)
              OR (branch.branch_type <> 'legal' AND (NEW.effective_from IS NOT NULL OR NEW.effective_to IS NOT NULL))
            )
        ) THEN RAISE(ABORT, 'PUBLICATION_EFFECTIVE_RANGE_INVALID') END;

        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM material_publications existing
          JOIN publication_branches branch
            ON branch.canonical_id = existing.canonical_id
           AND branch.branch_key = existing.publication_branch_key
          WHERE existing.publication_id <> NEW.publication_id
            AND existing.canonical_id = NEW.canonical_id
            AND existing.publication_branch_key = NEW.publication_branch_key
            AND existing.publication_status = 'active'
            AND (
              branch.branch_type <> 'legal'
              OR (
                COALESCE(existing.effective_from, '0001-01-01T00:00:00.000Z')
                  < COALESCE(NEW.effective_to, '9999-12-31T23:59:59.999Z')
                AND COALESCE(NEW.effective_from, '0001-01-01T00:00:00.000Z')
                  < COALESCE(existing.effective_to, '9999-12-31T23:59:59.999Z')
              )
            )
        ) THEN RAISE(ABORT, 'PUBLICATION_ACTIVE_RANGE_CONFLICT') END;
      END;
    `,
  },
  {
    version: 2,
    name: 'single-file-intake-and-metadata-schema',
    sql: `
      CREATE TABLE intake_batches (
        batch_id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK (source_type IN ('single_file')),
        status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
        item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE source_occurrences (
        occurrence_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        source_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX source_occurrences_version_lookup
      ON source_occurrences(version_id, observed_at DESC);

      CREATE TABLE intake_items (
        item_id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES intake_batches(batch_id) ON DELETE RESTRICT,
        version_id TEXT NOT NULL REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        occurrence_id TEXT NOT NULL REFERENCES source_occurrences(occurrence_id) ON DELETE RESTRICT,
        original_file_name TEXT NOT NULL,
        file_extension TEXT NOT NULL CHECK (file_extension IN ('.docx', '.pdf')),
        file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
        content_hash TEXT NOT NULL,
        intake_status TEXT NOT NULL CHECK (intake_status IN (
          'pending_confirmation', 'processing', 'duplicate'
        )),
        duplicate_of_version_id TEXT REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX intake_items_recent_lookup
      ON intake_items(created_at DESC, item_id);

      CREATE TABLE metadata_evidence (
        evidence_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        field_name TEXT NOT NULL,
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        source_type TEXT NOT NULL CHECK (source_type IN ('manual')),
        source_reference TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        decision TEXT NOT NULL CHECK (decision IN ('confirmed')),
        decided_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (version_id, field_name, source_type, decision)
      ) STRICT;

      CREATE INDEX metadata_evidence_version_lookup
      ON metadata_evidence(version_id, field_name);
    `,
  },
  {
    version: 3,
    name: 'processing-artifacts-and-remote-parse-evidence',
    sql: `
      CREATE TABLE processing_artifacts (
        artifact_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        artifact_type TEXT NOT NULL CHECK (artifact_type IN (
          'extracted_text', 'locator_map', 'manifest'
        )),
        relative_path TEXT NOT NULL UNIQUE CHECK (length(trim(relative_path)) > 0),
        media_type TEXT NOT NULL CHECK (length(trim(media_type)) > 0),
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
        processing_profile TEXT NOT NULL CHECK (length(trim(processing_profile)) > 0),
        tool_name TEXT NOT NULL CHECK (length(trim(tool_name)) > 0),
        tool_version TEXT NOT NULL CHECK (length(trim(tool_version)) > 0),
        lineage_json TEXT NOT NULL CHECK (json_valid(lineage_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (
          version_id, artifact_type, source_hash, processing_profile, tool_name, tool_version
        )
      ) STRICT;

      CREATE INDEX processing_artifacts_version_lookup
      ON processing_artifacts(version_id, artifact_type, created_at DESC);

      ALTER TABLE ragflow_bindings ADD COLUMN remote_run_status TEXT;
      ALTER TABLE ragflow_bindings
      ADD COLUMN chunk_count INTEGER CHECK (chunk_count IS NULL OR chunk_count >= 0);
    `,
  },
  {
    version: 4,
    name: 'quality-gate-runs-and-results',
    sql: `
      CREATE TABLE quality_runs (
        quality_run_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES material_versions(version_id) ON DELETE RESTRICT,
        job_id TEXT NOT NULL UNIQUE REFERENCES processing_jobs(job_id) ON DELETE RESTRICT,
        binding_id TEXT NOT NULL REFERENCES ragflow_bindings(binding_id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'passed', 'blocked', 'failed', 'cancelled', 'expired'
        )),
        conclusion TEXT CHECK (conclusion IS NULL OR conclusion IN (
          'passed', 'blocked', 'technical_failure', 'cancelled', 'expired'
        )),
        binding_snapshot_json TEXT NOT NULL CHECK (json_valid(binding_snapshot_json)),
        questions_snapshot_json TEXT NOT NULL CHECK (json_valid(questions_snapshot_json)),
        input_snapshot_json TEXT NOT NULL CHECK (json_valid(input_snapshot_json)),
        profile_snapshot_json TEXT NOT NULL CHECK (json_valid(profile_snapshot_json)),
        config_snapshot_json TEXT NOT NULL CHECK (json_valid(config_snapshot_json)),
        expires_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (status IN ('queued', 'running') AND conclusion IS NULL AND completed_at IS NULL)
          OR (status = 'passed' AND conclusion = 'passed' AND completed_at IS NOT NULL)
          OR (status = 'blocked' AND conclusion = 'blocked' AND completed_at IS NOT NULL)
          OR (status = 'failed' AND conclusion = 'technical_failure' AND completed_at IS NOT NULL)
          OR (status = 'cancelled' AND conclusion = 'cancelled' AND completed_at IS NOT NULL)
          OR (status = 'expired' AND conclusion = 'expired' AND completed_at IS NOT NULL)
        )
      ) STRICT;

      CREATE INDEX quality_runs_version_timeline
      ON quality_runs(version_id, created_at DESC, quality_run_id);

      CREATE UNIQUE INDEX quality_runs_one_open_per_version
      ON quality_runs(version_id)
      WHERE status IN ('queued', 'running');

      CREATE TABLE quality_results (
        quality_result_id TEXT PRIMARY KEY,
        quality_run_id TEXT NOT NULL REFERENCES quality_runs(quality_run_id) ON DELETE RESTRICT,
        check_key TEXT NOT NULL CHECK (length(trim(check_key)) > 0),
        result_key TEXT NOT NULL CHECK (length(trim(result_key)) > 0),
        blocking_level TEXT NOT NULL CHECK (blocking_level IN ('blocking', 'warning', 'info')),
        passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
        threshold_json TEXT NOT NULL CHECK (json_valid(threshold_json)),
        actual_json TEXT NOT NULL CHECK (json_valid(actual_json)),
        evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (quality_run_id, result_key)
      ) STRICT;

      CREATE INDEX quality_results_run_order
      ON quality_results(quality_run_id, created_at, quality_result_id);
    `,
  },
];

export function getAppliedSchemaVersion(database: Database.Database): number {
  const migrationTableExists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .pluck()
    .get();

  if (!migrationTableExists) {
    return 0;
  }

  return Number(
    database.prepare('SELECT COALESCE(MAX(version), 0) FROM schema_migrations').pluck().get(),
  );
}

export function applyRegistryMigrations(database: Database.Database, appliedAt: string): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedVersion = getAppliedSchemaVersion(database);
  const pendingMigrations = REGISTRY_MIGRATIONS.filter((migration) => migration.version > appliedVersion);

  for (const migration of pendingMigrations) {
    // SQL 变更和迁移记录必须一起提交，异常时不能留下“半张新表”。
    database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, appliedAt);
    })();
  }
}
