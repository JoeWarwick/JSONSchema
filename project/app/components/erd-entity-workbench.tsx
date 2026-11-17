import { useContext, useEffect, useMemo, useState } from "react";
import { XmlInstanceForm } from "~/components/xml-instance-form";
import type { ErdModel } from "~/types/erd";
import { AddWorkbenchContext, WorkbenchContext } from "~/state/workbench-context";
import { contentFingerprint, createWorkbench } from "~/state/workspace";
import { getAuthSession } from "~/utils/auth-client";
import { createErdXmlTemplate, generateErdXsd } from "~/utils/erd-xsd";
import styles from "./erd-entity-workbench.module.css";

interface DatabaseColumn {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey?: boolean;
  defaultGeneration?: string;
}

interface DatabaseRelationship {
  principalTable: string;
  dependentTable: string;
  foreignKeyColumns: string[];
}

interface DatabaseRecord {
  rowId: number;
  values: Record<string, unknown>;
}

interface DatabaseTable {
  id: string;
  name: string;
  columns: DatabaseColumn[];
  records: DatabaseRecord[];
}

interface DatabaseSnapshot {
  tables: DatabaseTable[];
  relationships: DatabaseRelationship[];
}

interface ManyToManyCollection {
  id: string;
  junctionTable: DatabaseTable;
  parentTable: DatabaseTable;
  parentRelationship: DatabaseRelationship;
  targetRelationship: DatabaseRelationship;
  targetTable: DatabaseTable;
  reverseSelfReference: boolean;
}

interface LinkedRecord {
  junctionRecord: DatabaseRecord;
  targetRecord: DatabaseRecord | null;
}

interface ErdEntityWorkbenchProps {
  model: ErdModel;
  workbenchId: string;
}

type EntityEditor =
  | { kind: "create" }
  | { kind: "edit"; record: DatabaseRecord };

const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";

function getErrorMessage(body: string, status: number): string {
  if (!body.trim()) return `Entity database request failed (${status}).`;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const problem = parsed as Record<string, unknown>;
      if (typeof problem.detail === "string") return problem.detail;
      if (typeof problem.title === "string") return problem.title;
    }
  } catch {
    return body;
  }
  return body;
}

async function fetchErdApi(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const session = await getAuthSession();
    headers.set("X-CSRF-TOKEN", session.csrfToken);
  }
  return fetch(url, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers,
  });
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetchErdApi(url, init);
  if (!response.ok) {
    throw new Error(getErrorMessage(await response.text(), response.status));
  }
  return response.json() as Promise<T>;
}

async function requestOk(url: string, init: RequestInit): Promise<void> {
  const response = await fetchErdApi(url, init);
  if (!response.ok) {
    throw new Error(getErrorMessage(await response.text(), response.status));
  }
}

function toSyncRequest(model: ErdModel, workbenchId: string) {
  return {
    workbenchId,
    tables: model.tables.map(({ id, name, columns }) => ({
      id,
      name,
      columns: columns.map(({ name: columnName, type, isNullable, isPrimaryKey, defaultGeneration }) => ({
        name: columnName,
        type,
        isNullable,
        isPrimaryKey,
        defaultGeneration,
      })),
    })),
    relationships: model.relationships.map(({
      id,
      principalTable,
      dependentTable,
      foreignKeyColumns,
      principalCardinality,
      dependentCardinality,
      principalNavigation,
      dependentNavigation,
    }) => ({
      id,
      principalTable,
      dependentTable,
      foreignKeyColumns,
      principalCardinality,
      dependentCardinality,
      principalNavigation,
      dependentNavigation,
    })),
  };
}

function isIntegerIdentity(column: DatabaseColumn): boolean {
  return column.isPrimaryKey && /^(int|long|short)\??$/i.test(column.type.trim());
}

function getEditorColumns(table: DatabaseTable, editor: EntityEditor): DatabaseColumn[] {
  return table.columns.filter((column) =>
    !column.isForeignKey &&
    column.defaultGeneration !== "current-timestamp" &&
    !(editor.kind === "edit" && column.isPrimaryKey) &&
    !(editor.kind === "create" && isIntegerIdentity(column)),
  );
}

