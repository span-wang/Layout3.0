import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: false;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onSelect, onClose }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (x + rect.width > vw - 8) {
      adjustedX = vw - rect.width - 8;
    }
    if (y + rect.height > vh - 8) {
      adjustedY = vh - rect.height - 8;
    }

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item, i) => {
        if ('separator' in item && item.separator) {
          return <div key={`sep-${i}`} className="context-menu-separator" role="separator" />;
        }

        const menuItem = item as ContextMenuItem;
        return (
          <button
            key={menuItem.id}
            className={`context-menu-item${menuItem.danger ? ' danger' : ''}${menuItem.disabled ? ' disabled' : ''}`}
            role="menuitem"
            disabled={menuItem.disabled}
            onClick={() => {
              if (!menuItem.disabled) {
                onSelect(menuItem.id);
              }
            }}
          >
            {menuItem.label}
          </button>
        );
      })}
    </div>
  );
}
