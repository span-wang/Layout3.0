import { Eraser, Minus, Plus, Redo2, RotateCcw, RotateCw, Trash2, Type, Undo2, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Image as KonvaImage, Layer, Line, Rect, Stage, Text as KonvaText, Transformer } from 'react-konva';
import {
  buildChemistryLineArtPartRenderSrc,
  chemistryLineArtPartCategories,
  chemistryLineArtParts,
  createChemistryEditableContainerStateForPart,
  getChemistryLineArtPartById,
  resolveChemistryContainerPresetRotation,
  type ChemistryContainerOrientationPreset,
  type ChemistryConnectorPointDefinition,
  type ChemistryEditableContainerState,
  type ChemistryLineArtPart,
  type ChemistryLineArtPartCategory,
} from '@/constants/chemistryApparatus';

const composerWidth = 760;
const composerHeight = 460;
const chemistryPartViewboxWidth = 220;
const chemistryPartViewboxHeight = 170;
const connectorSnapThresholdPx = 24;

export interface ChemistryCompositionInsertPayload {
  src: string;
  title: string;
  widthPx: number;
  heightPx: number;
}

interface ChemistryComposerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertComposition: (payload: ChemistryCompositionInsertPayload) => void;
}

type ComposerElement =
  | {
      kind: 'part';
      id: string;
      partId: string;
      name: string;
      src: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      containerState: ChemistryEditableContainerState | null;
    }
  | {
      kind: 'label';
      id: string;
      text: string;
      x: number;
      y: number;
      fontSize: number;
      rotation: number;
    }
  | {
      kind: 'tube';
      id: string;
      x: number;
      y: number;
      points: number[];
      rotation: number;
      startSnap: ComposerTubeEndpointSnap | null;
      endSnap: ComposerTubeEndpointSnap | null;
    };

type ComposerPartElement = Extract<ComposerElement, { kind: 'part' }>;
type ComposerTubeElement = Extract<ComposerElement, { kind: 'tube' }>;
type ComposerTubeEndpoint = 'start' | 'end';

interface ComposerTubeEndpointSnap {
  partElementId: string;
  connectorId: string;
}

interface Point2D {
  x: number;
  y: number;
}

interface ConnectorTarget {
  partElementId: string;
  connectorId: string;
  name: string;
  description: string;
  position: Point2D;
}

function createElementId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function useComposerImage(src: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = src;

    return () => setImage(null);
  }, [src]);

  return image;
}

function ComposerPartShape({
  element,
  isSelected,
  onSelect,
  onCommit,
}: {
  element: ComposerPartElement;
  isSelected: boolean;
  onSelect: () => void;
  onCommit: (nextElement: ComposerElement) => void;
}): JSX.Element {
  const image = useComposerImage(element.src);

  return (
    <KonvaImage
      id={element.id}
      image={image ?? undefined}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      draggable
      stroke={isSelected ? '#0d5663' : undefined}
      strokeWidth={isSelected ? 1 : 0}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(event) => {
        onCommit({
          ...element,
          x: event.target.x(),
          y: event.target.y(),
        });
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const nextWidth = Math.max(28, node.width() * node.scaleX());
        const nextHeight = Math.max(28, node.height() * node.scaleY());
        node.scaleX(1);
        node.scaleY(1);
        onCommit({
          ...markContainerOrientationAsCustom(element, node.rotation()),
          x: node.x(),
          y: node.y(),
          width: nextWidth,
          height: nextHeight,
        });
      }}
    />
  );
}

function transformPoints(points: number[], scaleX: number, scaleY: number): number[] {
  return points.map((point, index) => (index % 2 === 0 ? point * scaleX : point * scaleY));
}

function rotatePoint(point: Point2D, rotationDeg: number): Point2D {
  const rotationRad = (rotationDeg * Math.PI) / 180;
  const cosValue = Math.cos(rotationRad);
  const sinValue = Math.sin(rotationRad);
  return {
    x: point.x * cosValue - point.y * sinValue,
    y: point.x * sinValue + point.y * cosValue,
  };
}

function resolvePartConnectorPosition(
  element: ComposerPartElement,
  connector: ChemistryConnectorPointDefinition,
): Point2D {
  const scaledPoint = {
    x: (connector.x / chemistryPartViewboxWidth) * element.width,
    y: (connector.y / chemistryPartViewboxHeight) * element.height,
  };
  const rotatedPoint = rotatePoint(scaledPoint, element.rotation);
  return {
    x: element.x + rotatedPoint.x,
    y: element.y + rotatedPoint.y,
  };
}