function getXsdType(type: string): string {
  switch (type.trim().replace(/\?$/, "").toLowerCase()) {
    case "int":
    case "long":
    case "short":
      return "xs:integer";
    case "decimal":
      return "xs:decimal";
    case "double":
    case "float":
      return "xs:double";
    default:
      return "xs:string";
  }
}

function createEditorSchema(columns: DatabaseColumn[]) {
  return {
    "xs:schema": {
      "@attributes": { "xmlns:xs": XSD_NAMESPACE },
      "xs:element": {
        "@attributes": { name: "Record" },
        "xs:complexType": {
          "xs:sequence": {
            "xs:element": columns.map((column) => ({
              "@attributes": {
                name: column.name,
                type: getXsdType(column.type),
                minOccurs: column.isNullable ? "0" : "1",
              },
            })),
          },
        },
      },
    },
  };
}

function getEditorText(column: DatabaseColumn, value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (column.type.trim().replace(/\?$/, "").toLowerCase() !== "bool") return text;
  return text === "1" || text.toLowerCase() === "true" ? "true" : "false";
}

function toXmlFormValue(columns: DatabaseColumn[], record?: DatabaseRecord) {
  return {
    Record: Object.fromEntries(columns.map((column) => [
      column.name,
      { _text: getEditorText(column, record?.values[column.name]) },
    ])),
  };
}

function getRelationshipKey(relationship: DatabaseRelationship): string {
  return `${relationship.dependentTable}:${relationship.principalTable}:${relationship.foreignKeyColumns.join(",")}`;
}

function findColumn(table: DatabaseTable, name: string): DatabaseColumn | undefined {
  return table.columns.find((column) => column.name.toLowerCase() === name.toLowerCase());
}

function relationshipsMatch(left: DatabaseRelationship, right: DatabaseRelationship): boolean {
  return left.dependentTable === right.dependentTable &&
    left.principalTable === right.principalTable &&
    left.foreignKeyColumns.length === right.foreignKeyColumns.length &&
    left.foreignKeyColumns.every((column, index) => column.toLowerCase() === right.foreignKeyColumns[index].toLowerCase());
}

function getManyToManyCollections(
  snapshot: DatabaseSnapshot,
  model: ErdModel,
  tableId: string,
): ManyToManyCollection[] {
  const collections: ManyToManyCollection[] = [];
  for (const junctionTable of snapshot.tables) {
    if (snapshot.relationships.some((relationship) => relationship.principalTable === junctionTable.id)) continue;
    const relationships = snapshot.relationships.filter((relationship) => relationship.dependentTable === junctionTable.id);
    if (relationships.length !== 2) continue;
    const [first, second] = relationships;
    const selfReference = first.principalTable === second.principalTable;
    const allForeignKeys = [...first.foreignKeyColumns, ...second.foreignKeyColumns];
    if (allForeignKeys.some((name, index) =>
      allForeignKeys.slice(index + 1).some((other) => name.toLowerCase() === other.toLowerCase()))) continue;

    for (const [index, parentRelationship] of relationships.entries()) {
      if (parentRelationship.principalTable !== tableId) continue;
      if (index === 1 && selfReference) continue;
      const relationshipDefinition = model.relationships.find((relationship) =>
        relationshipsMatch(relationship, parentRelationship));
      if (relationshipDefinition?.dependentCardinality !== "many") continue;

      const targetRelationship = relationships[1 - index];
      const parentTable = snapshot.tables.find((table) => table.id === parentRelationship.principalTable);
      const targetTable = snapshot.tables.find((table) => table.id === targetRelationship.principalTable);
      if (!parentTable || !targetTable) continue;
      collections.push({
        id: `${junctionTable.id}:${parentRelationship.foreignKeyColumns.join(",")}=>${targetRelationship.foreignKeyColumns.join(",")}`,
        junctionTable,
        parentTable,
        parentRelationship,
        targetRelationship,
        targetTable,
        reverseSelfReference: selfReference,
      });
    }
  }
  return collections;
}

