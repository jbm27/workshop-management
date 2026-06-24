import { useCallback, useState } from 'react';
import { reorderItemsById } from '../utils/invoiceLineSections';

export function useInvoiceLineDragReorder({ items, disabled, onReorder }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [busy, setBusy] = useState(false);

  const isDisabled = disabled || busy;

  const handleDragStart = useCallback(
    (itemId) => (e) => {
      if (isDisabled) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(itemId));
      setDragId(Number(itemId));
    },
    [isDisabled],
  );

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  const rowProps = useCallback(
    (itemId) => {
      const id = Number(itemId);
      const isDragging = dragId === id;
      const isOver = overId === id && dragId != null && dragId !== id;
      return {
        onDragOver: (e) => {
          if (isDisabled || dragId == null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setOverId(id);
        },
        onDragLeave: (e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          if (overId === id) setOverId(null);
        },
        onDrop: async (e) => {
          e.preventDefault();
          if (isDisabled) return;
          const fromId = Number(e.dataTransfer.getData('text/plain'));
          setDragId(null);
          setOverId(null);
          if (!fromId || fromId === id) return;
          const reordered = reorderItemsById(items, fromId, id);
          setBusy(true);
          try {
            await onReorder(reordered, fromId, id);
          } finally {
            setBusy(false);
          }
        },
        style: {
          opacity: isDragging ? 0.45 : 1,
          boxShadow: isOver ? 'inset 0 3px 0 var(--accent)' : undefined,
        },
      };
    },
    [dragId, overId, isDisabled, items, onReorder],
  );

  return {
    busy,
    dragId,
    handleDragStart,
    handleDragEnd,
    rowProps,
    sortable: !isDisabled,
  };
}
