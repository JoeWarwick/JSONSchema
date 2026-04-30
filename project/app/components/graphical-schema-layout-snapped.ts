import type { Node } from 'reactflow';
import type { SchemaNodeData } from './schema-behaviors';

type DagreNodeInfo = { width?: number } | undefined;

type ApplySnappedDagreLayoutArgs = {
  finalLaid: Node<SchemaNodeData>[];
  hiddenNodes: Node<SchemaNodeData>[];
  dagreNodeFor: (id: string) => DagreNodeInfo;
  estimateWidth: (n: Node<SchemaNodeData>) => number;
  estimateHeight: (n: Node<SchemaNodeData>) => number;
  compareLayoutSiblings: (a: Node<SchemaNodeData>, b: Node<SchemaNodeData>) => number;
  useDagreVariantLayout?: boolean;
  applyCollisionResolution?: boolean;
  nodeGap?: number;
  ranksep?: number;
  additionalPropertiesGap?: number;
};

export function applySnappedDagreLayout({
  finalLaid,
  hiddenNodes,
  dagreNodeFor,
  estimateWidth,
  estimateHeight,
  compareLayoutSiblings,
  useDagreVariantLayout = true,
  applyCollisionResolution = !useDagreVariantLayout,
  nodeGap = 16,
  ranksep = 35,
  additionalPropertiesGap = 60,
}: ApplySnappedDagreLayoutArgs): Node<SchemaNodeData>[] {
  const laidMap = new Map(finalLaid.map((n) => [n.id, n]));

  const withSnappedCombiners = finalLaid.map((n) => {
    if (n.type !== 'combiner') return n;
    const parentId = (n.data as any)?.parent as string | undefined;
    const parentNode = parentId ? laidMap.get(parentId) : undefined;
    if (!parentNode) return n;
    const dn = dagreNodeFor(parentNode.id);
    const pw = dn?.width ?? estimateWidth(parentNode);
    const parentIsAdditionalProperties = Boolean((parentNode.data as any)?.isAdditionalProperties);
    const combinerGap = parentIsAdditionalProperties ? additionalPropertiesGap : nodeGap;
    return { ...n, position: { x: parentNode.position.x + pw + combinerGap, y: n.position.y } };
  });

  const variantVGap = 3;
  const snappedCombinerMap = new Map(withSnappedCombiners.map((n) => [n.id, n]));
  const withSnappedVariants = withSnappedCombiners.map((n) => {
    if (n.type !== 'variant') return n;
    if (useDagreVariantLayout) return n;
    const parentId = (n.data as any)?.parent as string | undefined;
    const parentNode = parentId ? snappedCombinerMap.get(parentId) : undefined;
    if (!parentNode) return n;
    const dn = dagreNodeFor(parentNode.id);
    const pw = dn?.width ?? estimateWidth(parentNode);
    const siblings = withSnappedCombiners
      .filter((s) => s.type === 'variant' && (s.data as any)?.parent === parentId)
      .sort(compareLayoutSiblings);
    const idx = siblings.findIndex((s) => s.id === n.id);
    const variantH = estimateHeight(n);
    const totalH = siblings.length * variantH + (siblings.length - 1) * variantVGap;
    const startY = parentNode.position.y + estimateHeight(parentNode) / 2 - totalH / 2;
    const targetX = parentNode.position.x + pw + nodeGap + 5;
    const shouldSnapX = n.position.x - targetX > ranksep;
    return {
      ...n,
      position: {
        x: shouldSnapX ? targetX : n.position.x,
        y: startY + idx * (variantH + variantVGap),
      },
    };
  });

  const snappedVariantMap = new Map(withSnappedVariants.map((n) => [n.id, n]));
  const withSnappedAdditionalProperties = withSnappedVariants.map((n) => {
    if (!(n.data as any)?.isAdditionalProperties) return n;
    const parentId = (n.data as any)?.parent as string | undefined;
    const parentNode = parentId ? snappedVariantMap.get(parentId) : undefined;
    if (!parentNode) return n;
    const dn = dagreNodeFor(parentNode.id);
    const pw = dn?.width ?? estimateWidth(parentNode);
    return { ...n, position: { x: parentNode.position.x + pw + additionalPropertiesGap, y: n.position.y } };
  });

  const snappedAdditionalMap = new Map(withSnappedAdditionalProperties.map((n) => [n.id, n]));
  const withResnappedCombiners = withSnappedAdditionalProperties.map((n) => {
    if (n.type !== 'combiner') return n;
    const parentId = (n.data as any)?.parent as string | undefined;
    const parentNode = parentId ? snappedAdditionalMap.get(parentId) : undefined;
    if (!parentNode) return n;
    const dn = dagreNodeFor(parentNode.id);
    const pw = dn?.width ?? estimateWidth(parentNode);
    const parentIsAdditionalProperties = Boolean((parentNode.data as any)?.isAdditionalProperties);
    const combinerGap = parentIsAdditionalProperties ? additionalPropertiesGap : nodeGap;
    return { ...n, position: { x: parentNode.position.x + pw + combinerGap, y: n.position.y } };
  });

  const resnappedCombinerMap = new Map(withResnappedCombiners.map((n) => [n.id, n]));
  const withResnappedVariants = withResnappedCombiners.map((n) => {
    if (n.type !== 'variant') return n;
    if (useDagreVariantLayout) return n;
    const parentId = (n.data as any)?.parent as string | undefined;
    const parentNode = parentId ? resnappedCombinerMap.get(parentId) : undefined;
    if (!parentNode) return n;
    const dn = dagreNodeFor(parentNode.id);
    const pw = dn?.width ?? estimateWidth(parentNode);
    const siblings = withResnappedCombiners
      .filter((s) => s.type === 'variant' && (s.data as any)?.parent === parentId)
      .sort(compareLayoutSiblings);
    const idx = siblings.findIndex((s) => s.id === n.id);
    const variantH = estimateHeight(n);
    const totalH = siblings.length * variantH + (siblings.length - 1) * variantVGap;
    const startY = parentNode.position.y + estimateHeight(parentNode) / 2 - totalH / 2;
    const targetX = parentNode.position.x + pw + nodeGap + 5;
    const shouldSnapX = n.position.x - targetX > ranksep;
    return {
      ...n,
      position: {
        x: shouldSnapX ? targetX : n.position.x,
        y: startY + idx * (variantH + variantVGap),
      },
    };
  });

  if (useDagreVariantLayout || !applyCollisionResolution) {
    return [...withResnappedVariants, ...hiddenNodes];
  }

  const boxesOverlap = (a: Node<SchemaNodeData>, b: Node<SchemaNodeData>, extraShiftX = 0) => {
    const ax = (a.position?.x ?? 0) + extraShiftX;
    const ay = a.position?.y ?? 0;
    const aw = estimateWidth(a);
    const ah = estimateHeight(a);
    const bx = b.position?.x ?? 0;
    const by = b.position?.y ?? 0;
    const bw = estimateWidth(b);
    const bh = estimateHeight(b);
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  };

  const nonVariantNodes = withResnappedVariants.filter((n) => n.type !== 'variant');
  const variantsByParent = new Map<string, Node<SchemaNodeData>[]>();
  withResnappedVariants.forEach((n) => {
    if (n.type !== 'variant') return;
    const parentId = ((n.data as any)?.parent as string) || '';
    const arr = variantsByParent.get(parentId) || [];
    arr.push(n);
    variantsByParent.set(parentId, arr);
  });

  const parentShiftX = new Map<string, number>();
  const maxShiftSteps = 6;
  for (const [parentId, variants] of variantsByParent.entries()) {
    let shiftSteps = 0;
    while (shiftSteps < maxShiftSteps) {
      const trialShiftX = shiftSteps * ranksep;
      const hasOverlap = variants.some((v) => nonVariantNodes.some((other) => boxesOverlap(v, other, trialShiftX)));
      if (!hasOverlap) break;
      shiftSteps += 1;
    }
    if (shiftSteps > 0) parentShiftX.set(parentId, shiftSteps * ranksep);
  }

  const withCollisionResolvedVariants = withResnappedVariants.map((n) => {
    if (n.type !== 'variant') return n;
    const parentId = ((n.data as any)?.parent as string) || '';
    const shiftX = parentShiftX.get(parentId) || 0;
    if (!shiftX) return n;
    return {
      ...n,
      position: {
        ...n.position,
        x: (n.position?.x ?? 0) + shiftX,
      },
    };
  });

  return [...withCollisionResolvedVariants, ...hiddenNodes];
}
