import type { Dispatch, SetStateAction } from 'react';
import { getChemistryApparatusById, type ChemistryApparatusId } from '@/constants/chemistryApparatus';
import { type InsertListBlockKind } from '@/engine/document-model';
import { selectLocalImageFile } from '@/services/FileService';
import { useAppStore } from '@/store';
import type { CanvasTextSelectionState } from '@/types/workspace';
import { getBaseNameFromPath } from '@/utils/filePath';

interface UseCanvasInsertCommandsPayload {
  showMessage: (msg: string) => void;
  setCanvasTextSelection: Dispatch<SetStateAction<CanvasTextSelectionState>>;
  setRequestedEditNodeId: Dispatch<SetStateAction<string | null>>;
}

interface CanvasInsertCommands {
  handleInsertImage: () => Promise<void>;
  handleInsertChemistryApparatus: (apparatusId: ChemistryApparatusId) => void;
  handleInsertEquation: () => void;
  handleInsertTable: () => void;
  handleInsertList: (kind: InsertListBlockKind) => void;
  handleInsertParagraph: () => void;
  handleInsertColumnBreak: () => void;
  handleInsertPageBreak: () => void;
  handleInsertToc: () => void;
}

function createEmptySelection(nodeId: string): CanvasTextSelectionState {
  return {
    nodeId,
    text: '',
    selection: null,
    isEditing: false,
    draftTextRuns: null,
  };
}

