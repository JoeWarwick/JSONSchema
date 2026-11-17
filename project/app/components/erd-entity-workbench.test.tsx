import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ErdEntityWorkbench } from "./erd-entity-workbench";
import type { ErdModel } from "~/types/erd";
import { TooltipProvider } from "./ui/tooltip/tooltip";
import { AddWorkbenchContext } from "~/state/workbench-context";

const model: ErdModel = {
  tables: [
    {
      id: "parent",
      name: "Parent",
      clrName: "Parent",
      columns: [
        { name: "Id", type: "int", isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: "Region", type: "string", isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: "Name", type: "string", isNullable: false, isPrimaryKey: false, isForeignKey: false },
      ],
      navigations: [],
    },
    {
      id: "child",
      name: "Child",
      clrName: "Child",
      columns: [
        { name: "Id", type: "int", isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: "ParentId", type: "int", isNullable: false, isPrimaryKey: false, isForeignKey: true },
        { name: "ParentRegion", type: "string", isNullable: false, isPrimaryKey: false, isForeignKey: true },
        { name: "Label", type: "string", isNullable: false, isPrimaryKey: false, isForeignKey: false },
        { name: "Enabled", type: "bool", isNullable: false, isPrimaryKey: false, isForeignKey: false },
      ],
      navigations: [],
    },
  ],
  relationships: [{
    id: "parent-child",
    principalTable: "parent",
    dependentTable: "child",
    foreignKeyColumns: ["ParentId", "ParentRegion"],
    principalCardinality: "one",
    dependentCardinality: "many",
    explicit: true,
  }],
  sourceFiles: [],
  diagnostics: [],
};

const snapshot = {
  tables: [
    {
      id: "parent",
      name: "Parent",
      columns: model.tables[0].columns,
      records: [{ rowId: 1, values: { Id: 7, Region: "west", Name: "Parent A" } }],
    },
    {
      id: "child",
      name: "Child",
      columns: model.tables[1].columns,
      records: [],
    },
  ],
  relationships: [{
    principalTable: "parent",
    dependentTable: "child",
    foreignKeyColumns: ["ParentId", "ParentRegion"],
  }],
};

const manyToManyModel: ErdModel = {
  tables: [
    {
      id: "student",
      name: "Student",
      clrName: "Student",
      columns: [
        { name: "Id", type: "int", isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: "Name", type: "string", isNullable: false, isPrimaryKey: false, isForeignKey: false },
      ],
      navigations: [],
    },
    {
      id: "course",
      name: "Course",
      clrName: "Course",
      columns: [
        { name: "Id", type: "int", isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: "Title", type: "string", isNullable: false, isPrimaryKey: false, isForeignKey: false },
      ],
      navigations: [],
    },
    {
      id: "enrollment",
      name: "Enrollment",
      clrName: "Enrollment",
      columns: [
        { name: "StudentId", type: "int", isNullable: false, isPrimaryKey: true, isForeignKey: true },
        { name: "CourseId", type: "int", isNullable: false, isPrimaryKey: true, isForeignKey: true },
      ],
      navigations: [],
    },
  ],
  relationships: [
    {
      id: "enrollment-student",
      principalTable: "student",
      dependentTable: "enrollment",
      foreignKeyColumns: ["StudentId"],
      principalCardinality: "one",
      dependentCardinality: "many",
      explicit: true,
    },
    {
      id: "enrollment-course",
      principalTable: "course",
      dependentTable: "enrollment",
      foreignKeyColumns: ["CourseId"],
      principalCardinality: "one",
      dependentCardinality: "many",
      explicit: true,
    },
  ],
  sourceFiles: [],
  diagnostics: [],
};

const manyToManySnapshot = {
  tables: [
    {
      id: "student",
      name: "Student",
      columns: manyToManyModel.tables[0].columns,
      records: [{ rowId: 1, values: { Id: 1, Name: "Ada" } }],
    },
    {
      id: "course",
      name: "Course",
      columns: manyToManyModel.tables[1].columns,
      records: [
        { rowId: 2, values: { Id: 2, Title: "Algebra" } },
        { rowId: 3, values: { Id: 3, Title: "Physics" } },
      ],
    },
    {
      id: "enrollment",
      name: "Enrollment",
      columns: manyToManyModel.tables[2].columns,
      records: [{ rowId: 15, values: { StudentId: 1, CourseId: 2 } }],
    },
  ],
  relationships: [
    { principalTable: "student", dependentTable: "enrollment", foreignKeyColumns: ["StudentId"] },
    { principalTable: "course", dependentTable: "enrollment", foreignKeyColumns: ["CourseId"] },
  ],
};

function authSessionResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({
      user: { email: "editor@example.test", emailConfirmed: true, hasPassword: true, hasGoogleLogin: false },
      googleEnabled: false,
      csrfToken: "test-csrf-token",
    }),
  } as unknown as Response;
}

