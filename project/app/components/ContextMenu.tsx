// ContextMenu.tsx
// A generic context menu component for right-click actions on graphical schema nodes
import React from "react";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose }) => {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    const handleClick = () => {
      onClose();
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        top: position.y,
        left: position.x,
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: 8,
        boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
        zIndex: "var(--z-index-menu)" as any,
        minWidth: 160,
        padding: "6px 0",
      }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          onClick={item.onClick}
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
          disabled={item.disabled}
          style={{
            display: "block",
            width: "100%",
            background: hoveredIndex === idx && !item.disabled ? "#f0f0f0" : "none",
            border: "none",
            padding: "8px 18px",
            textAlign: "left",
            fontSize: 15,
            color: item.disabled ? "#aaa" : "#333",
            cursor: item.disabled ? "not-allowed" : "pointer",
            outline: "none",
            transition: "background-color 0.15s ease",
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};
