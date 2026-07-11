import type { ExtractedDocument } from './types';

export const DOCX_EXTRACTOR_TOOL = {
  name: 'layout3-basic-docx-extractor',
  version: '1.0.0+xmldom-0.9.10',
} as const;

export const PDF_EXTRACTOR_TOOL = {
  name: 'layout3-basic-pdf-extractor',
  version: '1.0.0+pdfjs-dist-5.4.624',
} as const;

export type BasicSourceFormat = 'docx' | 'pdf';

export interface DocumentExtractionInput {
  filePath: string;
  sourceFormat: BasicSourceFormat;
  sourceHash: string;
  signal?: AbortSignal;
}

export interface DocumentExtractorBridge {
  extract(input: DocumentExtractionInput): Promise<ExtractedDocument>;
}

export interface ExtractorWorkerRequest {
  filePath: string;
  sourceFormat: BasicSourceFormat;
  sourceHash: string;
}

export type ExtractorWorkerResponse =
  | { ok: true; result: ExtractedDocument }
  | {
      ok: false;
      code: 'FILE_PROCESSING' | 'CANCELLED';
      message: string;
    };
