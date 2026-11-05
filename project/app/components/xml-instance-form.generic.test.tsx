import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { XmlInstanceForm } from "./xml-instance-form";
import { TooltipProvider } from "./ui/tooltip/tooltip";
import { parseMarkup, serializeMarkup } from "../utils/markup";

const metaSchema = parseMarkup(
  fs.readFileSync(
    path.resolve(process.cwd(), "public/schemas/XMLSchema.xsd"),
    "utf8"
  ),
  "xml"
);

function renderForm(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("generic XML form boundary", () => {
  beforeEach(() => window.localStorage.clear());

  test.each([false, true])(
    "switching choice labels preserves instance namespace prefixes (repeatable: %s)",
    (repeatable) => {
      const schema = parseMarkup(
        `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
      targetNamespace="urn:records" elementFormDefault="qualified">
      <xs:element name="record"><xs:complexType><xs:choice ${
        repeatable ? 'maxOccurs="unbounded"' : ""
      }>
        <xs:element name="first" type="xs:string"/><xs:element name="second" type="xs:string"/>
      </xs:choice></xs:complexType></xs:element></xs:schema>`,
        "xml"
      );
      let latest = parseMarkup(
        '<r:record xmlns:r="urn:records"><r:first>value</r:first></r:record>',
        "xml"
      );
      function Editor() {
        const [value, setValue] = React.useState(latest);
        return (
          <XmlInstanceForm
            schema={schema}
            rootSchema={schema}
            value={value}
            autoExpandAll
            onChange={(next) => {
              latest = next;
              setValue(next);
            }}
          />
        );
      }
      renderForm(<Editor />);
      const choice = screen
        .getAllByRole("combobox")
        .find((control) => (control as HTMLSelectElement).value === "first")!;
      fireEvent.change(choice, { target: { value: "second" } });
      const doc = new DOMParser().parseFromString(
        serializeMarkup(latest, "xml"),
        "application/xml"
      );
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.getElementsByTagNameNS("urn:records", "second")).toHaveLength(
        1
      );
      expect(doc.getElementsByTagNameNS("*", "first")).toHaveLength(0);
    }
  );

  test.each([false, true])(
    "label choice switches complex content models (repeatable: %s)",
    (repeatable) => {
      const schema = parseMarkup(
        `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="record"><xs:complexType><xs:choice ${
        repeatable ? 'maxOccurs="unbounded"' : ""
      }>
        <xs:element name="person" type="PersonType"/>
        <xs:element name="company" type="CompanyType"/>
      </xs:choice></xs:complexType></xs:element>
      <xs:complexType name="PersonType"><xs:sequence>
        <xs:element name="firstName" type="xs:string"/>
      </xs:sequence><xs:attribute name="age" type="xs:int" use="required"/></xs:complexType>
      <xs:complexType name="CompanyType"><xs:sequence>
        <xs:element name="legalName" type="xs:string"/>
      </xs:sequence><xs:attribute name="registration" type="xs:string" use="required"/></xs:complexType>
    </xs:schema>`,
        "xml"
      );
      let latest = parseMarkup(
        '<record><person age="31"><firstName>Alice</firstName></person></record>',
        "xml"
      );
      function Editor() {
        const [value, setValue] = React.useState(latest);
        return (
          <XmlInstanceForm
            schema={schema}
            rootSchema={schema}
            value={value}
            autoExpandAll
            onChange={(next) => {
              latest = next;
              setValue(next);
            }}
          />
        );
      }
      renderForm(<Editor />);
      const choice = () =>
        screen
          .getAllByRole("combobox")
          .find(
            (control) =>
              control.getAttribute("aria-label")?.startsWith("Select ") &&
              Array.from((control as HTMLSelectElement).options).some(
                (option) => option.value === "company"
              )
          )!;
      expect(choice()).toHaveValue("person");
      const expandChoice = () => {
        const button = within(choice().parentElement!).queryByRole("button", {
          name: "Expand",
        });
        if (button) fireEvent.click(button);
      };
      expandChoice();
      expect(screen.getByTestId("xml-element-firstName-input")).toHaveValue(
        "Alice"
      );
      fireEvent.change(choice(), { target: { value: "company" } });
      expect(choice()).toHaveValue("company");
      expandChoice();
      expect(
        screen.queryByTestId("xml-element-firstName-input")
      ).not.toBeInTheDocument();
      const legalName = screen.getByTestId("xml-element-legalName-input");
      const registration = screen.getByTestId("xml-attr-company-registration");
      fireEvent.change(legalName, { target: { value: "Acme" } });
      fireEvent.change(registration, { target: { value: "R123" } });
      const doc = new DOMParser().parseFromString(
        serializeMarkup(latest, "xml"),
        "application/xml"
      );
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.querySelector("person")).toBeNull();
      expect(doc.querySelector("company")?.getAttribute("registration")).toBe(
        "R123"
      );
      expect(doc.querySelector("legalName")?.textContent?.trim()).toBe("Acme");
      expect(doc.querySelector("firstName")).toBeNull();
      expect(doc.querySelector("company")?.hasAttribute("age")).toBe(false);
      fireEvent.change(choice(), { target: { value: "person" } });
      expandChoice();
      expect(screen.getByTestId("xml-element-firstName-input")).toHaveValue(
        "Alice"
      );
      expect(screen.getByTestId("xml-attr-person-age")).toHaveValue(31);
      expect(
        screen.queryByTestId("xml-element-legalName-input")
      ).not.toBeInTheDocument();
      fireEvent.change(choice(), { target: { value: "company" } });
      expandChoice();
      expect(screen.getByTestId("xml-element-legalName-input")).toHaveValue(
        "Acme"
      );
      expect(screen.getByTestId("xml-attr-company-registration")).toHaveValue(
        "R123"
      );
    }
  );

  test.each(["xml-instance-form-expanded", "custom-layout-key"])(
    "XSD authoring does not depend on storage key %s",
    (expansionStateKey) => {
      const value = parseMarkup(
        '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="entry" type="xs:string"/></xs:schema>',
        "xml"
      );
      renderForm(
        <XmlInstanceForm
          schema={metaSchema}
          rootSchema={value}
          value={value}
          onChange={jest.fn()}
          autoExpandAll
          expansionStateKey={expansionStateKey}
        />
      );
      expect(screen.getByText("Schema Editor")).toBeInTheDocument();
      expect(screen.getByTestId("xml-name-chip")).toHaveTextContent("entry");
    }
  );

  test.each([false, true])(
    "repeated complex choices preserve sibling occurrences and order (ordered data: %s)",
    (ordered) => {
      const schema = parseMarkup(
        `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
          <xs:element name="record"><xs:complexType><xs:choice maxOccurs="unbounded">
            <xs:element name="person"><xs:complexType><xs:sequence>
              <xs:element name="firstName" type="xs:string"/>
            </xs:sequence></xs:complexType></xs:element>
            <xs:element name="company"><xs:complexType><xs:sequence>
              <xs:element name="legalName" type="xs:string"/>
            </xs:sequence></xs:complexType></xs:element>
          </xs:choice></xs:complexType></xs:element></xs:schema>`,
        "xml"
      );
      let latest = parseMarkup(
        "<record><person><firstName>Alice</firstName></person><person><firstName>Bob</firstName></person></record>",
        "xml"
      );
      if (!ordered)
        delete (latest as Record<string, Record<string, unknown>>).record
          .__childrenInOrder;
      function Editor() {
        const [value, setValue] = React.useState(latest);
        return (
          <XmlInstanceForm
            schema={schema}
            rootSchema={schema}
            value={value}
            autoExpandAll
            onChange={(next) => {
              latest = next;
              setValue(next);
            }}
          />
        );
      }
      renderForm(<Editor />);
      const people = screen.getAllByRole("combobox", {
        name: "Select person type",
      });
      expect(people).toHaveLength(2);
      fireEvent.change(people[1], { target: { value: "company" } });
      const company = screen.getByRole("combobox", {
        name: "Select company type",
      });
      fireEvent.click(
        within(company.parentElement!).getByRole("button", { name: "Expand" })
      );
      fireEvent.change(screen.getByTestId("xml-element-legalName-input"), {
        target: { value: "Acme" },
      });
      const doc = new DOMParser().parseFromString(
        serializeMarkup(latest, "xml"),
        "application/xml"
      );
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(
        Array.from(doc.documentElement.children).map((node) => node.tagName)
      ).toEqual(["person", "company"]);
      expect(doc.querySelector("firstName")?.textContent?.trim()).toBe("Alice");
      expect(doc.querySelector("company firstName")).toBeNull();
      expect(doc.querySelector("company legalName")?.textContent?.trim()).toBe(
        "Acme"
      );
      fireEvent.change(company, { target: { value: "person" } });
      const restored = new DOMParser().parseFromString(
        serializeMarkup(latest, "xml"),
        "application/xml"
      );
      expect(restored.querySelectorAll("person")).toHaveLength(2);
      expect(
        Array.from(restored.querySelectorAll("firstName")).map((node) =>
          node.textContent?.trim()
        )
      ).toEqual(["Alice", "Bob"]);
    }
  );

  test.each(["", "xs:"])(
    "ordinary %s XML does not become an XSD editor through its storage key or local names",
    (prefix) => {
      const schema = parseMarkup(
        `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="element"><xs:complexType><xs:sequence>
        <xs:element name="attribute" type="xs:string"/>
        <xs:element name="sequence" type="xs:string"/>
      </xs:sequence></xs:complexType></xs:element></xs:schema>`,
        "xml"
      );
      const value = parseMarkup(
        `<${prefix}element xmlns:xs="urn:ordinary"><${prefix}attribute>value</${prefix}attribute><${prefix}sequence>text</${prefix}sequence></${prefix}element>`,
        "xml"
      );
      renderForm(
        <XmlInstanceForm
          schema={schema}
          rootSchema={schema}
          value={value}
          onChange={jest.fn()}
          autoExpandAll
          expansionStateKey="xml-schema-form-expanded"
        />
      );
      expect(screen.queryByText("Element Editor")).not.toBeInTheDocument();
      expect(screen.queryByText("Attribute Editor")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Convert to ComplexType" })
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("xml-element-attribute-input")).toHaveValue(
        "value"
      );
      expect(screen.getByTestId("xml-element-sequence-input")).toHaveValue(
        "text"
      );
    }
  );

  test("XSD documents remain editable with authoring controls disabled", () => {
    let latest = parseMarkup(
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="entry" type="xs:string"/></xs:schema>',
      "xml"
    );
    function Editor() {
      const [value, setValue] = React.useState(latest);
      return (
        <XmlInstanceForm
          schema={metaSchema}
          rootSchema={value}
          value={value}
          xsdAuthoring={false}
          autoExpandAll
          expansionStateKey="generic-xsd"
          onChange={(next) => {
            latest = next;
            setValue(next);
          }}
        />
      );
    }
    renderForm(<Editor />);
    expect(screen.queryByText("Schema Editor")).not.toBeInTheDocument();
    const chip = screen.getByTestId("xml-name-chip");
    fireEvent.click(
      within(chip.parentElement!).getByRole("button", { name: "Expand" })
    );
    expect(screen.queryByText("Element Editor")).not.toBeInTheDocument();
    const name = screen.getByTestId("xml-attr-xs_element-name");
    fireEvent.change(name, { target: { value: "renamed" } });
    const doc = new DOMParser().parseFromString(
      serializeMarkup(latest, "xml"),
      "application/xml"
    );
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(
      doc
        .getElementsByTagNameNS(
          "http://www.w3.org/2001/XMLSchema",
          "element"
        )[0]
        .getAttribute("name")
    ).toBe("renamed");
  });

  test("XSD facets use generic child and attribute editors without duplicate presentation", () => {
    let latest = parseMarkup(
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:simpleType name="Color"><xs:restriction base="xs:string">
        <xs:enumeration value="red"/><xs:enumeration value="green"/>
        <xs:minLength value="1"/>
      </xs:restriction></xs:simpleType></xs:schema>`,
      "xml"
    );
    function Editor() {
      const [value, setValue] = React.useState(latest);
      return (
        <XmlInstanceForm
          schema={metaSchema}
          rootSchema={value}
          value={value}
          xsdAuthoring={false}
          autoExpandAll
          onChange={(next) => {
            latest = next;
            setValue(next);
          }}
        />
      );
    }
    renderForm(<Editor />);
    for (let depth = 0; depth < 5; depth += 1) {
      const expanders = screen.queryAllByRole("button", { name: "Expand" });
      if (expanders.length === 0) break;
      expanders.forEach((button) => fireEvent.click(button));
    }
    expect(screen.getAllByDisplayValue("red")).toHaveLength(1);
    expect(screen.getAllByDisplayValue("green")).toHaveLength(1);
    expect(screen.queryByText(/Enumeration Values/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("green"), {
      target: { value: "lime" },
    });
    const doc = new DOMParser().parseFromString(
      serializeMarkup(latest, "xml"),
      "application/xml"
    );
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(
      Array.from(
        doc.getElementsByTagNameNS(
          "http://www.w3.org/2001/XMLSchema",
          "enumeration"
        )
      ).map((node) => node.getAttribute("value"))
    ).toEqual(["red", "lime"]);
    expect(
      doc
        .getElementsByTagNameNS(
          "http://www.w3.org/2001/XMLSchema",
          "minLength"
        )[0]
        .getAttribute("value")
    ).toBe("1");
  });
});
