import React from "react";
import styles from "./xml-editor-layout.module.css";

export function FormActionRow({ children }: { children: React.ReactNode }) {
  return <div className={styles.actionRow} data-field-group="actions">{children}</div>;
}

export type FieldLayout =
  | { kind: "group"; group: string }
  | { kind: "short" }
  | { kind: "full" };

export function getFieldLayout(
  type?: string | null,
  group?: string
): FieldLayout {
  if (group) return { kind: "group", group };
  const localType = type?.replace(/^.*:/, "");
  return localType &&
    [
      "boolean",
      "byte",
      "unsignedByte",
      "short",
      "unsignedShort",
      "int",
      "unsignedInt",
      "long",
      "unsignedLong",
      "integer",
      "nonNegativeInteger",
      "positiveInteger",
      "nonPositiveInteger",
      "negativeInteger",
      "decimal",
      "float",
      "double",
    ].includes(localType)
    ? { kind: "short" }
    : { kind: "full" };
}

export function FormFieldGroup({
  group,
  children,
}: {
  group: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.fieldRow} data-field-group={group}>
      {children}
    </div>
  );
}

interface FormField {
  id: string;
  content: React.ReactNode;
  layout: FieldLayout;
}

export function FormFieldLayout({ fields }: { fields: readonly FormField[] }) {
  const rows: FormField[][] = [];
  for (const field of fields) {
    const row = rows[rows.length - 1];
    const previous = row?.[row.length - 1];
    const joinsGroup =
      field.layout.kind === "group" &&
      previous?.layout.kind === "group" &&
      field.layout.group === previous.layout.group;
    const joinsShort =
      field.layout.kind === "short" &&
      previous?.layout.kind === "short" &&
      row.length < 2;
    if (joinsGroup || joinsShort) row.push(field);
    else rows.push([field]);
  }

  return (
    <>
      {rows.map((row) =>
        row.length === 1 ? (
          <React.Fragment key={row[0].id}>{row[0].content}</React.Fragment>
        ) : (
          <FormFieldGroup
            key={row[0].id}
            group={
              row[0].layout.kind === "group" ? row[0].layout.group : "short"
            }
          >
            {row.map((field) => (
              <div key={field.id} className={styles.field}>
                {field.content}
              </div>
            ))}
          </FormFieldGroup>
        )
      )}
    </>
  );
}

export function AutoFormFields({ children }: { children: React.ReactNode }) {
  const fields = React.Children.toArray(children).map((content, index) => {
    const props = React.isValidElement<{
      "data-field-type"?: string;
      "data-layout-group"?: string;
    }>(content)
      ? content.props
      : {};
    return {
      id: React.isValidElement(content)
        ? String(content.key ?? index)
        : String(index),
      content,
      layout: getFieldLayout(
        props["data-field-type"],
        props["data-layout-group"]
      ),
    };
  });
  return <FormFieldLayout fields={fields} />;
}
