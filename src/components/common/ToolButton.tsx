import type { ReactNode } from 'react';

interface ToolButtonProps {
  label: string;
  children: ReactNode;
  isActive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}

export function ToolButton({
  label,
  children,
  isActive = false,
  disabled = false,
  onClick,
  title,
}: ToolButtonProps): JSX.Element {
  return (
    <button
      className={isActive ? 'tool-button active' : 'tool-button'}
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={isActive}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
