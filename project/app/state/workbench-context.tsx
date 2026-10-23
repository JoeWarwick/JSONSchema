import { createContext, useContext } from 'react';
import type { WorkbenchDocument } from './workspace';

// Defer access to browser storage until a method is called, including during SSR.
export const browserStorage: Storage = {
  get length() { return typeof window === 'undefined' ? 0 : window.localStorage.length; },
  key: index => typeof window === 'undefined' ? null : window.localStorage.key(index),
  getItem: key => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: key => window.localStorage.removeItem(key),
  clear: () => window.localStorage.clear(),
};

export interface WorkbenchEnvironment {
  documentId?: string;
  storage: Storage;
  runtime: object;
}

export const WorkbenchContext = createContext<WorkbenchEnvironment>({
  storage: browserStorage,
  runtime: globalThis,
});

export function useWorkbenchStorage(): Storage {
  return useContext(WorkbenchContext).storage;
}

export function useWorkbenchRuntime(): object {
  return useContext(WorkbenchContext).runtime;
}

export const WorkspaceDocumentsContext = createContext<WorkbenchDocument[]>([]);
export const AddWorkbenchContext = createContext<((bench: WorkbenchDocument | WorkbenchDocument[], activate: boolean) => void) | null>(null);

export function useWorkspaceDocuments(): WorkbenchDocument[] {
  return useContext(WorkspaceDocumentsContext);
}