function relationshipValues(
  relationship: DatabaseRelationship,
  principalTable: DatabaseTable,
  principalRecord: DatabaseRecord,
  junctionTable: DatabaseTable,
): Record<string, unknown> {
  const primaryKeys = principalTable.columns.filter((column) => column.isPrimaryKey);
  if (primaryKeys.length !== relationship.foreignKeyColumns.length) {
    throw new Error(`The relationship to "${principalTable.name}" has an incomplete key mapping.`);
  }
  return Object.fromEntries(relationship.foreignKeyColumns.map((name, index) => {
    const foreignKey = findColumn(junctionTable, name);
    if (!foreignKey) throw new Error(`Junction entity "${junctionTable.name}" is missing column "${name}".`);
    return [foreignKey.name, principalRecord.values[primaryKeys[index].name]];
  }));
}

function recordMatchesParent(
  junctionRecord: DatabaseRecord,
  relationship: DatabaseRelationship,
  junctionTable: DatabaseTable,
  parentTable: DatabaseTable,
  parentRecord: DatabaseRecord,
): boolean {
  const primaryKeys = parentTable.columns.filter((column) => column.isPrimaryKey);
  const foreignKeyValues = relationship.foreignKeyColumns.map((name) => {
    const column = findColumn(junctionTable, name);
    return column ? junctionRecord.values[column.name] : undefined;
  });
  return foreignKeyValues.every((value) => value !== undefined) &&
    sameKeyValues(foreignKeyValues, primaryKeys.map((column) => parentRecord.values[column.name]));
}

function getLinkedRecords(
  collection: ManyToManyCollection,
  parentRecord: DatabaseRecord,
): LinkedRecord[] {
  const targetKeys = collection.targetTable.columns.filter((column) => column.isPrimaryKey);
  const linked: LinkedRecord[] = [];
  for (const junctionRecord of collection.junctionTable.records) {
    const matchesParentSide = recordMatchesParent(
      junctionRecord,
      collection.parentRelationship,
      collection.junctionTable,
      collection.parentTable,
      parentRecord,
    );
    const reverseMatch = !matchesParentSide && collection.reverseSelfReference && recordMatchesParent(
      junctionRecord,
      collection.targetRelationship,
      collection.junctionTable,
      collection.parentTable,
      parentRecord,
    );
    if (!matchesParentSide && !reverseMatch) continue;
    const targetRelationship = reverseMatch ? collection.parentRelationship : collection.targetRelationship;
    const targetKeyValues = targetRelationship.foreignKeyColumns.map((name) => {
      const column = findColumn(collection.junctionTable, name);
      return column ? junctionRecord.values[column.name] : undefined;
    });
    linked.push({
      junctionRecord,
      targetRecord: collection.targetTable.records.find((record) =>
        sameKeyValues(targetKeyValues, targetKeys.map((column) => record.values[column.name]))) ?? null,
    });
  }
  return linked;
}

function hasRequiredAssociationFields(collection: ManyToManyCollection): boolean {
  const foreignKeys = new Set([
    ...collection.parentRelationship.foreignKeyColumns,
    ...collection.targetRelationship.foreignKeyColumns,
  ].map((name) => name.toLowerCase()));
  return collection.junctionTable.columns.some((column) =>
    !foreignKeys.has(column.name.toLowerCase()) &&
    !column.isNullable &&
    column.defaultGeneration !== "current-timestamp" &&
    !isIntegerIdentity(column));
}

function sameKeyValues(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => String(value) === String(right[index]));
}

function getRecordLabel(table: DatabaseTable, record: DatabaseRecord): string {
  const keys = table.columns.filter((column) => column.isPrimaryKey);
  const identity = keys.length
    ? keys.map((column) => `${column.name}: ${String(record.values[column.name] ?? "")}`).join(", ")
    : `Row ${record.rowId}`;
  const displayColumn = table.columns.find((column) => !column.isPrimaryKey && !column.isForeignKey);
  const displayValue = displayColumn ? record.values[displayColumn.name] : undefined;
  return displayValue == null || String(displayValue).trim() === ""
    ? identity
    : `${identity} — ${String(displayValue)}`;
}