function resolveTubeEndpointPositions(element: ComposerTubeElement): { start: Point2D; end: Point2D } {
  const startPoint = { x: element.x + element.points[0], y: element.y + element.points[1] };
  const rotatedEndOffset = rotatePoint(
    {
      x: element.points[2] ?? 0,
      y: element.points[3] ?? 0,
    },
    element.rotation,
  );
  return {
    start: startPoint,
    end: {
      x: element.x + rotatedEndOffset.x,
      y: element.y + rotatedEndOffset.y,
    },
  };
}

function buildTubeElementFromEndpoints(
  element: ComposerTubeElement,
  startPoint: Point2D,
  endPoint: Point2D,
  startSnap: ComposerTubeEndpointSnap | null,
  endSnap: ComposerTubeEndpointSnap | null,
): ComposerTubeElement {
  return {
    ...element,
    x: startPoint.x,
    y: startPoint.y,
    points: [0, 0, endPoint.x - startPoint.x, endPoint.y - startPoint.y],
    rotation: 0,
    startSnap,
    endSnap,
  };
}

function createPartElement(part: ChemistryLineArtPart, partIndex: number): ComposerPartElement {
  const containerState = createChemistryEditableContainerStateForPart(part);
  return {
    kind: 'part',
    id: createElementId('part'),
    partId: part.id,
    name: part.name,
    src: buildChemistryLineArtPartRenderSrc(part, containerState),
    x: 230 + partIndex * 22,
    y: 116 + partIndex * 12,
    width: part.defaultWidthPx,
    height: part.defaultHeightPx,
    rotation:
      containerState && containerState.orientationPreset !== 'custom'
        ? resolveChemistryContainerPresetRotation(containerState.orientationPreset)
        : 0,
    containerState,
  };
}

function markContainerOrientationAsCustom(element: ComposerPartElement, nextRotation: number): ComposerPartElement {
  if (!element.containerState || Math.abs(nextRotation - element.rotation) < 0.01) {
    return {
      ...element,
      rotation: nextRotation,
    };
  }

  return {
    ...element,
    rotation: nextRotation,
    containerState: {
      ...element.containerState,
      orientationPreset: 'custom',
    },
  };
}

