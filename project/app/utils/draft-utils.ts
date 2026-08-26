/**
 * Multi-draft JSON Schema support utilities
 * Handles draft detection, mapping, and schema migration between drafts
 */

/**
 * Supported JSON Schema drafts
 */
export type SchemaDraft = 'Draft 4' | 'Draft 6' | 'Draft 7' | 'Draft 2019-09' | 'Draft 2020-12';

/**
 * Internal dialect codes used by the backend
 */
export type DialectCode = 'draft-04' | 'draft-06' | 'draft-07' | 'draft-2019-09' | 'draft-2020-12';

/**
 * Draft progression order (older to newer)
 */
export const DRAFT_PROGRESSION: SchemaDraft[] = [
  'Draft 4',
  'Draft 6',
  'Draft 7',
  'Draft 2019-09',
  'Draft 2020-12'
];

/**
 * Maps $schema URIs to human-friendly draft labels
 */
export const SCHEMA_URI_TO_DRAFT_MAP: Record<string, SchemaDraft> = {
  'http://json-schema.org/draft-04/schema': 'Draft 4',
  'http://json-schema.org/draft-04/schema#': 'Draft 4',
  'https://json-schema.org/draft-04/schema': 'Draft 4',
  'https://json-schema.org/draft-04/schema#': 'Draft 4',
  
  'http://json-schema.org/draft-06/schema': 'Draft 6',
  'http://json-schema.org/draft-06/schema#': 'Draft 6',
  'https://json-schema.org/draft-06/schema': 'Draft 6',
  'https://json-schema.org/draft-06/schema#': 'Draft 6',
  
  'http://json-schema.org/draft-07/schema': 'Draft 7',
  'http://json-schema.org/draft-07/schema#': 'Draft 7',
  'https://json-schema.org/draft-07/schema': 'Draft 7',
  'https://json-schema.org/draft-07/schema#': 'Draft 7',
  
  'https://json-schema.org/draft/2019-09/schema': 'Draft 2019-09',
  'https://json-schema.org/draft/2019-09/schema#': 'Draft 2019-09',
  
  'https://json-schema.org/draft/2020-12/schema': 'Draft 2020-12',
  'https://json-schema.org/draft/2020-12/schema#': 'Draft 2020-12',
};

/**
 * Maps draft labels to their canonical $schema URIs
 */
export const DRAFT_TO_SCHEMA_URI_MAP: Record<SchemaDraft, string> = {
  'Draft 4': 'http://json-schema.org/draft-04/schema#',
  'Draft 6': 'http://json-schema.org/draft-06/schema#',
  'Draft 7': 'http://json-schema.org/draft-07/schema#',
  'Draft 2019-09': 'https://json-schema.org/draft/2019-09/schema#',
  'Draft 2020-12': 'https://json-schema.org/draft/2020-12/schema#',
};

/**
 * Keywords that are draft-specific (only appear in certain drafts)
 */
export const DRAFT_SPECIFIC_KEYWORDS: Record<SchemaDraft, Set<string>> = {
  'Draft 4': new Set(['definitions', 'additionalItems', 'dependencies']),
  'Draft 6': new Set(['definitions', 'additionalItems', 'dependencies', '$comment']),
  'Draft 7': new Set(['definitions', 'additionalItems', 'dependencies', '$comment', 'examples', 'const']),
  'Draft 2019-09': new Set(['$defs', 'prefixItems', 'dependentSchemas', '$comment', 'examples', 'const', 'unevaluatedProperties', 'unevaluatedItems']),
  'Draft 2020-12': new Set(['$defs', 'prefixItems', 'dependentSchemas', '$comment', 'examples', 'const', 'unevaluatedProperties', 'unevaluatedItems', '$dynamicRef', '$dynamicAnchor']),
};

/**
 * Migration result describing what changed
 */
export interface MigrationResult {
  schema: Record<string, unknown>;
  changes: MigrationChange[];
}

/**
 * Description of a single migration change
 */
export interface MigrationChange {
  type: 'keyword_renamed' | 'keyword_added' | 'keyword_removed' | 'value_transformed';
  path: string;
  fromKeyword?: string;
  toKeyword?: string;
  description: string;
}

/**
 * Get the draft progression index
 */
function getDraftIndex(draft: SchemaDraft): number {
  return DRAFT_PROGRESSION.indexOf(draft);
}

/**
 * Detect schema draft from a schema object's $schema property
 */
