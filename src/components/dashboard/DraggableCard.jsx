import { useState } from 'react';

// Snap-to-grid sortable card. Cards stay aligned to their grid slots; dragging
// one onto another swaps the two (no free-floating, no overlap). The parent owns
// the slot order and applies the swap via onDropCard(fromId, toId).

export default function SortableCard({ id, onDropCard, children }) {
  const [over, setOver] = useState(false);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      id={`sec-${id}`}
      className={`sort-card${over ? ' over' : ''}${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-card', id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => { setDragging(false); setOver(false); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const from = e.dataTransfer.getData('text/x-card');
        if (from && from !== id) onDropCard(from, id);
      }}
    >
      {children}
    </div>
  );
}