export function ChemistryComposerDialog({
  isOpen,
  onClose,
  onInsertComposition,
}: ChemistryComposerDialogProps): JSX.Element | null {
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [partCategory, setPartCategory] = useState<ChemistryLineArtPartCategory>(
    chemistryLineArtPartCategories[0],
  );
  const [elements, setElements] = useState<ComposerElement[]>([]);
  const [pastElements, setPastElements] = useState<ComposerElement[][]>([]);
  const [futureElements, setFutureElements] = useState<ComposerElement[][]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('澄清石灰水');
  const [activeTubeHandle, setActiveTubeHandle] = useState<{
    tubeId: string;
    endpoint: ComposerTubeEndpoint;
    position: Point2D;
  } | null>(null);
  const [hoverSnapTarget, setHoverSnapTarget] = useState<ConnectorTarget | null>(null);
  const visibleParts = chemistryLineArtParts.filter((part) => part.category === partCategory);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const selectedPartElement =
    selectedElement && selectedElement.kind === 'part' ? (selectedElement as ComposerPartElement) : null;
  const selectedTubeElement =
    selectedElement && selectedElement.kind === 'tube' ? (selectedElement as ComposerTubeElement) : null;
  const selectedPartDefinition = selectedPartElement
    ? getChemistryLineArtPartById(selectedPartElement.partId)
    : null;
  const selectedContainerDefinition = selectedPartDefinition?.editableContainer ?? null;
  const selectedContainerState = selectedPartElement?.containerState ?? null;

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage || !selectedElementId || selectedElement?.kind === 'tube') {
      transformer?.nodes([]);
      return;
    }

    const selectedNode = stage.findOne(`#${selectedElementId}`);
    transformer.nodes(selectedNode ? [selectedNode] : []);
    transformer.getLayer()?.batchDraw();
  }, [elements, selectedElementId]);

  const resolveConnectorTargets = (currentElements: ComposerElement[]): ConnectorTarget[] =>
    currentElements.flatMap((element) => {
      if (element.kind !== 'part') {
        return [];
      }

      const partDefinition = getChemistryLineArtPartById(element.partId);
      if (!partDefinition?.connectors?.length) {
        return [];
      }

      return partDefinition.connectors.map((connector) => ({
        partElementId: element.id,
        connectorId: connector.id,
        name: partDefinition.name,
        description: connector.description,
        position: resolvePartConnectorPosition(element, connector),
      }));
    });

  const findNearestConnectorTarget = (
    currentElements: ComposerElement[],
    point: Point2D,
    excludedPartElementId?: string | null,
  ): ConnectorTarget | null => {
    let nearestTarget: ConnectorTarget | null = null;
    let nearestDistance = connectorSnapThresholdPx;

    for (const target of resolveConnectorTargets(currentElements)) {
      if (excludedPartElementId && target.partElementId === excludedPartElementId) {
        continue;
      }

      const distance = Math.hypot(target.position.x - point.x, target.position.y - point.y);
      if (distance <= nearestDistance) {
        nearestDistance = distance;
        nearestTarget = target;
      }
    }

    return nearestTarget;
  };

  const synchronizeTubeSnapTargets = (currentElements: ComposerElement[]): ComposerElement[] => {
    const connectorTargets = resolveConnectorTargets(currentElements);
    let didChange = false;

    const nextElements = currentElements.map((element) => {
      if (element.kind !== 'tube' || (!element.startSnap && !element.endSnap)) {
        return element;
      }

      const currentEndpoints = resolveTubeEndpointPositions(element);
      const snappedStartTarget = element.startSnap
        ? connectorTargets.find(
            (target) =>
              target.partElementId === element.startSnap?.partElementId &&
              target.connectorId === element.startSnap?.connectorId,
          ) ?? null
        : null;
      const snappedEndTarget = element.endSnap
        ? connectorTargets.find(
            (target) =>
              target.partElementId === element.endSnap?.partElementId &&
              target.connectorId === element.endSnap?.connectorId,
          ) ?? null
        : null;

      const nextElement = buildTubeElementFromEndpoints(
        element,
        snappedStartTarget?.position ?? currentEndpoints.start,
        snappedEndTarget?.position ?? currentEndpoints.end,
        snappedStartTarget ? element.startSnap : null,
        snappedEndTarget ? element.endSnap : null,
      );

      if (
        nextElement.x !== element.x ||
        nextElement.y !== element.y ||
        nextElement.rotation !== element.rotation ||
        nextElement.points.some((point, index) => point !== element.points[index]) ||
        nextElement.startSnap?.partElementId !== element.startSnap?.partElementId ||
        nextElement.startSnap?.connectorId !== element.startSnap?.connectorId ||
        nextElement.endSnap?.partElementId !== element.endSnap?.partElementId ||
        nextElement.endSnap?.connectorId !== element.endSnap?.connectorId
      ) {
        didChange = true;
        return nextElement;
      }

      return element;
    });

    return didChange ? nextElements : currentElements;
  };

  if (!isOpen) {
    return null;
  }

  const commitElements = (updater: (currentElements: ComposerElement[]) => ComposerElement[]): void => {
    setElements((currentElements) => {
      const nextElements = synchronizeTubeSnapTargets(updater(currentElements));
      if (nextElements === currentElements) {
        return currentElements;
      }

      setPastElements((history) => [...history, currentElements]);
      setFutureElements([]);
      return nextElements;
    });
  };

  const updateElement = (nextElement: ComposerElement): void => {
    commitElements((currentElements) =>
      currentElements.map((element) => (element.id === nextElement.id ? nextElement : element)),
    );
  };

  const buildTubeHandlePosition = (
    tubeElement: ComposerTubeElement,
    endpoint: ComposerTubeEndpoint,
  ): Point2D => {
    if (activeTubeHandle && activeTubeHandle.tubeId === tubeElement.id && activeTubeHandle.endpoint === endpoint) {
      return activeTubeHandle.position;
    }

    const endpoints = resolveTubeEndpointPositions(tubeElement);
    return endpoint === 'start' ? endpoints.start : endpoints.end;
  };

  const commitTubeEndpointDrag = (
    tubeElement: ComposerTubeElement,
    endpoint: ComposerTubeEndpoint,
    point: Point2D,
    snapTarget: ConnectorTarget | null,
  ): void => {
    const currentEndpoints = resolveTubeEndpointPositions(tubeElement);
    const nextStartPoint = endpoint === 'start' ? point : currentEndpoints.start;
    const nextEndPoint = endpoint === 'end' ? point : currentEndpoints.end;
    const nextStartSnap =
      endpoint === 'start' && snapTarget
        ? { partElementId: snapTarget.partElementId, connectorId: snapTarget.connectorId }
        : endpoint === 'start'
          ? null
          : tubeElement.startSnap;
    const nextEndSnap =
      endpoint === 'end' && snapTarget
        ? { partElementId: snapTarget.partElementId, connectorId: snapTarget.connectorId }
        : endpoint === 'end'
          ? null
          : tubeElement.endSnap;

    updateElement(buildTubeElementFromEndpoints(tubeElement, nextStartPoint, nextEndPoint, nextStartSnap, nextEndSnap));
  };

  const addPart = (part: ChemistryLineArtPart): void => {
    const offset = elements.length % 5;
    const nextElement: ComposerElement = createPartElement(part, offset);
    commitElements((currentElements) => [...currentElements, nextElement]);
    setSelectedElementId(nextElement.id);
  };

  const addTube = (): void => {
    const nextElement: ComposerElement = {
      kind: 'tube',
      id: createElementId('tube'),
      x: 292,
      y: 228,
      points: [0, 0, 148, 0],
      rotation: 0,
      startSnap: null,
      endSnap: null,
    };
    commitElements((currentElements) => [...currentElements, nextElement]);
    setSelectedElementId(nextElement.id);
  };

  const addLabel = (): void => {
    const text = labelDraft.trim() || '标签';
    const nextElement: ComposerElement = {
      kind: 'label',
      id: createElementId('label'),
      text,
      x: 320,
      y: 316,
      fontSize: 18,
      rotation: 0,
    };
    commitElements((currentElements) => [...currentElements, nextElement]);
    setSelectedElementId(nextElement.id);
  };

  const deleteSelectedElement = (): void => {
    if (!selectedElementId) {
      return;
    }

    commitElements((currentElements) => currentElements.filter((element) => element.id !== selectedElementId));
    setSelectedElementId(null);
  };

  const scaleSelectedElement = (scaleRatio: number): void => {
    if (!selectedElementId) {
      return;
    }

    commitElements((currentElements) =>
      currentElements.map((element) => {
        if (element.id !== selectedElementId) {
          return element;
        }

        if (element.kind === 'part') {
          return {
            ...element,
            width: Math.max(28, element.width * scaleRatio),
            height: Math.max(28, element.height * scaleRatio),
          };
        }

        if (element.kind === 'label') {
          return {
            ...element,
            fontSize: Math.max(10, Math.min(42, Math.round(element.fontSize * scaleRatio))),
          };
        }

        return {
          ...element,
          points: transformPoints(element.points, scaleRatio, scaleRatio),
          startSnap: null,
          endSnap: null,
        };
      }),
    );
  };

  const rotateSelectedElement = (rotationDelta: number): void => {
    if (!selectedElementId) {
      return;
    }

    commitElements((currentElements) =>
      currentElements.map((element) => {
        if (element.id !== selectedElementId) {
          return element;
        }

        if (element.kind === 'part') {
          return markContainerOrientationAsCustom(element, element.rotation + rotationDelta);
        }

        if (element.kind === 'tube') {
          return {
            ...element,
            rotation: element.rotation + rotationDelta,
            startSnap: null,
            endSnap: null,
          };
        }

        return {
          ...element,
          rotation: element.rotation + rotationDelta,
        };
      }),
    );
  };

  const updateSelectedContainerState = (
    updater: (state: ChemistryEditableContainerState) => ChemistryEditableContainerState,
  ): void => {
    if (!selectedPartElement || !selectedPartDefinition?.editableContainer || !selectedPartElement.containerState) {
      return;
    }

    const nextState = updater(selectedPartElement.containerState);
    updateElement({
      ...selectedPartElement,
      src: buildChemistryLineArtPartRenderSrc(selectedPartDefinition, nextState),
      containerState: nextState,
    });
  };

  const applySelectedOrientationPreset = (
    preset: Exclude<ChemistryContainerOrientationPreset, 'custom'>,
  ): void => {
    if (!selectedPartElement || !selectedPartDefinition || !selectedPartElement.containerState) {
      return;
    }

    const nextContainerState: ChemistryEditableContainerState = {
      ...selectedPartElement.containerState,
      orientationPreset: preset,
    };
    updateElement({
      ...selectedPartElement,
      src: buildChemistryLineArtPartRenderSrc(selectedPartDefinition, nextContainerState),
      containerState: nextContainerState,
      rotation: resolveChemistryContainerPresetRotation(preset),
    });
  };

  const resolveSnapTargetFromRef = (
    currentElements: ComposerElement[],
    snapRef: ComposerTubeEndpointSnap | null,
  ): ConnectorTarget | null => {
    if (!snapRef) {
      return null;
    }

    return (
      resolveConnectorTargets(currentElements).find(
        (target) => target.partElementId === snapRef.partElementId && target.connectorId === snapRef.connectorId,
      ) ?? null
    );
  };

  const handleTubeEndpointDragMove = (
    tubeElement: ComposerTubeElement,
    endpoint: ComposerTubeEndpoint,
    point: Point2D,
  ): void => {
    const snapTarget = findNearestConnectorTarget(elements, point);
    setHoverSnapTarget(snapTarget);
    setActiveTubeHandle({
      tubeId: tubeElement.id,
      endpoint,
      position: snapTarget?.position ?? point,
    });
  };

  const handleTubeEndpointDragEnd = (
    tubeElement: ComposerTubeElement,
    endpoint: ComposerTubeEndpoint,
    point: Point2D,
  ): void => {
    const snapTarget = findNearestConnectorTarget(elements, point);
    commitTubeEndpointDrag(tubeElement, endpoint, snapTarget?.position ?? point, snapTarget);
    setActiveTubeHandle(null);
    setHoverSnapTarget(null);
  };

  const undoComposerChange = (): void => {
    setElements((currentElements) => {
      const previousElements = pastElements[pastElements.length - 1];
      if (!previousElements) {
        return currentElements;
      }

      setPastElements((history) => history.slice(0, -1));
      setFutureElements((history) => [currentElements, ...history]);
      setSelectedElementId(null);
      return previousElements;
    });
  };

  const redoComposerChange = (): void => {
    setElements((currentElements) => {
      const nextElements = futureElements[0];
      if (!nextElements) {
        return currentElements;
      }

      setFutureElements((history) => history.slice(1));
      setPastElements((history) => [...history, currentElements]);
      setSelectedElementId(null);
      return nextElements;
    });
  };

  const clearComposer = (): void => {
    if (elements.length === 0) {
      return;
    }

    commitElements(() => []);
    setSelectedElementId(null);
  };

  const insertComposition = (): void => {
    const stage = stageRef.current;
    const transformer = transformerRef.current;
    if (!stage) {
      return;
    }

    // 导出前临时隐藏选框，避免把编辑状态带进最终图片。
    transformer?.visible(false);
    transformer?.getLayer()?.batchDraw();
    const src = stage.toDataURL({
      mimeType: 'image/png',
      pixelRatio: 2,
    });
    transformer?.visible(true);
    transformer?.getLayer()?.batchDraw();

    onInsertComposition({
      src,
      title: '化学组合图式',
      widthPx: 520,
      heightPx: 314,
    });
    onClose();
  };

  return (
    <div className="chemistry-composer-backdrop" role="dialog" aria-modal="true" aria-label="化学图式组合设计器">
      <div className="chemistry-composer-dialog">
        <header className="chemistry-composer-header">
          <div>
            <strong>化学图式组合设计器</strong>
            <span>Konva 画布</span>
          </div>
          <button type="button" className="chemistry-composer-close" aria-label="关闭组合设计器" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="chemistry-composer-body">
          <aside className="chemistry-composer-library" aria-label="化学线稿部件">
            <div className="chemistry-composer-tabs" role="tablist" aria-label="部件分类">
              {chemistryLineArtPartCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={category === partCategory ? 'active' : ''}
                  role="tab"
                  aria-selected={category === partCategory}
                  onClick={() => setPartCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="chemistry-composer-part-grid">
              {visibleParts.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  className="chemistry-composer-part-card"
                  title={`${part.description}；${part.sourceLabel}，授权：${part.license}`}
                  onClick={() => addPart(part)}
                >
                  <span aria-hidden="true">
                    <img src={part.src} alt="" />
                  </span>
                  <strong>{part.name}</strong>
                </button>
              ))}
            </div>
          </aside>

          <section className="chemistry-composer-workbench" aria-label="组合画布">
            <div className="chemistry-composer-toolbar" aria-label="组合编辑操作">
              <button type="button" title="撤销" aria-label="撤销" disabled={pastElements.length === 0} onClick={undoComposerChange}>
                <Undo2 size={16} />
              </button>
              <button type="button" title="重做" aria-label="重做" disabled={futureElements.length === 0} onClick={redoComposerChange}>
                <Redo2 size={16} />
              </button>
              <span />
              <button type="button" title="添加导管线" aria-label="添加导管线" onClick={addTube}>
                <Plus size={16} />
                <span>导管线</span>
              </button>
              <label className="chemistry-composer-label-input">
                <Type size={16} />
                <input
                  aria-label="标签文字"
                  value={labelDraft}
                  onChange={(event) => setLabelDraft(event.target.value)}
                />
              </label>
              <button type="button" title="添加标签" aria-label="添加标签" onClick={addLabel}>
                <Type size={16} />
                <span>标签</span>
              </button>
              <span />
              <button
                type="button"
                title="缩小选中元素"
                aria-label="缩小选中元素"
                disabled={!selectedElement}
                onClick={() => scaleSelectedElement(0.9)}
              >
                <Minus size={16} />
              </button>
              <button
                type="button"
                title="放大选中元素"
                aria-label="放大选中元素"
                disabled={!selectedElement}
                onClick={() => scaleSelectedElement(1.1)}
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                title="逆时针旋转"
                aria-label="逆时针旋转"
                disabled={!selectedElement}
                onClick={() => rotateSelectedElement(-15)}
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                title="顺时针旋转"
                aria-label="顺时针旋转"
                disabled={!selectedElement}
                onClick={() => rotateSelectedElement(15)}
              >
                <RotateCw size={16} />
              </button>
              <button
                type="button"
                title="删除选中元素"
                aria-label="删除选中元素"
                disabled={!selectedElement}
                onClick={deleteSelectedElement}
              >
                <Trash2 size={16} />
              </button>
              <button type="button" title="清空画布" aria-label="清空画布" disabled={elements.length === 0} onClick={clearComposer}>
                <Eraser size={16} />
              </button>
            </div>

            <div className="chemistry-composer-stage-shell">
              <Stage
                ref={stageRef}
                width={composerWidth}
                height={composerHeight}
                className="chemistry-composer-stage"
                onMouseDown={(event) => {
                  if (event.target === event.target.getStage()) {
                    setSelectedElementId(null);
                    setActiveTubeHandle(null);
                    setHoverSnapTarget(null);
                  }
                }}
                onTouchStart={(event) => {
                  if (event.target === event.target.getStage()) {
                    setSelectedElementId(null);
                    setActiveTubeHandle(null);
                    setHoverSnapTarget(null);
                  }
                }}
              >
                <Layer>
                  <Rect x={0} y={0} width={composerWidth} height={composerHeight} fill="#ffffff" />
                  <Rect
                    x={28}
                    y={28}
                    width={composerWidth - 56}
                    height={composerHeight - 56}
                    fill="#ffffff"
                    stroke="#d7e1ea"
                    strokeWidth={1}
                  />
                  {elements.map((element) => {
                    if (element.kind === 'part') {
                      return (
                        <ComposerPartShape
                          key={element.id}
                          element={element}
                          isSelected={element.id === selectedElementId}
                          onSelect={() => {
                            setSelectedElementId(element.id);
                            setActiveTubeHandle(null);
                            setHoverSnapTarget(null);
                          }}
                          onCommit={updateElement}
                        />
                      );
                    }

                    if (element.kind === 'label') {
                      return (
                        <KonvaText
                          key={element.id}
                          id={element.id}
                          text={element.text}
                          x={element.x}
                          y={element.y}
                          fontSize={element.fontSize}
                          fontFamily="Arial, Microsoft YaHei, sans-serif"
                          fill="#111827"
                          rotation={element.rotation}
                          draggable
                          onClick={() => {
                            setSelectedElementId(element.id);
                            setActiveTubeHandle(null);
                            setHoverSnapTarget(null);
                          }}
                          onTap={() => {
                            setSelectedElementId(element.id);
                            setActiveTubeHandle(null);
                            setHoverSnapTarget(null);
                          }}
                          onDragEnd={(event) => {
                            updateElement({
                              ...element,
                              x: event.target.x(),
                              y: event.target.y(),
                            });
                          }}
                          onTransformEnd={(event) => {
                            const node = event.target;
                            const nextFontSize = Math.max(10, Math.min(42, element.fontSize * node.scaleX()));
                            node.scaleX(1);
                            node.scaleY(1);
                            updateElement({
                              ...element,
                              x: node.x(),
                              y: node.y(),
                              fontSize: nextFontSize,
                              rotation: node.rotation(),
                            });
                          }}
                        />
                      );
                    }

                    const snappedStartTarget = resolveSnapTargetFromRef(elements, element.startSnap);
                    const snappedEndTarget = resolveSnapTargetFromRef(elements, element.endSnap);
                    const startHandlePosition = buildTubeHandlePosition(element, 'start');
                    const endHandlePosition = buildTubeHandlePosition(element, 'end');

                    return (
                      <Fragment key={element.id}>
                        <Line
                          id={element.id}
                          x={element.x}
                          y={element.y}
                          points={element.points}
                          rotation={element.rotation}
                          stroke="#111827"
                          strokeWidth={4}
                          lineCap="round"
                          lineJoin="round"
                          draggable
                          onClick={() => {
                            setSelectedElementId(element.id);
                            setActiveTubeHandle(null);
                            setHoverSnapTarget(null);
                          }}
                          onTap={() => {
                            setSelectedElementId(element.id);
                            setActiveTubeHandle(null);
                            setHoverSnapTarget(null);
                          }}
                          onDragEnd={(event) => {
                            updateElement({
                              ...element,
                              x: event.target.x(),
                              y: event.target.y(),
                              startSnap: null,
                              endSnap: null,
                            });
                            setHoverSnapTarget(null);
                            setActiveTubeHandle(null);
                          }}
                          onTransformEnd={(event) => {
                            const node = event.target;
                            const nextPoints = transformPoints(element.points, node.scaleX(), node.scaleY());
                            node.scaleX(1);
                            node.scaleY(1);
                            updateElement({
                              ...element,
                              x: node.x(),
                              y: node.y(),
                              points: nextPoints,
                              rotation: node.rotation(),
                              startSnap: null,
                              endSnap: null,
                            });
                            setHoverSnapTarget(null);
                            setActiveTubeHandle(null);
                          }}
                        />
                        {snappedStartTarget ? (
                          <Circle
                            x={snappedStartTarget.position.x}
                            y={snappedStartTarget.position.y}
                            radius={5}
                            fill="#176b7a"
                            stroke="#ffffff"
                            strokeWidth={2}
                            listening={false}
                          />
                        ) : null}
                        {snappedEndTarget ? (
                          <Circle
                            x={snappedEndTarget.position.x}
                            y={snappedEndTarget.position.y}
                            radius={5}
                            fill="#176b7a"
                            stroke="#ffffff"
                            strokeWidth={2}
                            listening={false}
                          />
                        ) : null}
                        {element.id === selectedElementId ? (
                          <>
                            <Circle
                              x={startHandlePosition.x}
                              y={startHandlePosition.y}
                              radius={8}
                              fill="#ffffff"
                              stroke="#0d5663"
                              strokeWidth={2}
                              draggable
                              onDragStart={() =>
                                setActiveTubeHandle({
                                  tubeId: element.id,
                                  endpoint: 'start',
                                  position: startHandlePosition,
                                })
                              }
                              onDragMove={(event) =>
                                handleTubeEndpointDragMove(element, 'start', {
                                  x: event.target.x(),
                                  y: event.target.y(),
                                })
                              }
                              onDragEnd={(event) =>
                                handleTubeEndpointDragEnd(element, 'start', {
                                  x: event.target.x(),
                                  y: event.target.y(),
                                })
                              }
                            />
                            <Circle
                              x={endHandlePosition.x}
                              y={endHandlePosition.y}
                              radius={8}
                              fill="#ffffff"
                              stroke="#0d5663"
                              strokeWidth={2}
                              draggable
                              onDragStart={() =>
                                setActiveTubeHandle({
                                  tubeId: element.id,
                                  endpoint: 'end',
                                  position: endHandlePosition,
                                })
                              }
                              onDragMove={(event) =>
                                handleTubeEndpointDragMove(element, 'end', {
                                  x: event.target.x(),
                                  y: event.target.y(),
                                })
                              }
                              onDragEnd={(event) =>
                                handleTubeEndpointDragEnd(element, 'end', {
                                  x: event.target.x(),
                                  y: event.target.y(),
                                })
                              }
                            />
                          </>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {hoverSnapTarget ? (
                    <Circle
                      x={hoverSnapTarget.position.x}
                      y={hoverSnapTarget.position.y}
                      radius={10}
                      fill="rgb(23 107 122 / 15%)"
                      stroke="#176b7a"
                      strokeWidth={2}
                      listening={false}
                    />
                  ) : null}
                  <Transformer ref={transformerRef} rotateEnabled enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']} />
                </Layer>
              </Stage>
            </div>
          </section>

          <aside className="chemistry-composer-inspector" aria-label="容器属性">
            <div className="chemistry-composer-inspector-head">
              <strong>容器属性</strong>
              <span>{selectedPartDefinition?.name ?? '未选中元素'}</span>
            </div>

            {selectedPartElement && selectedPartDefinition && selectedContainerDefinition && selectedContainerState ? (
              <div className="chemistry-composer-inspector-body">
                <div className="chemistry-composer-inspector-card">
                  <strong>{selectedPartDefinition.name}</strong>
                  <span>{selectedPartDefinition.category}</span>
                </div>

                <label className="chemistry-composer-inspector-toggle">
                  <input
                    type="checkbox"
                    checked={selectedContainerState.showLiquid}
                    onChange={(event) =>
                      updateSelectedContainerState((state) => ({
                        ...state,
                        showLiquid: event.target.checked,
                      }))
                    }
                  />
                  <span>显示液面</span>
                </label>

                <label className="chemistry-composer-inspector-range">
                  <span>液面高度</span>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    step={1}
                    value={selectedContainerState.liquidLevel}
                    disabled={!selectedContainerState.showLiquid}
                    onChange={(event) =>
                      updateSelectedContainerState((state) => ({
                        ...state,
                        liquidLevel: Number(event.target.value),
                      }))
                    }
                  />
                  <small>{selectedContainerState.liquidLevel}%</small>
                </label>

                {selectedContainerDefinition.supportsScaleMarks ? (
                  <label className="chemistry-composer-inspector-toggle">
                    <input
                      type="checkbox"
                      checked={selectedContainerState.showScaleMarks}
                      onChange={(event) =>
                        updateSelectedContainerState((state) => ({
                          ...state,
                          showScaleMarks: event.target.checked,
                        }))
                      }
                    />
                    <span>显示刻度</span>
                  </label>
                ) : null}

                {selectedContainerDefinition.supportsStopper ? (
                  <label className="chemistry-composer-inspector-toggle">
                    <input
                      type="checkbox"
                      checked={selectedContainerState.showStopper}
                      onChange={(event) =>
                        updateSelectedContainerState((state) => ({
                          ...state,
                          showStopper: event.target.checked,
                        }))
                      }
                    />
                    <span>显示塞子</span>
                  </label>
                ) : null}

                {selectedContainerDefinition.supportsValve ? (
                  <label className="chemistry-composer-inspector-toggle">
                    <input
                      type="checkbox"
                      checked={selectedContainerState.valveOpen}
                      onChange={(event) =>
                        updateSelectedContainerState((state) => ({
                          ...state,
                          valveOpen: event.target.checked,
                        }))
                      }
                    />
                    <span>打开阀门</span>
                  </label>
                ) : null}

                {selectedContainerDefinition.orientationPresets.length > 1 ? (
                  <div className="chemistry-composer-inspector-group">
                    <span>姿态预设</span>
                    <div className="chemistry-composer-preset-group">
                      {selectedContainerDefinition.orientationPresets.map(
                        (preset: Exclude<ChemistryContainerOrientationPreset, 'custom'>) => (
                          <button
                            key={preset}
                            type="button"
                            className={
                              selectedContainerState.orientationPreset === preset
                                ? 'chemistry-composer-preset-button active'
                                : 'chemistry-composer-preset-button'
                            }
                            onClick={() => applySelectedOrientationPreset(preset)}
                          >
                            {preset === 'upright' ? '正放' : preset === 'tilted' ? '斜放' : '倒置'}
                          </button>
                        ),
                      )}
                    </div>
                    <small>
                      当前姿态：
                      {selectedContainerState.orientationPreset === 'custom'
                        ? '自定义旋转'
                        : selectedContainerState.orientationPreset === 'upright'
                          ? '正放'
                          : selectedContainerState.orientationPreset === 'tilted'
                            ? '斜放'
                            : '倒置'}
                    </small>
                  </div>
                ) : (
                  <div className="chemistry-composer-inspector-hint">
                    当前容器仅支持常规正放展示。
                  </div>
                )}

                <div className="chemistry-composer-inspector-hint">
                  容器状态会跟随当前组合图一起导出到文档图片，不会新增 `.layout` 化学块类型。
                </div>
              </div>
            ) : selectedPartElement ? (
              <div className="chemistry-composer-inspector-empty">
                当前选中的是“{selectedPartElement.name}”，它还没有容器属性设置；可继续拖拽、缩放、旋转和导出。
              </div>
            ) : (
              <div className="chemistry-composer-inspector-empty">
                选中试管、烧杯、量筒、烧瓶、分液漏斗或滴定管等器材后，这里会显示液面、刻度、塞子、阀门和姿态设置。
              </div>
            )}
          </aside>
        </div>

        <footer className="chemistry-composer-footer">
          <button type="button" className="chemistry-composer-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="chemistry-composer-primary" onClick={insertComposition}>
            插入到文档
          </button>
        </footer>
      </div>
    </div>
  );
}
