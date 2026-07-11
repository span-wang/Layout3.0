import type {
  IndexPublicationStatus,
  ProcessingHealth,
  VersionStatePatch,
  WorkflowStatus,
} from './types';
import { RegistryError } from './types';

const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  pending_identification: ['pending_confirmation'],
  pending_confirmation: ['processing'],
  processing: ['quality_check', 'quarantined'],
  quality_check: ['pending_publication', 'quarantined'],
  pending_publication: ['published'],
  published: ['superseded', 'quarantined', 'archived'],
  superseded: ['published', 'archived'],
  quarantined: ['pending_confirmation', 'processing'],
  archived: [],
};

const PROCESSING_HEALTH_TRANSITIONS: Record<ProcessingHealth, readonly ProcessingHealth[]> = {
  pending: ['processing'],
  processing: ['healthy', 'degraded', 'failed'],
  healthy: ['processing'],
  degraded: ['processing'],
  failed: ['processing'],
};

const INDEX_PUBLICATION_TRANSITIONS: Record<
  IndexPublicationStatus,
  readonly IndexPublicationStatus[]
> = {
  pending: ['active', 'archived'],
  active: ['superseded', 'archived'],
  superseded: ['active', 'archived'],
  archived: [],
};

function assertTransition<T extends string>(
  dimension: string,
  current: T,
  next: T,
  allowed: Record<T, readonly T[]>,
): void {
  if (current === next) {
    return;
  }

  if (!allowed[current].includes(next)) {
    throw new RegistryError(
      'INVALID_STATE_TRANSITION',
      `${dimension} 不允许从 ${current} 转为 ${next}。`,
    );
  }
}

export function assertVersionStatePatch(
  current: {
    workflowStatus: WorkflowStatus;
    processingHealth: ProcessingHealth;
    indexPublicationStatus: IndexPublicationStatus;
  },
  patch: VersionStatePatch,
): void {
  if (patch.workflowStatus) {
    assertTransition(
      'workflow_status',
      current.workflowStatus,
      patch.workflowStatus,
      WORKFLOW_TRANSITIONS,
    );
  }
  if (patch.processingHealth) {
    assertTransition(
      'processing_health',
      current.processingHealth,
      patch.processingHealth,
      PROCESSING_HEALTH_TRANSITIONS,
    );
  }
  if (patch.indexPublicationStatus) {
    assertTransition(
      'index_publication_status',
      current.indexPublicationStatus,
      patch.indexPublicationStatus,
      INDEX_PUBLICATION_TRANSITIONS,
    );
  }
}
