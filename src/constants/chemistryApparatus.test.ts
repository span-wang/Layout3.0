import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChemistryLineArtPartRenderSrc,
  chemistryApparatusItems,
  chemistryLineArtParts,
  createChemistryEditableContainerStateForPart,
  getChemistryApparatusById,
  getChemistryLineArtPartById,
} from './chemistryApparatus';

function decodeSvgDataUri(src: string): string {
  const prefix = 'data:image/svg+xml;charset=UTF-8,';
  assert(src.startsWith(prefix), '化学素材应输出 SVG data URI。');
  return decodeURIComponent(src.slice(prefix.length));
}

function assertNoCanvasWhiteBackground(svg: string): void {
  assert(!svg.includes('<rect width="400" height="240" fill="#ffffff"/>'), '成套模板不能再带整张白底。');
  assert(!svg.includes('<rect width="220" height="170" fill="#ffffff"/>'), '单个部件不能再带整张白底。');
}

function extractLiquidPath(svg: string): string {
  const match = svg.match(/<path class="liquid" d="([^"]+)"/);
  assert(match, '应能找到液面路径。');
  return match[1];
}

function assertNearHorizontalMeniscus(path: string): void {
  const match = path.match(/^M([\d.]+) ([\d.]+)Q([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/);
  assert(match, `液面路径应以近水平上边界开始，当前为：${path}`);
  const startY = Number(match[2]);
  const controlY = Number(match[4]);
  const endY = Number(match[6]);
  assert(Math.abs(startY - endY) < 0.01, `液面左右两端应基本等高：${path}`);
  assert(controlY >= startY, `弯月面中部不应高于两侧：${path}`);
  assert(controlY - startY <= 4.5, `弯月面下垂不应过大：${path}`);
}

test('PH2-05B 化学科学制图透明底：模板与部件 SVG 不再内置白色画布背景', () => {
  for (const item of chemistryApparatusItems) {
    assertNoCanvasWhiteBackground(decodeSvgDataUri(item.src));
  }

  for (const part of chemistryLineArtParts) {
    assertNoCanvasWhiteBackground(decodeSvgDataUri(part.src));
  }
});

test('PH2-05B 化学科学制图返工：高频基础器材具备教学制图关键细节', () => {
  const expectations = [
    { id: 'part-test-tube', snippets: ['ellipse class="outline" cx="110" cy="22"', 'class="liquid"', 'v80'] },
    { id: 'part-beaker', snippets: ['q35 9 70 0', 'M82 53h18', 'class="liquid"'] },
    { id: 'part-conical-flask', snippets: ['ellipse class="outline" cx="110" cy="22"', 'l-39 61', 'class="liquid"'] },
    { id: 'part-gas-jar', snippets: ['ellipse class="outline" cx="110" cy="27"', 'M95 62h30', 'M88 124'] },
    { id: 'part-graduated-cylinder', snippets: ['M98 45h18', 'M98 117h10', 'M72 143h76'] },
    { id: 'part-funnel', snippets: ['ellipse class="outline" cx="110" cy="31"', 'M57 31l46 58', 'M110 132v16'] },
    { id: 'part-straight-tube', snippets: ['M42 76h136', 'M42 76q-8 7 0 14'] },
    { id: 'part-bent-tube', snippets: ['q0-21 21-21', 'M55 123q7 7 14 0'] },
    { id: 'part-single-hole-stopper', snippets: ['ellipse cx="110" cy="73"', 'M58 97h104'] },
    { id: 'part-double-hole-stopper', snippets: ['ellipse cx="95" cy="73"', 'ellipse cx="125" cy="73"'] },
    { id: 'part-iron-stand', snippets: ['circle cx="88" cy="56"', 'q22 9 22 19'] },
    { id: 'part-alcohol-lamp', snippets: ['M104 28q-15 20', 'M99 67h10', 'M72 128h64'] },
  ];

  for (const expectation of expectations) {
    const part = getChemistryLineArtPartById(expectation.id);
    assert(part, `应能找到高频部件 ${expectation.id}。`);
    const svg = decodeSvgDataUri(part.src);
    for (const snippet of expectation.snippets) {
      assert(svg.includes(snippet), `${part.name} 缺少科学制图细节：${snippet}`);
    }
  }
});

test('PH2-05B 化学科学制图返工：10 个成套模板包含严谨连接和实验关系', () => {
  const expectations = [
    { id: 'co2-limewater-test', snippets: ['导管伸入液面下', 'M227 144v22'] },
    { id: 'co2-air-collection', snippets: ['向上排空气收集 CO₂', 'M266 164h30'] },
    { id: 'oxygen-water-collection', snippets: ['导管伸入瓶口', '水槽'] },
    { id: 'oxygen-air-collection', snippets: ['空气逸出', 'M294 144Q313 122'] },
    { id: 'heated-test-tube-gas', snippets: ['试管口略向下', 'circle cx="110" cy="101"'] },
    { id: 'conical-flask-gas', snippets: ['长颈漏斗 + 锥形瓶', 'ellipse cx="105" cy="72"'] },
    { id: 'co2-full-test', snippets: ['火焰熄灭', 'ellipse class="outline" cx="210" cy="56"'] },
    { id: 'airtightness-test', snippets: ['导管口有气泡', 'M234 160h34'] },
    { id: 'filtration', snippets: ['玻璃棒引流', 'ellipse class="outline" cx="188" cy="75"'] },
    { id: 'evaporation-dish-heating', snippets: ['玻璃棒搅拌', 'rect x="133" y="143" width="134" height="12"'] },
  ];

  for (const expectation of expectations) {
    const item = getChemistryApparatusById(expectation.id);
    assert(item, `应能找到成套模板 ${expectation.id}。`);
    const svg = decodeSvgDataUri(item.src);
    for (const snippet of expectation.snippets) {
      assert(svg.includes(snippet), `${item.name} 缺少严谨模板细节：${snippet}`);
    }
  }
});

test('PH2-05B 化学科学准确性精修 V2：核心特殊器材和模板关系继续补齐科学细节', () => {
  assert.equal(chemistryLineArtParts.length, 40, '化学组合设计器应继续保留 40 个基础部件。');
  assert.equal(chemistryApparatusItems.length, 10, '化学图式模板库应继续保留 10 个成套模板。');

  const partExpectations = [
    { id: 'part-long-neck-funnel', snippets: ['ellipse class="outline" cx="110" cy="25"', 'M110 134v17'] },
    { id: 'part-separatory-funnel', snippets: ['M101 46q-24 15', 'M106 143h8l-3 18h-2Z'] },
    { id: 'part-burette', snippets: ['M122 36h-12', 'M110 121v16'] },
    { id: 'part-condenser', snippets: ['M55 89h110M55 101h110', 'marker-end="url(#part-arrow)"'] },
  ];

  for (const expectation of partExpectations) {
    const part = getChemistryLineArtPartById(expectation.id);
    assert(part, `应能找到 V2 核心部件 ${expectation.id}。`);
    const svg = decodeSvgDataUri(part.src);
    for (const snippet of expectation.snippets) {
      assert(svg.includes(snippet), `${part.name} 缺少 V2 科学细节：${snippet}`);
    }
  }

  const templateExpectations = [
    { id: 'co2-air-collection', snippets: ['导管接近瓶底'] },
    { id: 'conical-flask-gas', snippets: ['漏斗下端液封'] },
    { id: 'filtration', snippets: ['三靠过滤', 'M188 170q14-8 29-5'] },
    { id: 'evaporation-dish-heating', snippets: ['石棉网承托'] },
  ];

  for (const expectation of templateExpectations) {
    const item = getChemistryApparatusById(expectation.id);
    assert(item, `应能找到 V2 成套模板 ${expectation.id}。`);
    const svg = decodeSvgDataUri(item.src);
    for (const snippet of expectation.snippets) {
      assert(svg.includes(snippet), `${item.name} 缺少 V2 装置关系细节：${snippet}`);
    }
  }
});

test('PH2-05B 烧瓶类液面修正 V3：锥形瓶与烧瓶液面回到近水平自由液面', () => {
  const staticPartIds = ['part-conical-flask', 'part-round-bottom-flask', 'part-flat-bottom-flask'] as const;
  for (const partId of staticPartIds) {
    const part = getChemistryLineArtPartById(partId);
    assert(part, `应能找到部件 ${partId}。`);
    const liquidPath = extractLiquidPath(decodeSvgDataUri(part.src));
    assertNearHorizontalMeniscus(liquidPath);
  }

  const dynamicPartIds = ['part-conical-flask', 'part-round-bottom-flask', 'part-flat-bottom-flask'] as const;
  for (const partId of dynamicPartIds) {
    const part = getChemistryLineArtPartById(partId);
    assert(part, `应能找到动态容器部件 ${partId}。`);
    const state = createChemistryEditableContainerStateForPart(part);
    assert(state, `${part.name} 应能生成默认容器状态。`);
    const liquidPath = extractLiquidPath(decodeSvgDataUri(buildChemistryLineArtPartRenderSrc(part, state)));
    assertNearHorizontalMeniscus(liquidPath);
  }
});

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
  assertNoCanvasWhiteBackground(decodeSvgDataUri(separatoryClosedSrc));
  assertNoCanvasWhiteBackground(decodeSvgDataUri(buretteClosedSrc));
  assert.notEqual(separatoryClosedSrc, separatoryOpenSrc, '分液漏斗阀门开关应影响渲染结果。');
  assert.notEqual(buretteClosedSrc, buretteOpenSrc, '滴定管阀门开关应影响渲染结果。');
});
