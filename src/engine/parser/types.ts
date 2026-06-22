export type ParseState = 'idle' | 'parsing' | 'ready' | 'error';

export interface TocItem {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export type ParsedBlock =
  | {
      type: 'heading';
      depth: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
      id: string;
    }
  | {
      type: 'paragraph';
      text: string;
    }
  | {
      type: 'list';
      ordered: boolean;
      items: string[];
    }
  | {
      type: 'blockquote';
      blocks: ParsedBlock[];
    }
  | {
      type: 'code';
      language: string | null;
      value: string;
    }
  | {
      type: 'table';
      rows: string[][];
    }
  | {
      type: 'horizontalRule';
    };

export interface ParseResult {
  blocks: ParsedBlock[];
  toc: TocItem[];
  html: string;
  errors: string[];
}
