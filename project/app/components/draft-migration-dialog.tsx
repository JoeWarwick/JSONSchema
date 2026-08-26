import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog/dialog';
import { Button } from '../components/ui/button/button';
import {
  migrateSchemaBetweenDrafts,
  getMigrationPath,
  formatMigrationChanges,
  type SchemaDraft,
  type MigrationResult,
} from '../utils/draft-utils';

interface DraftMigrationDialogProps {
  open: boolean;
  sourceDraft: SchemaDraft;
  targetDraft: SchemaDraft;
  schema: Record<string, unknown>;
  onConfirm: (migratedSchema: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function DraftMigrationDialog({
  open,
  sourceDraft,
  targetDraft,
  schema,
  onConfirm,
  onCancel,
}: DraftMigrationDialogProps) {
  const [migration, setMigration] = useState<MigrationResult | null>(null);
  const [formattedChanges, setFormattedChanges] = useState<string[]>([]);

  useEffect(() => {
    if (open && sourceDraft !== targetDraft) {
      try {
        const result = migrateSchemaBetweenDrafts(schema, sourceDraft, targetDraft);
        setMigration(result);
        setFormattedChanges(formatMigrationChanges(result.changes));
      } catch (error) {
        console.error('Migration failed:', error);
        setMigration(null);
      }
    }
  }, [open, sourceDraft, targetDraft, schema]);

  const path = getMigrationPath(sourceDraft, targetDraft);
  const hasChanges = migration?.changes.length ?? 0 > 0;
  const hasBreakingChanges = migration?.changes.some(
    (c) => c.type === 'keyword_removed' || c.type === 'value_transformed'
  ) ?? false;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Migrate JSON Schema Draft</DialogTitle>
          <DialogDescription>
            This will migrate your schema from {sourceDraft} to {targetDraft}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Migration Path */}
          <div className="bg-gray-100 p-3 rounded">
            <p className="text-sm font-semibold mb-2">Migration Path:</p>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              {path.map((draft, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">
                    {draft}
                  </span>
                  {index < path.length - 1 && (
                    <span className="text-gray-500">→</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Breaking Changes Warning */}
          {hasBreakingChanges && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
              <p className="text-sm font-semibold text-yellow-800 mb-1">
                ⚠️ Breaking Changes
              </p>
              <p className="text-sm text-yellow-700">
                Some changes during migration may affect schema validation behavior.
              </p>
            </div>
          )}

          {/* Changes */}
          {migration && hasChanges ? (
            <div>
              <p className="text-sm font-semibold mb-2">
                Changes that will be made ({migration.changes.length}):
              </p>
              <ul className="space-y-1 max-h-48 overflow-y-auto bg-gray-50 p-3 rounded text-sm border border-gray-200">
                {formattedChanges.map((change, index) => (
                  <li key={index} className="text-gray-700">
                    • {change}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              No keyword changes required for this migration.
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() => migration && onConfirm(migration.schema)}
            disabled={!migration}
          >
            Confirm Migration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
