import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChemistryLineArtPartRenderSrc,
  createChemistryEditableContainerStateForPart,
  getChemistryLineArtPartById,
} from './chemistryApparatus';

test('PH2-05B 特殊容器编辑：分液漏斗与滴定管已纳入可编辑容器范围', () => {
  const separatoryFunnel = getChemistryLineArtPartById('part-separatory-funnel');
  const burette = getChemistryLineArtPartById('part-burette');

  assert(separatoryFunnel?.editableContainer, '分液漏斗现在应支持容器属性编辑。');
  assert.equal(separatoryFunnel.editableContainer.kind, 'separatoryFunnel');
  assert.equal(separatoryFunnel.editableContainer.supportsValve, true);

  assert(burette?.editableContainer, '滴定管现在应支持容器属性编辑。');
  assert.equal(burette.editableContainer.kind, 'burette');
  assert.equal(burette.editableContainer.supportsValve, true);
  assert.equal(burette.editableContainer.supportsScaleMarks, true);
});

test('PH2-05B 特殊容器编辑：阀门开关会改变动态 SVG 渲染结果', () => {
  const separatoryFunnel = getChemistryLineArtPartById('part-separatory-funnel');
  const burette = getChemistryLineArtPartById('part-burette');

  assert(separatoryFunnel, '应能找到分液漏斗部件。');
  assert(burette, '应能找到滴定管部件。');

  const separatoryState = createChemistryEditableContainerStateForPart(separatoryFunnel);
  const buretteState = createChemistryEditableContainerStateForPart(burette);

  assert(separatoryState, '分液漏斗应能生成默认容器状态。');
  assert(buretteState, '滴定管应能生成默认容器状态。');

  const separatoryClosedSrc = buildChemistryLineArtPartRenderSrc(separatoryFunnel, separatoryState);
  const separatoryOpenSrc = buildChemistryLineArtPartRenderSrc(separatoryFunnel, {
    ...separatoryState,
    valveOpen: true,
  });
  const buretteClosedSrc = buildChemistryLineArtPartRenderSrc(burette, buretteState);
  const buretteOpenSrc = buildChemistryLineArtPartRenderSrc(burette, {
    ...buretteState,
    valveOpen: true,
  });

  assert(separatoryClosedSrc.startsWith('data:image/svg+xml'), '分液漏斗应输出 SVG data URI。');
  assert(buretteClosedSrc.startsWith('data:image/svg+xml'), '滴定管应输出 SVG data URI。');
  assert.notEqual(separatoryClosedSrc, separatoryOpenSrc, '分液漏斗阀门开关应影响渲染结果。');
  assert.notEqual(buretteClosedSrc, buretteOpenSrc, '滴定管阀门开关应影响渲染结果。');
});
