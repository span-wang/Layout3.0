import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, placeholder } from '@codemirror/view';
import { useEffect, useRef } from 'react';

interface MarkdownEditorProps {
  value: string;
  onChange?: (nextValue: string) => void;
  placeholderText?: string;
  readOnly?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholderText,
  readOnly = false,
}: MarkdownEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const latestValueRef = useRef(value);
  const latestChangeHandlerRef = useRef(onChange);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    latestChangeHandlerRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const state = EditorState.create({
      doc: latestValueRef.current,
      extensions: [
        lineNumbers(),
        markdown(),
        EditorState.readOnly.of(readOnly),
        EditorView.lineWrapping,
        placeholder(placeholderText ?? ''),
        EditorView.theme({
          '&': {
            height: '100%',
            color: '#17202b',
            backgroundColor: '#fbfcfd',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
          },
          '.cm-content, .cm-gutter': {
            minHeight: '100%',
            paddingTop: '18px',
            paddingBottom: '18px',
          },
          '.cm-content': {
            paddingLeft: '0',
            caretColor: '#0f5f6d',
          },
          '.cm-gutters': {
            color: '#8a97a6',
            backgroundColor: '#f3f6f8',
            borderRight: '1px solid #e2e8ef',
          },
          '.cm-activeLine': {
            backgroundColor: '#eef7f7',
          },
          '.cm-activeLineGutter': {
            backgroundColor: '#eef7f7',
          },
          '.cm-selectionBackground, ::selection': {
            backgroundColor: '#cfe9eb',
          },
          '.cm-cursor': {
            borderLeftColor: '#0f5f6d',
          },
          '.cm-placeholder': {
            color: '#93a1af',
          },
          '.cm-focused': {
            outline: 'none',
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || readOnly || !latestChangeHandlerRef.current) {
            return;
          }

          const nextValue = update.state.doc.toString();
          latestValueRef.current = nextValue;
          latestChangeHandlerRef.current(nextValue);
        }),
      ],
    });

    const editorView = new EditorView({
      state,
      parent: containerRef.current,
    });

    editorViewRef.current = editorView;

    return () => {
      editorView.destroy();
      editorViewRef.current = null;
    };
  }, [placeholderText, readOnly]);

  useEffect(() => {
    const editorView = editorViewRef.current;
    if (!editorView) {
      return;
    }

    const currentValue = editorView.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    editorView.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    });
  }, [value]);

  return <div className="markdown-editor" ref={containerRef} />;
}