describe("ERD entity workbench", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the selected parent record to populate a composite foreign key when creating an entity", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/session") return authSessionResponse();
      if (String(input).endsWith("/sync")) {
        return { ok: true, json: async () => snapshot } as Response;
      }
      const body = JSON.parse(String(init?.body)) as { values: Record<string, unknown> };
      return {
        ok: true,
        json: async () => ({ rowId: 9, values: { Id: 9, ...body.values } }),
      } as Response;
    });

    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      render(
        <TooltipProvider>
          <ErdEntityWorkbench model={model} workbenchId="test-workbench" />
        </TooltipProvider>,
      );

      await screen.findByText("Id: 7, Region: west — Parent A");
      fireEvent.change(screen.getByRole("combobox", { name: "Entity" }), { target: { value: "child" } });
      fireEvent.click(screen.getByRole("button", { name: "Add entity" }));
      fireEvent.change(screen.getByRole("combobox", { name: "Parent: Parent" }), {
        target: { value: JSON.stringify([7, "west"]) },
      });
      fireEvent.change(screen.getByTestId("xml-element-Label-input"), { target: { value: "Child A" } });
      fireEvent.change(screen.getByTestId("xml-element-Enabled-input"), { target: { value: "false" } });
      fireEvent.click(screen.getByRole("button", { name: "Save entity" }));

      const databaseCalls = () => fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith("/api/schema/erd-database/"));
      await waitFor(() => expect(databaseCalls()).toHaveLength(2));
      const saveCall = databaseCalls()[1] as unknown as [RequestInfo | URL, RequestInit];
      expect(new Headers(saveCall[1].headers).get("X-CSRF-TOKEN")).toBe("test-csrf-token");
      expect(JSON.parse(String(saveCall[1].body))).toMatchObject({
        tableId: "child",
        values: { ParentId: 7, ParentRegion: "west", Label: "Child A", Enabled: "false" },
      });
      await screen.findByText("Id: 9 — Child A");

      fireEvent.click(screen.getByRole("button", { name: "Edit Id: 9 — Child A" }));
      const labelInput = screen.getByTestId("xml-element-Label-input");
      expect(labelInput).toHaveValue("Child A");
      fireEvent.change(labelInput, { target: { value: "Child B" } });
      fireEvent.click(screen.getByRole("button", { name: "Save entity" }));

      await waitFor(() => expect(databaseCalls()).toHaveLength(3));
      const updateCall = databaseCalls()[2] as unknown as [RequestInfo | URL, RequestInit];
      expect(JSON.parse(String(updateCall[1].body))).toMatchObject({
        tableId: "child",
        rowId: 9,
        values: { ParentId: 7, ParentRegion: "west", Label: "Child B", Enabled: "false" },
      });
      await screen.findByText("Id: 9 — Child B");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("opens a locally stored XML schema workbench for the selected entity root", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/session") return authSessionResponse();
      return { ok: true, json: async () => snapshot } as Response;
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;
    const addWorkbench = jest.fn();

    try {
      render(
        <AddWorkbenchContext.Provider value={addWorkbench}>
          <TooltipProvider>
            <ErdEntityWorkbench model={model} workbenchId="test-workbench" />
          </TooltipProvider>
        </AddWorkbenchContext.Provider>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Open XML Schema" }));

      expect(addWorkbench).toHaveBeenCalledTimes(1);
      const [workbench, activate] = addWorkbench.mock.calls[0] as unknown as [
        { kind: string; entries: Record<string, string> },
        boolean,
      ];
      expect(activate).toBe(true);
      expect(workbench.kind).toBe("xml");
      expect(JSON.parse(workbench.entries["schema-sculptor-schema-xml"])["xs:schema"]["xs:element"]["@attributes"])
        .toEqual({ name: "Parent", type: "Entity_parent" });
      expect(JSON.parse(workbench.entries["schema-sculptor-instance-xml"])).toEqual({
        Parent: {
          Region: { _text: "" },
          Name: { _text: "" },
          Childs: [],
        },
      });
      expect(JSON.parse(workbench.entries["schema-sculptor-erd-origin"])).toEqual({
        workbenchId: "test-workbench",
        sourceWorkbenchId: "test-workbench",
        rootTableId: "parent",
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("adds and removes a many-to-many association without changing either entity", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/session") return authSessionResponse();
      if (String(input).endsWith("/sync")) {
        return { ok: true, json: async () => manyToManySnapshot } as Response;
      }
      if (String(input).endsWith("/relationships/unlink")) {
        return { ok: true, status: 204 } as Response;
      }
      return {
        ok: true,
        json: async () => ({ rowId: 16, values: { StudentId: 1, CourseId: 3 } }),
      } as Response;
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      render(
        <TooltipProvider>
          <ErdEntityWorkbench model={manyToManyModel} workbenchId="many-to-many-workbench" />
        </TooltipProvider>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Edit Id: 1 — Ada" }));
      await screen.findByText("Id: 2 — Algebra");
      fireEvent.change(screen.getByRole("combobox", { name: "Add Course" }), {
        target: { value: "3" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Link" }));

      await screen.findByText("Id: 3 — Physics");
      const databaseCalls = () => fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith("/api/schema/erd-database/"));
      const linkCall = databaseCalls()[1] as unknown as [RequestInfo | URL, RequestInit];
      expect(JSON.parse(String(linkCall[1].body))).toMatchObject({
        tableId: "enrollment",
        values: { StudentId: 1, CourseId: 3 },
      });
      const relatedSection = screen.getByRole("region", { name: "Related entities for Student" });
      await waitFor(() => expect(within(relatedSection).getAllByRole("listitem")).toHaveLength(2));

      fireEvent.click(screen.getAllByRole("button", { name: "Remove link to Course record" })[0]);
      await waitFor(() => expect(databaseCalls()).toHaveLength(3));
      const unlinkCall = databaseCalls()[2] as unknown as [RequestInfo | URL, RequestInit];
      expect(String(unlinkCall[0])).toContain("/relationships/unlink");
      expect(JSON.parse(String(unlinkCall[1].body))).toEqual({ tableId: "enrollment", rowId: 15 });
      expect(screen.getByRole("button", { name: "Edit Id: 1 — Ada" })).toBeInTheDocument();
      await waitFor(() => expect(within(relatedSection).getAllByRole("listitem")).toHaveLength(1));
      const linkedList = within(relatedSection).getByRole("list");
      expect(within(linkedList).getByText("Id: 3 — Physics")).toBeInTheDocument();
      expect(within(linkedList).queryByText("Id: 2 — Algebra")).not.toBeInTheDocument();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
