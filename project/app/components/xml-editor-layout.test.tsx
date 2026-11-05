import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { XmlNodeRhsEditor as GraphEditor } from "./xml-rhs-editors";
import { XmlNodeRhsEditor as FormEditor } from "./xml-instance-rhs-editors";
import type { XmlNodeRhsEditorProps } from "./types";
import { AutoFormFields, getFieldLayout } from "./form-field-layout";
import { XmlInstanceForm } from "./xml-instance-form";
import { TooltipProvider } from "./ui/tooltip/tooltip";
import { parseMarkup, serializeMarkup } from "../utils/markup";

describe.each([
  ["graph", GraphEditor],
  ["form", FormEditor],
] as const)("%s compact editor fields", (_surface, Editor) => {
  test.each([
    ["element", false],
    ["element", true],
    ["attribute", false],
    ["attribute", true],
  ] as const)("%s fields share rows (read-only: %s)", (kind, readOnly) => {
    const node: NonNullable<XmlNodeRhsEditorProps["node"]> = {
      id: "field",
      position: { x: 0, y: 0 },
      data: {
        xmlNodeKind: kind,
        xmlName: "example",
        xmlElementType: "xs:string",
        xmlAttributeType: "xs:string",
        xmlAttributeUse: "optional",
        xmlWidget: "email",
        ...(readOnly ? { xmlReadOnlySource: "shared.xsd" } : {}),
      },
    };
    const onChange = jest.fn();
    render(<Editor node={node} onChange={onChange} />);
    const prefix = kind === "element" ? "Element" : "Attribute";
    const name = screen.getByLabelText(`${prefix} Name`);
    const type = screen.getByLabelText(`${prefix} Type`);
    expect(name.closest("label")!.parentElement).toBe(
      type.closest("label")!.parentElement
    );
    expect(name.closest("[data-field-group]")).toHaveAttribute(
      "data-field-group",
      "identity"
    );
    if (kind === "attribute") {
      const use = screen.getByLabelText("Attribute Use");
      const widget = screen.getByLabelText("Attribute Widget");
      expect(use.closest("label")!.parentElement).toBe(
        widget.closest("label")!.parentElement
      );
      if (!readOnly) {
        fireEvent.change(use, { target: { value: "required" } });
        expect(onChange).toHaveBeenLastCalledWith({
          id: "field",
          xmlAttributeUse: "required",
        });
        fireEvent.change(widget, { target: { value: "color" } });
        expect(onChange).toHaveBeenLastCalledWith({
          id: "field",
          xmlWidget: "color",
        });
      }
    }
    if (readOnly) {
      expect(name).toBeDisabled();
      expect(type).toBeDisabled();
    } else {
      if (kind === "element") {
        const convert = screen.getByRole("button", { name: "Convert to ComplexType" });
        const actions = convert.closest('[data-field-group="actions"]');
        expect(actions).not.toBeNull();
        expect(screen.getByLabelText("Global Reference").closest('[data-field-group="actions"]')).toBe(actions);
        expect(screen.getByLabelText("Mixed Content").closest('[data-field-group="actions"]')).toBe(actions);
        expect(convert).toHaveStyle({ whiteSpace: "nowrap" });
        expect(convert.parentElement).toHaveStyle({ display: "flex", alignItems: "center" });
        expect(convert.parentElement).not.toHaveStyle({ flexDirection: "column" });
        fireEvent.click(convert);
        expect(onChange).toHaveBeenLastCalledWith({ id: "field", xmlConvertToComplexType: true });
      }
      fireEvent.change(name, { target: { value: "renamed" } });
      fireEvent.blur(name);
      expect(onChange).toHaveBeenLastCalledWith({
        id: "field",
        xmlName: "renamed",
      });
      fireEvent.change(type, { target: { value: "xs:boolean" } });
      expect(onChange).toHaveBeenLastCalledWith({
        id: "field",
        [kind === "element" ? "xmlElementType" : "xmlAttributeType"]:
          "xs:boolean",
      });
    }
  });
});
describe("generic field layout", () => {
  test("explicit groups override type sizing without reordering fields", () => {
    expect(getFieldLayout("xs:int")).toEqual({ kind: "short" });
    expect(getFieldLayout("xs:string")).toEqual({ kind: "full" });
    expect(getFieldLayout("xs:string", "identity")).toEqual({
      kind: "group",
      group: "identity",
    });
    const { container } = render(
      <AutoFormFields>
        <div data-layout-group="identity">Name</div>
        <div data-layout-group="identity">Type</div>
        <div data-field-type="xs:int">Count</div>
        <div data-field-type="xs:boolean">Enabled</div>
        <div>Description</div>
        <div data-field-type="xs:int">Last</div>
      </AutoFormFields>
    );
    expect(
      container.querySelector('[data-field-group="identity"]')
    ).toHaveTextContent("NameType");
    expect(
      container.querySelector('[data-field-group="short"]')
    ).toHaveTextContent("CountEnabled");
    expect(container.textContent).toBe("NameTypeCountEnabledDescriptionLast");
  });

  test("instance integer fields pair automatically and declarative groups preserve edits", () => {
    const schema = parseMarkup(
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
            <xs:element name="record"><xs:complexType><xs:sequence>
              <xs:element name="count" type="xs:int"/><xs:element name="limit" type="xs:int"/>
              <xs:element name="name" type="xs:string"/><xs:element name="code" type="xs:string"/>
              <xs:element name="notes" type="xs:string"/>
            </xs:sequence>
            <xs:attribute name="start" type="xs:int" use="required"/>
            <xs:attribute name="end" type="xs:int" use="required"/>
            </xs:complexType></xs:element></xs:schema>`,
      "xml"
    );
    let latest = parseMarkup(
      '<record start="1" end="10"><count>2</count><limit>8</limit><name>A</name><code>B</code><notes>Long text</notes></record>',
      "xml"
    );
    function Editor() {
      const [value, setValue] = React.useState(latest);
      return (
        <TooltipProvider>
          <XmlInstanceForm
            schema={schema}
            rootSchema={schema}
            value={value}
            fieldGroups={{ name: "identity", code: "identity" }}
            autoExpandAll
            onChange={(next) => {
              latest = next;
              setValue(next);
            }}
          />
        </TooltipProvider>
      );
    }
    render(<Editor />);
    const start = screen.getByTestId("xml-attr-record-start");
    const end = screen.getByTestId("xml-attr-record-end");
    expect(start.closest('[data-field-group="short"]')).not.toBeNull();
    expect(start.closest('[data-field-group="short"]')).toBe(
      end.closest('[data-field-group="short"]')
    );
    const count = screen.getByTestId("xml-element-count-input");
    const limit = screen.getByTestId("xml-element-limit-input");
    expect(count.closest('[data-field-group="short"]')).not.toBeNull();
    expect(count.closest('[data-field-group="short"]')).toBe(
      limit.closest('[data-field-group="short"]')
    );
    const name = screen.getByTestId("xml-element-name-input");
    expect(name.closest('[data-field-group="identity"]')).not.toBeNull();
    expect(name.closest('[data-field-group="identity"]')).toBe(
      screen
        .getByTestId("xml-element-code-input")
        .closest('[data-field-group="identity"]')
    );
    expect(
      screen
        .getByTestId("xml-element-notes-input")
        .closest("[data-field-group]")
    ).toBeNull();
    fireEvent.change(count, { target: { value: "4" } });
    fireEvent.change(name, { target: { value: "Updated" } });
    fireEvent.change(start, { target: { value: "3" } });
    const serialized = serializeMarkup(latest, "xml");
    const doc = new DOMParser().parseFromString(serialized, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("count")?.textContent?.trim()).toBe("4");
    expect(doc.querySelector("name")?.textContent?.trim()).toBe("Updated");
    expect(doc.documentElement.getAttribute("start")).toBe("3");
  });
});
