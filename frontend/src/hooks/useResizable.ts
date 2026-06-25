import { useState, useCallback, useRef, useEffect } from 'react';

interface UseResizableOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  side?: 'left' | 'right';
}

export function useResizable({
  storageKey,
  defaultWidth,
  minWidth = 160,
  maxWidth = 520,
  side = 'left',
}: UseResizableOptions) {
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
        return parsed;
      }
    }
    return defaultWidth;
  });

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.dataset.resizing = 'true';
  }, [width]);

  const handleDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
    localStorage.setItem(storageKey, String(defaultWidth));
  }, [defaultWidth, storageKey]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = side === 'left'
        ? e.clientX - startX.current
        : startX.current - e.clientX;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      delete document.body.dataset.resizing;
      localStorage.setItem(storageKey, String(width));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [storageKey, minWidth, maxWidth, width, side]);

  return { width, handleMouseDown, handleDoubleClick };
}