function findCurrentParentValue(
  relationship: DatabaseRelationship,
  dependent: DatabaseTable,
  parent: DatabaseTable,
  record: DatabaseRecord | undefined,
): string {
  if (!record) return "";
  const foreignKeyValues = relationship.foreignKeyColumns.map((name) => {
    const column = findColumn(dependent, name);
    return column ? record.values[column.name] : undefined;
  });
  if (foreignKeyValues.some((value) => value == null)) return "";
  const principalKeys = parent.columns.filter((column) => column.isPrimaryKey);
  const matchingRecord = parent.records.find((candidate) =>
    sameKeyValues(foreignKeyValues, principalKeys.map((column) => candidate.values[column.name])),
  );
  return matchingRecord ? JSON.stringify(principalKeys.map((column) => matchingRecord.values[column.name])) : "";
}

export function ErdEntityWorkbench({ model, workbenchId }: ErdEntityWorkbenchProps) {
  const addWorkbench = useContext(AddWorkbenchContext);
  const { documentId } = useContext(WorkbenchContext);
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [editor, setEditor] = useState<EntityEditor | null>(null);
  const [selectedParents, setSelectedParents] = useState<Record<string, string>>({});
  const [collectionSelections, setCollectionSelections] = useState<Record<string, string>>({});
  const [formValue, setFormValue] = useState<unknown>(null);
  const [isSaving, setIsSaving] = useState(false);
  const selectedTable = snapshot?.tables.find((table) => table.id === selectedTableId) ?? null;

  const syncRequest = useMemo(() => toSyncRequest(model, workbenchId), [model, workbenchId]);
  const editorColumns = useMemo(
    () => selectedTable && editor ? getEditorColumns(selectedTable, editor) : [],
    [selectedTable, editor],
  );
  const collections = useMemo(
    () => snapshot && selectedTable ? getManyToManyCollections(snapshot, model, selectedTable.id) : [],
    [snapshot, model, selectedTable],
  );

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setEditor(null);
    setError(null);
    setIsLoading(true);
    void requestJson<DatabaseSnapshot>("/api/schema/erd-database/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(syncRequest),
    }).then((result) => {
      if (!cancelled) {
        const normalized = {
          ...result,
          tables: result.tables.map((table) => ({
            ...table,
            columns: table.columns.map((column) => ({
              ...column,
              isForeignKey: result.relationships.some((relationship) =>
                relationship.dependentTable === table.id &&
                relationship.foreignKeyColumns.some((name) => findColumn(table, name)?.name === column.name)),
            })),
          })),
        };
        setSnapshot(normalized);
        setSelectedTableId((current) => normalized.tables.some((table) => table.id === current)
          ? current
          : normalized.tables[0]?.id ?? "");
      }
    }).catch((requestError: unknown) => {
      if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not synchronize the ERD database.");
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [syncRequest]);

  const editorSchema = selectedTable && editor ? createEditorSchema(editorColumns) : null;
  const parentRelationships = snapshot?.relationships.filter((relationship) => relationship.dependentTable === selectedTableId) ?? [];

  const beginCreate = () => {
    if (!selectedTable) return;
    setSelectedParents({});
    setCollectionSelections({});
    setFormValue(toXmlFormValue(getEditorColumns(selectedTable, { kind: "create" })));
    setEditor({ kind: "create" });
  };

  const beginEdit = (record: DatabaseRecord) => {
    if (!selectedTable || !snapshot) return;
    const parents = Object.fromEntries(parentRelationships.map((relationship) => {
      const parent = snapshot.tables.find((table) => table.id === relationship.principalTable);
      const key = getRelationshipKey(relationship);
      return [key, parent
        ? findCurrentParentValue(relationship, selectedTable, parent, record)
        : ""];
    }));
    setSelectedParents(parents);
    setCollectionSelections({});
    setFormValue(toXmlFormValue(getEditorColumns(selectedTable, { kind: "edit", record }), record));
    setEditor({ kind: "edit", record });
  };

  const saveRecord = async () => {
    if (!selectedTable || !snapshot || !editor) return;
    setIsSaving(true);
    setError(null);
    try {
      const values: Record<string, unknown> = {};
      const xmlFields = formValue && typeof formValue === "object"
        ? (formValue as Record<string, unknown>).Record
        : null;
      if (xmlFields && typeof xmlFields === "object") {
        for (const column of editorColumns) {
          const field = (xmlFields as Record<string, unknown>)[column.name];
          const text = field && typeof field === "object"
            ? String((field as Record<string, unknown>)._text ?? (field as Record<string, unknown>)["#text"] ?? "")
            : field == null ? "" : String(field);
          values[column.name] = text === "" && column.isNullable ? null : text;
        }
      }

      for (const relationship of parentRelationships) {
        const key = getRelationshipKey(relationship);
        const parentKeyValue = selectedParents[key] ?? "";
        const parentTable = snapshot.tables.find((table) => table.id === relationship.principalTable);
        const parentKeys = parentTable?.columns.filter((column) => column.isPrimaryKey) ?? [];
        if (!parentKeyValue) {
          for (const columnName of relationship.foreignKeyColumns) values[columnName] = null;
          continue;
        }
        const keyValues = JSON.parse(parentKeyValue) as unknown[];
        if (keyValues.length !== parentKeys.length) {
          throw new Error(`The selected parent key for "${parentTable?.name ?? relationship.principalTable}" is incomplete.`);
        }
        relationship.foreignKeyColumns.forEach((columnName, index) => {
          values[columnName] = keyValues[index];
        });
      }

      const savedRecord = await requestJson<DatabaseRecord>(
        `/api/schema/erd-database/${encodeURIComponent(workbenchId)}/records`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableId: selectedTable.id,
            rowId: editor.kind === "edit" ? editor.record.rowId : undefined,
            values,
          }),
        },
      );
      setSnapshot((current) => current && ({
        ...current,
        tables: current.tables.map((table) => table.id !== selectedTable.id
          ? table
          : {
            ...table,
            records: editor.kind === "edit"
              ? table.records.map((record) => record.rowId === savedRecord.rowId ? savedRecord : record)
              : [...table.records, savedRecord],
          }),
      }));
      setEditor(null);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this entity.");
    } finally {
      setIsSaving(false);
    }
  };

  const openXmlWorkbench = () => {
    if (!selectedTable || !addWorkbench) return;
    setError(null);
    try {
      const workbench = createWorkbench(
        "xml",
        crypto.randomUUID(),
        `${selectedTable.name} XML`,
      );
      workbench.entries["schema-sculptor-schema-xml"] = JSON.stringify(
        generateErdXsd(model, selectedTable.id),
      );
      workbench.entries["schema-sculptor-instance-xml"] = JSON.stringify(
        createErdXmlTemplate(model, selectedTable.id),
      );
      workbench.entries["schema-sculptor-erd-origin"] = JSON.stringify({
        workbenchId,
        sourceWorkbenchId: documentId ?? workbenchId,
        rootTableId: selectedTable.id,
      });
      workbench.savedContent = contentFingerprint(workbench);
      addWorkbench(workbench, true);
    } catch (schemaError: unknown) {
      setError(schemaError instanceof Error ? schemaError.message : "Could not generate the entity XML workbench.");
    }
  };

  const linkRelatedRecord = async (collection: ManyToManyCollection) => {
    if (!snapshot || editor?.kind !== "edit") return;
    const targetRecord = collection.targetTable.records.find((record) =>
      String(record.rowId) === collectionSelections[collection.id]);
    if (!targetRecord) {
      setError(`Select a ${collection.targetTable.name} record to link.`);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const values = {
        ...relationshipValues(
          collection.parentRelationship,
          collection.parentTable,
          editor.record,
          collection.junctionTable,
        ),
        ...relationshipValues(
          collection.targetRelationship,
          collection.targetTable,
          targetRecord,
          collection.junctionTable,
        ),
      };
      const linkedRecord = await requestJson<DatabaseRecord>(
        `/api/schema/erd-database/${encodeURIComponent(workbenchId)}/records`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId: collection.junctionTable.id, values }),
        },
      );
      setSnapshot((current) => current && ({
        ...current,
        tables: current.tables.map((table) => table.id !== collection.junctionTable.id
          ? table
          : { ...table, records: [...table.records, linkedRecord] }),
      }));
      setCollectionSelections((current) => ({ ...current, [collection.id]: "" }));
    } catch (linkError: unknown) {
      setError(linkError instanceof Error ? linkError.message : "Could not link these entities.");
    } finally {
      setIsSaving(false);
    }
  };

  const unlinkRelatedRecord = async (collection: ManyToManyCollection, junctionRecord: DatabaseRecord) => {
    setIsSaving(true);
    setError(null);
    try {
      await requestOk(
        `/api/schema/erd-database/${encodeURIComponent(workbenchId)}/relationships/unlink`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId: collection.junctionTable.id, rowId: junctionRecord.rowId }),
        },
      );
      setSnapshot((current) => current && ({
        ...current,
        tables: current.tables.map((table) => table.id !== collection.junctionTable.id
          ? table
          : { ...table, records: table.records.filter((record) => record.rowId !== junctionRecord.rowId) }),
      }));
    } catch (unlinkError: unknown) {
      setError(unlinkError instanceof Error ? unlinkError.message : "Could not unlink these entities.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className={styles.status} role="status">Synchronizing the ERD database…</div>;
  }

  return (
    <div className={styles.workbench}>
      <section className={styles.entityList} aria-label="Entity records">
        <div className={styles.sectionHeader}>
          <label className={styles.tablePicker}>
            Entity
            <select
              aria-label="Entity"
              value={selectedTableId}
              onChange={(event) => {
                setSelectedTableId(event.target.value);
                setEditor(null);
                setSelectedParents({});
                setCollectionSelections({});
                setFormValue(null);
              }}
              disabled={!snapshot?.tables.length}
            >
              {snapshot?.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={openXmlWorkbench}
            disabled={!selectedTable || !addWorkbench}
          >
            Open XML Schema
          </button>
          <button type="button" className={styles.primaryButton} onClick={beginCreate} disabled={!selectedTable}>
            Add entity
          </button>
        </div>
        {selectedTable ? (
          selectedTable.records.length > 0 ? (
            <ul className={styles.recordList}>
              {selectedTable.records.map((record) => (
                <li key={record.rowId}>
                  <span>{getRecordLabel(selectedTable, record)}</span>
                  <button type="button" onClick={() => beginEdit(record)} aria-label={`Edit ${getRecordLabel(selectedTable, record)}`}>
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptyState}>No {selectedTable.name} records yet.</p>
        ) : <p className={styles.emptyState}>Create an entity in the Entity Graph first.</p>}
      </section>

      <section className={styles.editor} aria-label="Entity editor">
        {error && <div className={styles.error} role="alert">{error}</div>}
        {editor && selectedTable && editorSchema ? (
          <>
            <div className={styles.sectionHeader}>
              <h2>{editor.kind === "create" ? `Add ${selectedTable.name}` : `Edit ${selectedTable.name}`}</h2>
              <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)} disabled={isSaving}>
                Cancel
              </button>
            </div>
            {parentRelationships.map((relationship) => {
              const parentTable = snapshot?.tables.find((table) => table.id === relationship.principalTable);
              const dependentColumns = relationship.foreignKeyColumns.map((name) =>
                findColumn(selectedTable, name),
              );
              const optional = dependentColumns.every((column) => column?.isNullable);
              const relationshipKey = getRelationshipKey(relationship);
              const parentKeys = parentTable?.columns.filter((column) => column.isPrimaryKey) ?? [];
              return (
                <label key={relationshipKey} className={styles.parentPicker}>
                  Parent: {parentTable?.name ?? relationship.principalTable}
                  <select
                    aria-label={`Parent: ${parentTable?.name ?? relationship.principalTable}`}
                    value={selectedParents[relationshipKey] ?? ""}
                    onChange={(event) => setSelectedParents((current) => ({
                      ...current,
                      [relationshipKey]: event.target.value,
                    }))}
                    disabled={isSaving || !parentTable?.records.length}
                  >
                    {optional && <option value="">No parent</option>}
                    {!optional && <option value="">Select a parent…</option>}
                    {parentTable?.records.map((record) => {
                      const keyValues = parentKeys.map((column) => record.values[column.name]);
                      const keyLabel = parentKeys.map((column) => `${column.name}: ${record.values[column.name] ?? ""}`).join(", ");
                      return <option key={record.rowId} value={JSON.stringify(keyValues)}>{keyLabel}</option>;
                    })}
                  </select>
                  {!parentTable?.records.length && <span className={styles.helpText}>Add a {parentTable?.name ?? "parent"} record before selecting it.</span>}
                </label>
              );
            })}
            {editorColumns.length > 0 ? (
              <XmlInstanceForm
                schema={editorSchema}
                rootSchema={editorSchema}
                value={formValue}
                onChange={setFormValue}
                autoExpandAll
                xsdAuthoring={false}
                showRootElementTriggers={false}
                expansionStateKey={`erd-entity-${selectedTable.id}`}
              />
            ) : <p className={styles.emptyState}>This entity has no additional fields to edit.</p>}
            {editor.kind === "edit" && collections.length > 0 && (
              <section className={styles.collections} aria-label={`Related entities for ${selectedTable.name}`}>
                <h3>Related entities</h3>
                {collections.map((collection) => {
                  const linkedRecords = getLinkedRecords(collection, editor.record);
                  const linkedTargetIds = new Set(linkedRecords.flatMap(({ targetRecord }) =>
                    targetRecord ? [targetRecord.rowId] : []));
                  const availableRecords = collection.targetTable.records.filter((record) =>
                    !linkedTargetIds.has(record.rowId));
                  const requiresManualEntry = hasRequiredAssociationFields(collection);
                  return (
                    <div className={styles.collection} key={collection.id}>
                      <h4>{collection.targetTable.name}</h4>
                      {linkedRecords.length > 0 ? (
                        <ul className={styles.recordList}>
                          {linkedRecords.map(({ junctionRecord, targetRecord }) => (
                            <li key={junctionRecord.rowId}>
                              <span>{targetRecord
                                ? getRecordLabel(collection.targetTable, targetRecord)
                                : "Referenced record is unavailable"}</span>
                              <button
                                type="button"
                                onClick={() => void unlinkRelatedRecord(collection, junctionRecord)}
                                disabled={isSaving}
                                aria-label={`Remove link to ${collection.targetTable.name} record`}
                              >
                                Remove link
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : <p className={styles.emptyState}>No related {collection.targetTable.name} records.</p>}
                      <div className={styles.linkControls}>
                        <label className={styles.parentPicker}>
                          Add {collection.targetTable.name}
                          <select
                            aria-label={`Add ${collection.targetTable.name}`}
                            value={collectionSelections[collection.id] ?? ""}
                            onChange={(event) => setCollectionSelections((current) => ({
                              ...current,
                              [collection.id]: event.target.value,
                            }))}
                            disabled={isSaving || availableRecords.length === 0 || requiresManualEntry}
                          >
                            <option value="">
                              {availableRecords.length > 0 ? "Select a record…" : "No unlinked records"}
                            </option>
                            {availableRecords.map((record) => (
                              <option key={record.rowId} value={record.rowId}>
                                {getRecordLabel(collection.targetTable, record)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void linkRelatedRecord(collection)}
                          disabled={isSaving || requiresManualEntry || !collectionSelections[collection.id]}
                        >
                          {isSaving ? "Saving…" : "Link"}
                        </button>
                      </div>
                      {requiresManualEntry && (
                        <p className={styles.helpText}>
                          Create this association in the {collection.junctionTable.name} entity to fill its required fields.
                        </p>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
            <div className={styles.formActions}>
              <button type="button" className={styles.primaryButton} onClick={() => void saveRecord()} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save entity"}
              </button>
            </div>
          </>
        ) : !error ? (
          <p className={styles.emptyState}>Select an entity record to edit, or add a new one.</p>
        ) : null}
      </section>
    </div>
  );
}
