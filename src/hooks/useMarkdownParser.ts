import { useDeferredValue, useEffect } from 'react';
import { parseMarkdown } from '@/engine/parser';
import { useAppStore } from '@/store';

export function useMarkdownParser(): void {
  const source = useAppStore((state) => state.source);
  const documentEpoch = useAppStore((state) => state.documentEpoch);
  const deferredSource = useDeferredValue(source);
  const setParseState = useAppStore((state) => state.setParseState);
  const setParseResult = useAppStore((state) => state.setParseResult);
  const setParseError = useAppStore((state) => state.setParseError);

  useEffect(() => {
    let cancelled = false;

    setParseState('parsing');

    parseMarkdown(deferredSource)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setParseResult(result);
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
  }, [deferredSource, documentEpoch, setParseError, setParseResult, setParseState]);
}
