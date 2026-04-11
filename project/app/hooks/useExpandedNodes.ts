import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'schema-editor-expanded-nodes';

/**
 * Hook to manage persistent expansion state for schema editor nodes
 * Stores expanded paths in localStorage and restores them across navigation
 */
export function useExpandedNodes() {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    // Initialize from localStorage
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch (e) {
      console.warn('Failed to load expanded nodes from localStorage:', e);
      return new Set();
    }
  });

  // Persist to localStorage whenever expandedNodes changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(expandedNodes)));
    } catch (e) {
      console.warn('Failed to save expanded nodes to localStorage:', e);
    }
  }, [expandedNodes]);

  const toggleNode = useCallback((path: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const isNodeExpanded = useCallback((path: string) => {
    return expandedNodes.has(path);
  }, [expandedNodes]);

  const clearAllExpanded = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  return {
    expandedNodes,
    toggleNode,
    isNodeExpanded,
    setExpandedNodes,
    clearAllExpanded,
  };
}
