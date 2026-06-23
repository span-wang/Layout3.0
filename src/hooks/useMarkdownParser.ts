import { useDeferredValue, useEffect } from 'react';
import { createLayoutDocumentFromMarkdown } from '@/engine/document-model';
import { useAppStore } from '@/store';

export function useMarkdownParser(): void {
  const source = useAppStore((state) => state.source);
  const documentEpoch = useAppStore((state) => state.documentEpoch);
  const deferredSource = useDeferredValue(source);
  const documentFormat = useAppStore((state) => state.documentFormat);
  const layoutDocumentSource = useAppStore((state) => state.layoutDocument?.source ?? null);
  const setParseState = useAppStore((state) => state.setParseState);
  const setLayoutDocument = useAppStore((state) => state.setLayoutDocument);
  const setParseError = useAppStore((state) => state.setParseError);

  useEffect(() => {
    if (
      documentFormat === 'layout' &&
      layoutDocumentSource === deferredSource
    ) {
      return;
    }

    let cancelled = false;

    setParseState('parsing');

    createLayoutDocumentFromMarkdown(deferredSource)
      .then((document) => {
        if (cancelled) {
          return;
        }

        setLayoutDocument(document);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Markdown 解析失败';
        setParseError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [
    deferredSource,
    documentEpoch,
    documentFormat,
    layoutDocumentSource,
    setLayoutDocument,
    setParseError,
    setParseState,
  ]);
}