export function useCanvasInsertCommands({
  showMessage,
  setCanvasTextSelection,
  setRequestedEditNodeId,
}: UseCanvasInsertCommandsPayload): CanvasInsertCommands {
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const setActiveRightPanelTab = useAppStore((state) => state.setActiveRightPanelTab);
  const insertLayoutImageBlock = useAppStore((state) => state.insertLayoutImageBlock);
  const insertLayoutEquationBlock = useAppStore((state) => state.insertLayoutEquationBlock);
  const insertLayoutTableBlock = useAppStore((state) => state.insertLayoutTableBlock);
  const insertLayoutListBlock = useAppStore((state) => state.insertLayoutListBlock);
  const insertLayoutParagraphBlock = useAppStore((state) => state.insertLayoutParagraphBlock);
  const insertLayoutColumnBreakBlock = useAppStore((state) => state.insertLayoutColumnBreakBlock);
  const insertLayoutPageBreakBlock = useAppStore((state) => state.insertLayoutPageBreakBlock);
  const insertLayoutTocBlock = useAppStore((state) => state.insertLayoutTocBlock);
  const selectedNodeId = layoutDocument?.viewState.selectedNodeId ?? null;

  const selectInsertedNode = (nodeId: string): void => {
    setActiveRightPanelTab('对象属性');
    setCanvasTextSelection(createEmptySelection(nodeId));
  };

  const handleInsertImage = async (): Promise<void> => {
    if (!layoutDocument) {
      showMessage('当前没有可插入图片的文档');
      return;
    }

    try {
      const imagePath = await selectLocalImageFile();
      const imageName = getBaseNameFromPath(imagePath);
      const insertedBlockId = insertLayoutImageBlock({
        src: imagePath,
        alt: imageName,
        title: null,
        insertAfterNodeId: selectedNodeId,
      });

      if (!insertedBlockId) {
        showMessage('图片插入失败：当前文档不可写');
        return;
      }

      selectInsertedNode(insertedBlockId);
      showMessage(`已插入图片：${imageName}`);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消选择图片') {
        showMessage('已取消选择图片');
        return;
      }

      const message = error instanceof Error ? error.message : '插入图片失败';
      showMessage(`插入图片失败：${message}`);
    }
  };

  const handleInsertChemistryApparatus = (apparatusId: ChemistryApparatusId): void => {
    if (!layoutDocument) {
      showMessage('当前没有可插入化学图式的文档');
      return;
    }

    const apparatus = getChemistryApparatusById(apparatusId);
    if (!apparatus) {
      showMessage('化学图式插入失败：未找到对应素材');
      return;
    }

    const insertedBlockId = insertLayoutImageBlock({
      src: apparatus.src,
      alt: apparatus.name,
      title: apparatus.name,
      widthPx: apparatus.defaultWidthPx,
      heightPx: apparatus.defaultHeightPx,
      lockAspectRatio: true,
      objectFit: 'contain',
      wrapMode: 'inline',
      insertAfterNodeId: selectedNodeId,
    });

    if (!insertedBlockId) {
      showMessage('化学图式插入失败：当前文档不可写');
      return;
    }

    selectInsertedNode(insertedBlockId);
    showMessage(`已插入化学图式：${apparatus.name}`);
  };

  const handleInsertEquation = (): void => {
    if (!layoutDocument) {
      showMessage('当前没有可插入公式的文档');
      return;
    }

    const insertedBlockId = insertLayoutEquationBlock({
      value: '',
      insertAfterNodeId: selectedNodeId,
    });

    if (!insertedBlockId) {
      showMessage('公式插入失败：当前文档不可写');
      return;
    }

    selectInsertedNode(insertedBlockId);
    setRequestedEditNodeId(insertedBlockId);
    showMessage('已插入公式');
  };

  const handleInsertTable = (): void => {
    if (!layoutDocument) {
      showMessage('当前没有可插入表格的文档');
      return;
    }

    const selectedTableNodeId = insertLayoutTableBlock({
      rowCount: 3,
      columnCount: 3,
      insertAfterNodeId: selectedNodeId,
    });

    if (!selectedTableNodeId) {
      showMessage('表格插入失败：当前文档不可写');
      return;
    }

    selectInsertedNode(selectedTableNodeId);
    showMessage('已插入 3 x 3 表格');
  };

  const handleInsertList = (kind: InsertListBlockKind): void => {
    if (!layoutDocument) {
      showMessage('当前没有可插入列表的文档');
      return;
    }

    const selectedListItemId = insertLayoutListBlock({
      kind,
      insertAfterNodeId: selectedNodeId,
    });

    if (!selectedListItemId) {
      showMessage('列表插入失败：当前文档不可写');
      return;
    }

    const listKindLabel: Record<InsertListBlockKind, string> = {
      unordered: '无序列表',
      ordered: '有序列表',
      task: '任务列表',
    };

    selectInsertedNode(selectedListItemId);
    showMessage(`已插入${listKindLabel[kind]}`);
  };

  const handleInsertParagraph = (): void => {
    if (!layoutDocument) {
      showMessage('当前没有可插入空文本块的文档');
      return;
    }

    const insertedBlockId = insertLayoutParagraphBlock({
      insertAfterNodeId: selectedNodeId,
    });

    if (!insertedBlockId) {
      showMessage('空文本块插入失败：当前文档不可写');
      return;
    }

    selectInsertedNode(insertedBlockId);
    setRequestedEditNodeId(insertedBlockId);
    showMessage('已插入空文本块');
  };

  const handleInsertPageBreak = (): void => {
    if (!layoutDocument) {
      showMessage('当前没有可插入分页符的文档');
      return;
    }

    const insertedBlockId = insertLayoutPageBreakBlock({
      insertAfterNodeId: selectedNodeId,
    });

    if (!insertedBlockId) {
      showMessage('分页符插入失败：当前文档不可写');
      return;
    }

    selectInsertedNode(insertedBlockId);
    showMessage('已插入分页符');
  };

  const handleInsertColumnBreak = (): void => {
    if (!layoutDocument) {
      showMessage('当前没有可插入分栏断点的文档');
      return;
    }

    const insertedBlockId = insertLayoutColumnBreakBlock({
      insertAfterNodeId: selectedNodeId,
    });

    if (!insertedBlockId) {
      showMessage('分栏断点插入失败：当前文档不可写');
      return;
    }

    selectInsertedNode(insertedBlockId);
    showMessage('已插入分栏断点');
  };

  const handleInsertToc = (): void => {
    if (!layoutDocument) {
      showMessage('当前没有可插入目录的文档');
      return;
    }

    const insertedBlockId = insertLayoutTocBlock({
      insertAfterNodeId: selectedNodeId,
    });

    if (!insertedBlockId) {
      showMessage('目录插入失败：当前文档不可写');
      return;
    }

    selectInsertedNode(insertedBlockId);
    showMessage('已插入目录');
  };

  return {
    handleInsertImage,
    handleInsertChemistryApparatus,
    handleInsertEquation,
    handleInsertTable,
    handleInsertList,
    handleInsertParagraph,
    handleInsertColumnBreak,
    handleInsertPageBreak,
    handleInsertToc,
  };
}