export function detectDraftFromSchema(schema: Record<string, unknown> | null | undefined): SchemaDraft | null {
  if (!schema || typeof schema !== 'object') return null;
  
  const schemaUri = schema.$schema;
  if (typeof schemaUri !== 'string') return null;
  
  const draft = SCHEMA_URI_TO_DRAFT_MAP[schemaUri];
  if (draft) return draft;
  
  // Default to Draft 7 if URI not recognized
  return 'Draft 7';
}

/**
 * Detect schema draft from detected draft string returned by backend
 */
export function detectDraftFromBackend(detectedDraft: string | null | undefined): SchemaDraft | null {
  if (!detectedDraft) return null;
  
  // Try direct match first
  if (DRAFT_PROGRESSION.includes(detectedDraft as SchemaDraft)) {
    return detectedDraft as SchemaDraft;
  }
  
  // Try mapping from URI
  const draft = SCHEMA_URI_TO_DRAFT_MAP[detectedDraft];
  if (draft) return draft;
  
  // Default to Draft 7 if detection failed
  return 'Draft 7';
}

/**
 * Get the canonical $schema URI for a draft
 */
export function getDraftSchemaUri(draft: SchemaDraft): string {
  return DRAFT_TO_SCHEMA_URI_MAP[draft];
}

/**
 * Migrate a single step from source draft to next draft in progression
 */
function migrateOneStep(schema: Record<string, unknown>, fromDraft: SchemaDraft, toDraft: SchemaDraft): MigrationResult {
  const changes: MigrationChange[] = [];
  const migrated = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

  // Update $schema URI
  const newUri = getDraftSchemaUri(toDraft);
  if (migrated.$schema) {
    changes.push({
      type: 'keyword_renamed',
      path: '$schema',
      fromKeyword: String(migrated.$schema),
      toKeyword: newUri,
      description: `Updated $schema to ${toDraft} canonical URI`
    });
  }
  migrated.$schema = newUri;

  // Draft 7 → 2019-09: definitions → $defs, additionalItems → prefixItems, dependencies → dependentSchemas
  if (fromDraft === 'Draft 7' && toDraft === 'Draft 2019-09') {
    // Migrate definitions to $defs
    if (migrated.definitions && typeof migrated.definitions === 'object') {
      migrated.$defs = migrated.definitions;
      delete migrated.definitions;
      changes.push({
        type: 'keyword_renamed',
        path: 'root',
        fromKeyword: 'definitions',
        toKeyword: '$defs',
        description: 'Renamed definitions to $defs'
      });
    }

    // Migrate dependencies to dependentSchemas
    if (migrated.dependencies && typeof migrated.dependencies === 'object') {
      migrated.dependentSchemas = migrated.dependencies;
      delete migrated.dependencies;
      changes.push({
        type: 'keyword_renamed',
        path: 'root',
        fromKeyword: 'dependencies',
        toKeyword: 'dependentSchemas',
        description: 'Renamed dependencies to dependentSchemas'
      });
    }

    // Note: additionalItems → prefixItems requires more complex transformation
    // For now, we preserve additionalItems and note it for manual review
    if (migrated.additionalItems !== undefined) {
      changes.push({
        type: 'keyword_renamed',
        path: 'root',
        fromKeyword: 'additionalItems',
        toKeyword: 'prefixItems',
        description: 'Note: additionalItems semantic has changed in 2019-09; manual review recommended'
      });
    }
  }

  // 2019-09 → 2020-12: Same keyword changes (no additional mapping needed)
  if (fromDraft === 'Draft 2019-09' && toDraft === 'Draft 2020-12') {
    // No breaking changes in keyword names between these versions
    changes.push({
      type: 'keyword_added',
      path: 'root',
      description: 'Draft 2020-12 adds $dynamicRef and $dynamicAnchor support'
    });
  }

  // Reverse migration: 2019-09 → Draft 7
  if (fromDraft === 'Draft 2019-09' && toDraft === 'Draft 7') {
    // Migrate $defs to definitions
    if (migrated.$defs && typeof migrated.$defs === 'object') {
      migrated.definitions = migrated.$defs;
      delete migrated.$defs;
      changes.push({
        type: 'keyword_renamed',
        path: 'root',
        fromKeyword: '$defs',
        toKeyword: 'definitions',
        description: 'Renamed $defs to definitions'
      });
    }

    // Migrate dependentSchemas to dependencies
    if (migrated.dependentSchemas && typeof migrated.dependentSchemas === 'object') {
      migrated.dependencies = migrated.dependentSchemas;
      delete migrated.dependentSchemas;
      changes.push({
        type: 'keyword_renamed',
        path: 'root',
        fromKeyword: 'dependentSchemas',
        toKeyword: 'dependencies',
        description: 'Renamed dependentSchemas to dependencies'
      });
    }

    // Remove 2019-09 specific keywords
    if (migrated.unevaluatedProperties !== undefined) {
      delete migrated.unevaluatedProperties;
      changes.push({
        type: 'keyword_removed',
        path: 'root',
        toKeyword: 'unevaluatedProperties',
        description: 'Removed unevaluatedProperties (not in Draft 7)'
      });
    }
    if (migrated.unevaluatedItems !== undefined) {
      delete migrated.unevaluatedItems;
      changes.push({
        type: 'keyword_removed',
        path: 'root',
        toKeyword: 'unevaluatedItems',
        description: 'Removed unevaluatedItems (not in Draft 7)'
      });
    }
  }

  // Reverse migration: 2020-12 → 2019-09 (same as 2019-09 → Draft 7 but keep $defs)
  if (fromDraft === 'Draft 2020-12' && toDraft === 'Draft 2019-09') {
    // Remove 2020-12 specific keywords
    if (migrated.$dynamicRef !== undefined) {
      delete migrated.$dynamicRef;
      changes.push({
        type: 'keyword_removed',
        path: 'root',
        toKeyword: '$dynamicRef',
        description: 'Removed $dynamicRef (introduced in Draft 2020-12)'
      });
    }
    if (migrated.$dynamicAnchor !== undefined) {
      delete migrated.$dynamicAnchor;
      changes.push({
        type: 'keyword_removed',
        path: 'root',
        toKeyword: '$dynamicAnchor',
        description: 'Removed $dynamicAnchor (introduced in Draft 2020-12)'
      });
    }
  }

  return { schema: migrated, changes };
}

