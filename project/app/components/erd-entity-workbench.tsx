import { useEffect, useMemo, useState } from "react";
import { XmlInstanceForm } from "~/components/xml-instance-form";
import type { ErdModel } from "~/types/erd";
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(getErrorMessage(await response.text(), response.status));
  }
  return response.json() as Promise<T>;
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
    relationships: model.relationships.map(({ principalTable, dependentTable, foreignKeyColumns }) => ({
      principalTable,
      dependentTable,
      foreignKeyColumns,
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
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [editor, setEditor] = useState<EntityEditor | null>(null);
  const [selectedParents, setSelectedParents] = useState<Record<string, string>>({});
  const [formValue, setFormValue] = useState<unknown>(null);
  const [isSaving, setIsSaving] = useState(false);
  const selectedTable = snapshot?.tables.find((table) => table.id === selectedTableId) ?? null;

  const syncRequest = useMemo(() => toSyncRequest(model, workbenchId), [model, workbenchId]);
  const editorColumns = useMemo(
    () => selectedTable && editor ? getEditorColumns(selectedTable, editor) : [],
    [selectedTable, editor],
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
                setFormValue(null);
              }}
              disabled={!snapshot?.tables.length}
            >
              {snapshot?.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
            </select>
          </label>
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
