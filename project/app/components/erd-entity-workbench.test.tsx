import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ErdEntityWorkbench } from "./erd-entity-workbench";
import type { ErdModel } from "~/types/erd";
import { TooltipProvider } from "./ui/tooltip/tooltip";

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

describe("ERD entity workbench", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the selected parent record to populate a composite foreign key when creating an entity", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const saveCall = fetchMock.mock.calls[1] as unknown as [RequestInfo | URL, RequestInit];
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

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      const updateCall = fetchMock.mock.calls[2] as unknown as [RequestInfo | URL, RequestInit];
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
});