/**
 * Migrate schema from source draft to target draft through intermediate drafts
 * Returns the migrated schema and list of all changes made
 */
export function migrateSchemaBetweenDrafts(
  schema: Record<string, unknown>,
  sourceDraft: SchemaDraft,
  targetDraft: SchemaDraft
): MigrationResult {
  if (sourceDraft === targetDraft) {
    return { schema, changes: [] };
  }

  const sourceIndex = getDraftIndex(sourceDraft);
  const targetIndex = getDraftIndex(targetDraft);

  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error(`Invalid draft: source=${sourceDraft}, target=${targetDraft}`);
  }

  let currentSchema = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const allChanges: MigrationChange[] = [];
  const direction = sourceIndex < targetIndex ? 1 : -1;

  // Migrate through intermediate drafts
  let currentDraft = sourceDraft;
  while (currentDraft !== targetDraft) {
    const currentIndex = getDraftIndex(currentDraft);
    const nextDraft = DRAFT_PROGRESSION[currentIndex + direction] as SchemaDraft;

    const result = migrateOneStep(currentSchema, currentDraft, nextDraft);
    currentSchema = result.schema;
    allChanges.push(...result.changes);
    currentDraft = nextDraft;
  }

  return { schema: currentSchema, changes: allChanges };
}

/**
 * Get the migration path between two drafts
 */
export function getMigrationPath(sourceDraft: SchemaDraft, targetDraft: SchemaDraft): SchemaDraft[] {
  if (sourceDraft === targetDraft) {
    return [sourceDraft];
  }

  const sourceIndex = getDraftIndex(sourceDraft);
  const targetIndex = getDraftIndex(targetDraft);
  const path: SchemaDraft[] = [];

  if (sourceIndex < targetIndex) {
    // Forward migration
    for (let i = sourceIndex; i <= targetIndex; i++) {
      path.push(DRAFT_PROGRESSION[i] as SchemaDraft);
    }
  } else {
    // Backward migration
    for (let i = sourceIndex; i >= targetIndex; i--) {
      path.push(DRAFT_PROGRESSION[i] as SchemaDraft);
    }
  }

  return path;
}

/**
 * Check if a draft can be a target for migration from current draft
 */
export function canMigrateTo(currentDraft: SchemaDraft, targetDraft: SchemaDraft): boolean {
  return getDraftIndex(currentDraft) >= 0 && getDraftIndex(targetDraft) >= 0;
}

/**
 * Format migration changes for display
 */
export function formatMigrationChanges(changes: MigrationChange[]): string[] {
  return changes.map(change => {
    switch (change.type) {
      case 'keyword_renamed':
        return `${change.fromKeyword} → ${change.toKeyword}: ${change.description}`;
      case 'keyword_added':
        return `+ ${change.description}`;
      case 'keyword_removed':
        return `- ${change.toKeyword}: ${change.description}`;
      case 'value_transformed':
        return `⚠ ${change.description}`;
      default:
        return change.description;
    }
  });
}
