import type { ProcessingArtifactRecord } from '../types';

export const LOCATOR_SCHEMA_VERSION = 'layout3_locator_v1' as const;
export const PROCESSING_MANIFEST_SCHEMA_VERSION = 'layout3_processing_manifest_v1' as const;

export interface ExplicitPageBreakLocator {
  kind: 'page_break' | 'page_break_before';
  characterOffset: number;
}

export interface DocxBlockLocator {
  blockId: string;
  blockType: 'heading' | 'paragraph' | 'table';
  startOffset: number;
  endOffset: number;
  headingPath: string[];
  headingLevel: number | null;
  paragraphNumber: number | null;
  tableNumber: number | null;
  rowCount: number | null;
  columnCount: number | null;
  explicitPageBreaks: ExplicitPageBreakLocator[];
}

export interface DocxLocatorMap {
  schemaVersion: typeof LOCATOR_SCHEMA_VERSION;
  sourceFormat: 'docx';
  sourceHash: string;
  offsetEncoding: 'utf16-code-unit';
  physicalPageNumbersAvailable: false;
  blocks: DocxBlockLocator[];
}

export interface PdfTextItemLocator {
  itemNumber: number;
  startOffset: number;
  endOffset: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageLocator {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  pageWidth: number;
  pageHeight: number;
  items: PdfTextItemLocator[];
}

export interface PdfLocatorMap {
  schemaVersion: typeof LOCATOR_SCHEMA_VERSION;
  sourceFormat: 'pdf';
  sourceHash: string;
  offsetEncoding: 'utf16-code-unit';
  pageCount: number;
  pages: PdfPageLocator[];
}

export type DocumentLocatorMap = DocxLocatorMap | PdfLocatorMap;

export interface ExtractedDocument {
  bodyText: string;
  locatorMap: DocumentLocatorMap;
  toolName: string;
  toolVersion: string;
}

export interface ProcessingManifestArtifact {
  artifactType: 'extracted_text' | 'locator_map';
  relativePath: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}

export interface ProcessingManifest {
  schemaVersion: typeof PROCESSING_MANIFEST_SCHEMA_VERSION;
  artifactSetKey: string;
  versionId: string;
  source: {
    sha256: string;
    format: 'docx' | 'pdf';
  };
  processing: {
    profile: string;
    toolName: string;
    toolVersion: string;
  };
  locatorSchemaVersion: typeof LOCATOR_SCHEMA_VERSION;
  artifacts: ProcessingManifestArtifact[];
  createdAt: string;
}

export interface ProcessingArtifactReference extends ProcessingArtifactRecord {
  absolutePath: string;
}

export interface ProcessingArtifactSet {
  versionId: string;
  sourceHash: string;
  processingProfile: string;
  reused: boolean;
  body: ProcessingArtifactReference;
  locatorMap: ProcessingArtifactReference;
  manifest: ProcessingArtifactReference;
}
