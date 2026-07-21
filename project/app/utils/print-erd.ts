import type { ErdModel, ErdTable } from '../types/erd';

type PrintNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  table: ErdTable;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function estimateTableWidth(table: ErdTable): number {
  return Math.max(240, Math.min(360, table.name.length * 10 + 80));
}

function estimateTableHeight(table: ErdTable): number {
  return 52 + Math.max(1, table.columns.length) * 26 + (table.navigations.length > 0 ? 34 : 0);
}

function buildNodes(model: ErdModel): PrintNode[] {
  return model.tables.map((table) => ({
    id: table.id,
    x: model.nodePositions?.[table.id]?.x ?? 0,
    y: model.nodePositions?.[table.id]?.y ?? 0,
    width: estimateTableWidth(table),
    height: estimateTableHeight(table),
    table,
  }));
}

function measureBounds(nodes: PrintNode[]): Bounds {
  const initialBounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  return nodes.reduce((bounds, node) => ({
    minX: Math.min(bounds.minX, node.x),
    minY: Math.min(bounds.minY, node.y),
    maxX: Math.max(bounds.maxX, node.x + node.width),
    maxY: Math.max(bounds.maxY, node.y + node.height),
  }), initialBounds);
}

function applyBoundsPadding(bounds: Bounds, padding: number): Bounds {
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

function edgePath(source: PrintNode, target: PrintNode): string {
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const midX = (sourceCenterX + targetCenterX) / 2;
  return `M ${sourceCenterX} ${sourceCenterY} C ${midX} ${sourceCenterY}, ${midX} ${targetCenterY}, ${targetCenterX} ${targetCenterY}`;
}

function nodeMarkup(node: PrintNode): string {
  const rows: string[] = [];
  rows.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" ry="6" fill="#ffffff" stroke="#126da0" stroke-width="2" />`);
  rows.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="28" rx="6" ry="6" fill="#087fbd" />`);
  rows.push(`<text x="${node.x + node.width / 2}" y="${node.y + 19}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${escapeXml(node.table.name)}</text>`);

  let currentY = node.y + 48;
  rows.push(`<text x="${node.x + 12}" y="${node.y + 42}" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#4a5c66">Properties</text>`);
  for (const column of node.table.columns) {
    rows.push(`<text x="${node.x + 12}" y="${currentY}" font-family="Arial, sans-serif" font-size="11" fill="#1f3036">${escapeXml(column.name)}${column.isNullable ? '?' : ''}</text>`);
    rows.push(`<text x="${node.x + node.width - 12}" y="${currentY}" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="#6b7d84">${escapeXml(column.type)}${column.isNullable ? '?' : ''}</text>`);
    currentY += 24;
  }

  if (node.table.navigations.length > 0) {
    rows.push(`<text x="${node.x + 12}" y="${currentY + 8}" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#4a5c66">Navigation Properties</text>`);
    currentY += 26;
    for (const navigation of node.table.navigations) {
      rows.push(`<text x="${node.x + 12}" y="${currentY}" font-family="Arial, sans-serif" font-size="11" fill="#1f3036">${escapeXml(navigation.name)}</text>`);
      currentY += 20;
    }
  }

  return rows.join('\n');
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return character;
    }
  });
}

export function printErdModel(model: ErdModel): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const nodes = buildNodes(model);
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const edges = model.relationships
    .map((relationship) => ({ relationship, source: nodeById.get(relationship.dependentTable), target: nodeById.get(relationship.principalTable) }))
    .filter((item): item is { relationship: ErdModel['relationships'][number]; source: PrintNode; target: PrintNode } => Boolean(item.source && item.target));

  const nodeBounds = applyBoundsPadding(measureBounds(nodes), 48);
  const edgeBounds = applyBoundsPadding(edges.reduce<Bounds>((bounds, edge) => {
    const sourceCenterX = edge.source.x + edge.source.width / 2;
    const sourceCenterY = edge.source.y + edge.source.height / 2;
    const targetCenterX = edge.target.x + edge.target.width / 2;
    const targetCenterY = edge.target.y + edge.target.height / 2;
    const midX = (sourceCenterX + targetCenterX) / 2;
    return {
      minX: Math.min(bounds.minX, sourceCenterX, targetCenterX, midX),
      minY: Math.min(bounds.minY, sourceCenterY, targetCenterY),
      maxX: Math.max(bounds.maxX, sourceCenterX, targetCenterX, midX),
      maxY: Math.max(bounds.maxY, sourceCenterY, targetCenterY),
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }), 24);
  const graphBounds = applyBoundsPadding({
    minX: Math.min(nodeBounds.minX, edgeBounds.minX),
    minY: Math.min(nodeBounds.minY, edgeBounds.minY),
    maxX: Math.max(nodeBounds.maxX, edgeBounds.maxX),
    maxY: Math.max(nodeBounds.maxY, edgeBounds.maxY),
  }, 0);
  const width = Math.max(1200, graphBounds.maxX - graphBounds.minX);
  const height = Math.max(900, graphBounds.maxY - graphBounds.minY);
  const viewBox = `${graphBounds.minX} ${graphBounds.minY} ${width} ${height}`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
      <style>
        text { font-family: Arial, sans-serif; }
      </style>
      ${edges.map(({ relationship, source, target }) => `
        <path d="${edgePath(source, target)}" fill="none" stroke="#6a818a" stroke-width="2" stroke-dasharray="6 4" />
        <text x="${(source.x + target.x) / 2}" y="${(source.y + source.height + target.y) / 2 - 6}" text-anchor="middle" font-size="10" fill="#6a818a">${escapeXml(`${relationship.dependentCardinality} : ${relationship.principalCardinality}`)}</text>
      `).join('\n')}
      ${nodes.map((node) => nodeMarkup(node)).join('\n')}
    </svg>`;

  const html = `
    <!doctype html>
    <html>
      <head>
        <title>ERD Print Preview</title>
        <style>
          @page { size: landscape; margin: 0.35in; }
          html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #fff; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page { width: 100%; height: 100%; min-height: 100vh; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0.1in; }
          svg { display: block; width: 100%; height: 100%; }
        </style>
      </head>
      <body>
        <div class="page">${svg}</div>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank', 'width=1400,height=1000');
  if (!printWindow) {
    URL.revokeObjectURL(url);
    return;
  }

  const releaseUrl = () => URL.revokeObjectURL(url);
  const closeAfterPrint = () => {
    releaseUrl();
    try { printWindow.close(); } catch (_) { /* ignore */ }
  };

  printWindow.addEventListener('afterprint', closeAfterPrint, { once: true });
  printWindow.addEventListener('load', () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch (_) {
      releaseUrl();
    }
  }, { once: true });
}