import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import type { SchemaDraft } from '../utils/draft-utils';

interface DraftIndicatorProps {
  detectedDraft: SchemaDraft | null;
}

export function DraftIndicator({ detectedDraft }: DraftIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!detectedDraft) {
    return null;
  }

  return (
    <div className="relative inline-block">
      <div
        className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium border border-blue-300"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span>{detectedDraft}</span>
        <Info size={14} className="cursor-help" />
      </div>

      {showTooltip && (
        <div className="absolute left-0 mt-2 w-48 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50 pointer-events-none">
          <p className="font-semibold mb-1">Detected Draft Version</p>
          <p>{detectedDraft} schema is currently loaded.</p>
          <p className="mt-2 text-gray-300">
            Use JSON → Change Draft to migrate to a different version.
          </p>
        </div>
      )}
    </div>
  );
}
