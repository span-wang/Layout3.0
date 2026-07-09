export type ChemistryApparatusCategory = '制气装置' | '收集装置' | '检验装置' | '分离与加热';
export type ChemistryLineArtPartCategory =
  | '容器'
  | '计量器具'
  | '导管与塞'
  | '支架与加热'
  | '分离器材'
  | '操作器材';
export type ChemistryContainerOrientationPreset = 'upright' | 'tilted' | 'inverted' | 'custom';
export type ChemistryEditableContainerKind =
  | 'testTube'
  | 'beaker'
  | 'conicalFlask'
  | 'gasJar'
  | 'roundBottomFlask'
  | 'flatBottomFlask'
  | 'wideMouthBottle'
  | 'reagentBottle'
  | 'graduatedCylinder'
  | 'separatoryFunnel'
  | 'burette'
  | 'waterTrough';

export interface ChemistryEditableContainerState {
  showLiquid: boolean;
  liquidLevel: number;
  showScaleMarks: boolean;
  showStopper: boolean;
  valveOpen: boolean;
  orientationPreset: ChemistryContainerOrientationPreset;
}

export interface ChemistryEditableContainerDefinition {
  kind: ChemistryEditableContainerKind;
  supportsScaleMarks: boolean;
  supportsStopper: boolean;
  supportsValve: boolean;
  orientationPresets: readonly Exclude<ChemistryContainerOrientationPreset, 'custom'>[];
  defaultState: ChemistryEditableContainerState;
}

export interface ChemistryConnectorPointDefinition {
  id: string;
  x: number;
  y: number;
  description: string;
}

export interface ChemistryApparatusItem {
  id: string;
  name: string;
  category: ChemistryApparatusCategory;
  description: string;
  license: '项目原创';
  sourceLabel: string;
  defaultWidthPx: number;
  defaultHeightPx: number;
  src: string;
}

export interface ChemistryLineArtPart {
  id: string;
  name: string;
  category: ChemistryLineArtPartCategory;
  description: string;
  license: '项目原创';
  sourceLabel: string;
  defaultWidthPx: number;
  defaultHeightPx: number;
  src: string;
  editableContainer?: ChemistryEditableContainerDefinition;
  connectors?: readonly ChemistryConnectorPointDefinition[];
}

export const chemistryApparatusCategories: ChemistryApparatusCategory[] = [
  '制气装置',
  '收集装置',
  '检验装置',
  '分离与加热',
];

export const chemistryLineArtPartCategories: ChemistryLineArtPartCategory[] = [
  '容器',
  '计量器具',
  '导管与塞',
  '支架与加热',
  '分离器材',
  '操作器材',
];

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildTemplateSvg(label: string, body: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240" role="img" aria-label="${label}">
  <title>${label}</title>
  <defs>
    <marker id="arrow" markerWidth="7" markerHeight="5" refX="6.5" refY="2.5" orient="auto">
      <path d="M0 0 L7 2.5 L0 5 Z" fill="#0f172a"/>
    </marker>
    <pattern id="dots" width="7" height="7" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="0.95" fill="#0f172a"/>
    </pattern>
  </defs>
  <style>
    svg{background:transparent}
    .scientific-layer{shape-rendering:geometricPrecision;text-rendering:geometricPrecision}
    .outline{fill:none;stroke:#0f172a;stroke-width:1.85;stroke-linecap:round;stroke-linejoin:round}
    .detail{fill:none;stroke:#0f172a;stroke-width:1.05;stroke-linecap:round;stroke-linejoin:round}
    .guide{fill:none;stroke:#475569;stroke-width:0.95;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:3.5 4}
    .liquid{fill:#dff7fb;fill-opacity:.62;stroke:#0f172a;stroke-width:1.05;stroke-linejoin:round}
    .solid{fill:url(#dots);stroke:#0f172a;stroke-width:1.05;stroke-linejoin:round}
    .stopper{fill:#1f2937}
    .label{fill:#0f172a;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:14px;font-weight:600}
    .note{fill:#475569;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:12px}
    .gas{fill:#0f172a;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:17px;font-weight:700}
  </style>
  <g class="scientific-layer">
    ${body}
  </g>
</svg>`.trim();
}

function buildPartSvg(label: string, body: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="170" viewBox="0 0 220 170" role="img" aria-label="${label}">
  <title>${label}</title>
  <defs>
    <pattern id="part-dots" width="7" height="7" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="0.95" fill="#0f172a"/>
    </pattern>
    <marker id="part-arrow" markerWidth="7" markerHeight="5" refX="6.5" refY="2.5" orient="auto">
      <path d="M0 0 L7 2.5 L0 5 Z" fill="#0f172a"/>
    </marker>
  </defs>
  <style>
    svg{background:transparent}
    .scientific-layer{shape-rendering:geometricPrecision}
    .outline{fill:none;stroke:#0f172a;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
    .detail{fill:none;stroke:#0f172a;stroke-width:0.95;stroke-linecap:round;stroke-linejoin:round}
    .liquid{fill:#dff7fb;fill-opacity:.62;stroke:#0f172a;stroke-width:0.95;stroke-linejoin:round}
    .solid{fill:url(#part-dots);stroke:#0f172a;stroke-width:0.95;stroke-linejoin:round}
    .dark{fill:#1f2937}
  </style>
  <g class="scientific-layer">
    ${body}
  </g>
</svg>`.trim();
}

function clampContainerLevel(level: number): number {
  return Math.max(5, Math.min(95, Math.round(level)));
}

function buildLiquidPath(left: number, right: number, top: number, bottom: number, curveDepth: number): string {
  const centerX = (left + right) / 2;
  return `M${left} ${bottom}L${left} ${top}Q${centerX} ${top - curveDepth} ${right} ${top}L${right} ${bottom}Z`;
}

function buildContainedLiquidPath(
  centerX: number,
  topY: number,
  bottomY: number,
  topHalfWidth: number,
  bottomHalfWidth: number,
  meniscusDepth: number,
  baseCurveDepth: number,
): string {
  const topLeft = centerX - topHalfWidth;
  const topRight = centerX + topHalfWidth;
  const bottomLeft = centerX - bottomHalfWidth;
  const bottomRight = centerX + bottomHalfWidth;
  return `M${topLeft} ${topY}Q${centerX} ${topY + meniscusDepth} ${topRight} ${topY}L${bottomRight} ${bottomY}Q${centerX} ${bottomY + baseCurveDepth} ${bottomLeft} ${bottomY}Z`;
}

function buildScaleMarks(
  x: number,
  startY: number,
  endY: number,
  longWidth: number,
  shortWidth: number,
  step: number,
): string {
  const marks: string[] = [];
  let markIndex = 0;
  for (let y = startY; y <= endY; y += step) {
    const width = markIndex % 2 === 0 ? longWidth : shortWidth;
    marks.push(`<path class="detail" d="M${x} ${y}h${width}"/>`);
    markIndex += 1;
  }
  return marks.join('');
}

const editableContainerDefinitions: Record<ChemistryEditableContainerKind, ChemistryEditableContainerDefinition> = {
  testTube: {
    kind: 'testTube',
    supportsScaleMarks: false,
    supportsStopper: true,
    supportsValve: false,
    orientationPresets: ['upright', 'tilted', 'inverted'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 42,
      showScaleMarks: false,
      showStopper: false,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  beaker: {
    kind: 'beaker',
    supportsScaleMarks: true,
    supportsStopper: false,
    supportsValve: false,
    orientationPresets: ['upright', 'tilted'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 48,
      showScaleMarks: true,
      showStopper: false,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  conicalFlask: {
    kind: 'conicalFlask',
    supportsScaleMarks: false,
    supportsStopper: true,
    supportsValve: false,
    orientationPresets: ['upright', 'tilted', 'inverted'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 34,
      showScaleMarks: false,
      showStopper: true,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  gasJar: {
    kind: 'gasJar',
    supportsScaleMarks: true,
    supportsStopper: true,
    supportsValve: false,
    orientationPresets: ['upright', 'inverted'],
    defaultState: {
      showLiquid: false,
      liquidLevel: 22,
      showScaleMarks: true,
      showStopper: false,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  roundBottomFlask: {
    kind: 'roundBottomFlask',
    supportsScaleMarks: false,
    supportsStopper: true,
    supportsValve: false,
    orientationPresets: ['upright', 'tilted', 'inverted'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 32,
      showScaleMarks: false,
      showStopper: true,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  flatBottomFlask: {
    kind: 'flatBottomFlask',
    supportsScaleMarks: false,
    supportsStopper: true,
    supportsValve: false,
    orientationPresets: ['upright', 'tilted', 'inverted'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 35,
      showScaleMarks: false,
      showStopper: true,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  wideMouthBottle: {
    kind: 'wideMouthBottle',
    supportsScaleMarks: false,
    supportsStopper: true,
    supportsValve: false,
    orientationPresets: ['upright', 'tilted'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 40,
      showScaleMarks: false,
      showStopper: false,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  reagentBottle: {
    kind: 'reagentBottle',
    supportsScaleMarks: false,
    supportsStopper: true,
    supportsValve: false,
    orientationPresets: ['upright', 'tilted'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 28,
      showScaleMarks: false,
      showStopper: true,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  graduatedCylinder: {
    kind: 'graduatedCylinder',
    supportsScaleMarks: true,
    supportsStopper: false,
    supportsValve: false,
    orientationPresets: ['upright', 'tilted'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 58,
      showScaleMarks: true,
      showStopper: false,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  separatoryFunnel: {
    kind: 'separatoryFunnel',
    supportsScaleMarks: false,
    supportsStopper: true,
    supportsValve: true,
    orientationPresets: ['upright'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 46,
      showScaleMarks: false,
      showStopper: true,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  burette: {
    kind: 'burette',
    supportsScaleMarks: true,
    supportsStopper: false,
    supportsValve: true,
    orientationPresets: ['upright'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 54,
      showScaleMarks: true,
      showStopper: false,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
  waterTrough: {
    kind: 'waterTrough',
    supportsScaleMarks: false,
    supportsStopper: false,
    supportsValve: false,
    orientationPresets: ['upright'],
    defaultState: {
      showLiquid: true,
      liquidLevel: 62,
      showScaleMarks: false,
      showStopper: false,
      valveOpen: false,
      orientationPreset: 'upright',
    },
  },
};

const testTubeConnectors = [
  { id: 'mouth', x: 103, y: 18, description: '试管口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const beakerConnectors = [
  { id: 'mouth', x: 96, y: 26, description: '烧杯口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const conicalFlaskConnectors = [
  { id: 'mouth', x: 109, y: 20, description: '锥形瓶口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const gasJarConnectors = [
  { id: 'mouth', x: 110, y: 16, description: '集气瓶口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const roundBottomFlaskConnectors = [
  { id: 'mouth', x: 110, y: 18, description: '圆底烧瓶口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const flatBottomFlaskConnectors = [
  { id: 'mouth', x: 110, y: 18, description: '平底烧瓶口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const wideMouthBottleConnectors = [
  { id: 'mouth', x: 110, y: 27, description: '广口瓶口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const reagentBottleConnectors = [
  { id: 'mouth', x: 110, y: 21, description: '试剂瓶口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const graduatedCylinderConnectors = [
  { id: 'mouth', x: 108, y: 27, description: '量筒口' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const waterTroughConnectors = [
  { id: 'mouth', x: 110, y: 56, description: '水槽口沿' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const singleHoleStopperConnectors = [
  { id: 'hole-1', x: 110, y: 74, description: '单孔塞孔' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

const doubleHoleStopperConnectors = [
  { id: 'hole-1', x: 95, y: 74, description: '左塞孔' },
  { id: 'hole-2', x: 125, y: 74, description: '右塞孔' },
] as const satisfies readonly ChemistryConnectorPointDefinition[];

function buildEditableContainerBody(
  label: string,
  kind: ChemistryEditableContainerKind,
  rawState: ChemistryEditableContainerState,
): string {
  const state = {
    ...rawState,
    liquidLevel: clampContainerLevel(rawState.liquidLevel),
  };

  switch (kind) {
    case 'testTube': {
      const liquidTop = 114 - state.liquidLevel * 0.62;
      return buildPartSvg(
        label,
        `
  <ellipse class="outline" cx="110" cy="22" rx="18" ry="5"/>
  <path class="outline" d="M92 22v80q0 24 18 30q18-6 18-30V22"/>
  <path class="detail" d="M98 27v72q0 18 12 24"/>
  <path class="detail" d="M122 27v72q0 18-12 24"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(97, 123, liquidTop, 113, 3)}"/>` : ''}
  ${state.showStopper ? '<path class="dark" d="M91 12h38l-4 12H95z"/><ellipse cx="110" cy="20" rx="5.2" ry="2.8" fill="#ffffff" fill-opacity=".9"/>' : ''}
  `,
      );
    }
    case 'beaker': {
      const liquidTop = 123 - state.liquidLevel * 0.72;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M57 30h81q12 0 17 7q3 5-3 11"/>
  <path class="outline" d="M66 31v90q0 10 10 13h49q10-3 10-13V48"/>
  <path class="detail" d="M66 31q35 9 70 0"/>
  <path class="detail" d="M76 126h49"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(68, 133, liquidTop, 127, 4)}"/>` : ''}
  ${state.showScaleMarks ? buildScaleMarks(82, 53, 111, 18, 10, 10) : ''}
  <path class="detail" d="M140 36q5 2 8 6"/>
  `,
      );
    }
    case 'conicalFlask': {
      const liquidTop = 127 - state.liquidLevel * 0.62;
      const topHalfWidth = Math.max(14, Math.min(33, Math.round(33 - (124 - liquidTop) * 0.42)));
      const bottomHalfWidth = Math.min(36, topHalfWidth + 6);
      return buildPartSvg(
        label,
        `
  <ellipse class="outline" cx="110" cy="22" rx="18" ry="5"/>
  <path class="outline" d="M100 22v37l-39 61q-5 8 8 13h82q13-5 8-13l-39-61V22"/>
  <path class="detail" d="M100 59q10 7 20 0"/>
  <path class="detail" d="M77 103q33 10 66 0"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildContainedLiquidPath(110, liquidTop, 124, topHalfWidth, bottomHalfWidth, 3, 5)}"/>` : ''}
  ${state.showStopper ? '<path class="dark" d="M91 12h38l-4 12H95z"/><ellipse cx="110" cy="20" rx="5.4" ry="2.6" fill="#ffffff" fill-opacity=".9"/>' : ''}
  `,
      );
    }
    case 'gasJar': {
      const liquidTop = 129 - state.liquidLevel * 0.76;
      return buildPartSvg(
        label,
        `
  <ellipse class="outline" cx="110" cy="27" rx="31" ry="8"/>
  <path class="outline" d="M79 27v89q0 15 15 20h32q15-5 15-20V27"/>
  <path class="detail" d="M84 42q26 7 52 0"/>
  <path class="detail" d="M88 124q22 6 44 0"/>
  ${state.showScaleMarks ? '<path class="detail" d="M95 62h30M95 82h21M95 102h30"/>' : ''}
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(84, 136, liquidTop, 128, 4)}"/>` : ''}
  ${state.showStopper ? '<path class="dark" d="M77 14h66l-5 11H82z"/>' : ''}
  `,
      );
    }
    case 'roundBottomFlask': {
      const liquidTop = 122 - state.liquidLevel * 0.5;
      const topHalfWidth = Math.max(16, Math.min(31, Math.round(31 - Math.abs(liquidTop - 106) * 0.28)));
      const bottomHalfWidth = Math.max(22, topHalfWidth - 4);
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M95 18h30"/>
  <path class="outline" d="M101 18v50q-26 8-34 30q-7 21 8 36q13 13 35 13q22 0 35-13q15-15 8-36q-8-22-34-30V18"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildContainedLiquidPath(110, liquidTop, 130, topHalfWidth, bottomHalfWidth, 3, 8)}"/>` : ''}
  <path class="detail" d="M95 75Q110 84 125 75"/>
  ${state.showStopper ? '<rect class="dark" x="95" y="12" width="30" height="9" rx="2"/>' : ''}
  `,
      );
    }
    case 'flatBottomFlask': {
      const liquidTop = 124 - state.liquidLevel * 0.52;
      const topHalfWidth = Math.max(18, Math.min(30, Math.round(30 - Math.abs(liquidTop - 108) * 0.22)));
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M94 18h32"/>
  <path class="outline" d="M100 18v47q-27 10-36 42q-4 15 8 27h76q12-12 8-27q-9-32-36-42V18"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildContainedLiquidPath(110, liquidTop, 126, topHalfWidth, 24, 3, 2)}"/>` : ''}
  <path class="detail" d="M82 100Q110 108 138 100"/>
  ${state.showStopper ? '<rect class="dark" x="94" y="12" width="32" height="9" rx="2"/>' : ''}
  `,
      );
    }
    case 'wideMouthBottle': {
      const liquidTop = 124 - state.liquidLevel * 0.62;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M77 35h66"/>
  <path class="outline" d="M83 35v84q0 13 13 13h28q13 0 13-13V35"/>
  <ellipse class="outline" cx="110" cy="35" rx="33" ry="9"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(86, 134, liquidTop, 128, 4)}"/>` : ''}
  <path class="detail" d="M92 55h36M92 71h36"/>
  ${state.showStopper ? '<rect class="dark" x="79" y="22" width="62" height="10" rx="3"/>' : ''}
  `,
      );
    }
    case 'reagentBottle': {
      const liquidTop = 128 - state.liquidLevel * 0.68;
      return buildPartSvg(
        label,
        `
  ${state.showStopper ? '<path class="dark" d="M96 20h28l5 14H91z"/>' : '<path class="outline" d="M92 20h36l3 14H89z"/>'}
  <path class="outline" d="M91 36h38"/>
  <path class="outline" d="M83 36v89q0 11 11 11h32q11 0 11-11V36"/>
  <rect x="91" y="72" width="38" height="34" rx="3" fill="#ffffff" fill-opacity=".82" stroke="#0f172a" stroke-width="0.95"/>
  <path class="detail" d="M98 86h24M100 96h20"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(86, 134, liquidTop, 132, 4)}"/>` : ''}
  `,
      );
    }
    case 'graduatedCylinder': {
      const liquidTop = 132 - state.liquidLevel * 0.88;
      return buildPartSvg(
        label,
        `
  <ellipse class="outline" cx="110" cy="27" rx="25" ry="7"/>
  <path class="outline" d="M85 27v96q0 9 9 12h32q9-3 9-12V27"/>
  <path class="detail" d="M90 42q20 5 40 0"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(88, 132, liquidTop, 130, 3)}"/>` : ''}
  ${state.showScaleMarks ? buildScaleMarks(98, 45, 113, 18, 10, 8) : ''}
  <path class="outline" d="M72 143h76"/>
  <path class="detail" d="M94 135h32l14 8H80Z"/>
  `,
      );
    }
    case 'separatoryFunnel': {
      // 分液漏斗的液面只画在球胆区域里，避免覆盖上方细颈和下端活塞。
      const liquidTop = 112 - state.liquidLevel * 0.42;
      return buildPartSvg(
        label,
        `
  ${state.showStopper ? '<path class="dark" d="M93 14h34l-4 10H97z"/>' : '<ellipse class="outline" cx="110" cy="20" rx="16" ry="5"/>'}
  <path class="outline" d="M101 24v23"/>
  <path class="outline" d="M119 24v23"/>
  <path class="outline" d="M101 47q-24 15-27 41q-3 28 28 41h16q31-13 28-41q-3-26-27-41"/>
  <path class="detail" d="M83 87q27 10 54 0"/>
  <path class="detail" d="M110 129v14"/>
  <path class="outline" d="M96 134h28"/>
  <circle cx="110" cy="134" r="4.5" fill="#ffffff" fill-opacity=".92" stroke="#0f172a" stroke-width="0.95"/>
  <path class="detail" d="M124 134h19"/>
  <path class="outline" d="M106 143h8l-3 18h-2Z"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(86, 134, liquidTop, 123, 6)}"/>` : ''}
  ${state.valveOpen ? '<path class="detail" d="M143 134h16M111 139v10"/>' : '<path class="detail" d="M143 134h16M103 127l14 14"/>'}
  `,
      );
    }
    case 'burette': {
      // 滴定管液面和刻度都只落在主量管段，底部阀门单独保留可见状态。
      const liquidTop = 118 - state.liquidLevel * 0.82;
      return buildPartSvg(
        label,
        `
  <ellipse class="outline" cx="110" cy="20" rx="12" ry="4"/>
  <path class="outline" d="M102 20v99l8 25l8-25V20"/>
  <path class="detail" d="M106 24v91M114 24v91"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(106, 114, liquidTop, 118, 3)}"/>` : ''}
  ${state.showScaleMarks ? buildScaleMarks(122, 35, 109, -12, -7, 8) : ''}
  <path class="outline" d="M92 116h36"/>
  <circle cx="110" cy="116" r="4" fill="#ffffff" fill-opacity=".92" stroke="#0f172a" stroke-width="0.95"/>
  <path class="detail" d="M128 116h20"/>
  <path class="detail" d="M110 121v16"/>
  ${state.valveOpen ? '<path class="detail" d="M137 116h15M110 121v13"/>' : '<path class="detail" d="M137 116h15M103 109l14 14"/>'}
  `,
      );
    }
    case 'waterTrough': {
      const liquidTop = 126 - state.liquidLevel * 0.54;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M42 56h136"/>
  <path class="outline" d="M52 56v59q0 12 12 12h92q12 0 12-12V56"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(54, 166, liquidTop, 127, 6)}"/>` : ''}
  <path class="detail" d="M58 66h104"/>
  `,
      );
    }
  }
}

export function resolveChemistryContainerPresetRotation(
  preset: Exclude<ChemistryContainerOrientationPreset, 'custom'>,
): number {
  if (preset === 'tilted') {
    return -22;
  }
  if (preset === 'inverted') {
    return 180;
  }
  return 0;
}

export function createChemistryEditableContainerState(
  definition: ChemistryEditableContainerDefinition,
): ChemistryEditableContainerState {
  return {
    ...definition.defaultState,
  };
}

export function buildChemistryEditableContainerSrc(
  label: string,
  definition: ChemistryEditableContainerDefinition,
  state: ChemistryEditableContainerState,
): string {
  return svgDataUri(buildEditableContainerBody(label, definition.kind, state));
}

const co2LimewaterSvg = buildTemplateSvg(
  '二氧化碳通入澄清石灰水',
  `
  <path class="outline" d="M30 204h324"/>
  <ellipse class="outline" cx="86" cy="62" rx="21" ry="6"/>
  <path class="outline" d="M74 62v39l-34 72q-5 10 8 17h76q13-7 8-17l-34-72V62"/>
  <path class="liquid" d="M55 158Q86 169 117 158v24q-8 8-31 8q-23 0-31-8Z"/>
  <path class="solid" d="M61 169Q86 177 111 169v11q-6 6-25 6q-19 0-25-6Z"/>
  <path class="stopper" d="M69 52h34l-4 12H73z"/>
  <ellipse cx="88" cy="58" rx="4.6" ry="2.3" fill="#ffffff" fill-opacity=".92"/>
  <path class="outline" d="M88 54v-20h84q18 0 24 15q4 10 4 25v70"/>
  <path class="detail" d="M107 34h52" marker-end="url(#arrow)"/>
  <ellipse class="outline" cx="228" cy="72" rx="25" ry="7"/>
  <path class="outline" d="M203 72v94q0 12 8 18q7 5 17 5q10 0 17-5q8-6 8-18V72"/>
  <path class="liquid" d="M205 142Q228 136 251 142v22q0 10-7 15q-6 4-16 4q-10 0-16-4q-7-5-7-15Z"/>
  <path class="detail" d="M200 144h27"/>
  <path class="detail" d="M227 144v22"/>
  <circle cx="226" cy="153" r="3" fill="none" stroke="#0f172a" stroke-width="0.9"/>
  <circle cx="219" cy="163" r="2.3" fill="none" stroke="#0f172a" stroke-width="0.8"/>
  <circle cx="235" cy="166" r="2.4" fill="none" stroke="#0f172a" stroke-width="0.8"/>
  <text class="label" x="47" y="226">大理石 + 稀盐酸</text>
  <text class="label" x="261" y="145">澄清石灰水</text>
  <text class="note" x="262" y="164">导管伸入液面下</text>
  <text class="gas" x="142" y="29">CO<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  `,
);

const co2CollectionSvg = buildTemplateSvg(
  '二氧化碳收集装置',
  `
  <path class="outline" d="M30 204h324"/>
  <ellipse class="outline" cx="84" cy="64" rx="20" ry="6"/>
  <path class="outline" d="M72 64v38l-33 71q-5 10 8 17h74q13-7 8-17l-33-71V64"/>
  <path class="solid" d="M56 170Q84 180 112 170v13q-7 7-28 7q-21 0-28-7Z"/>
  <path class="stopper" d="M67 54h34l-4 12H71z"/>
  <ellipse cx="86" cy="60" rx="4.5" ry="2.3" fill="#ffffff" fill-opacity=".92"/>
  <path class="outline" d="M86 56V35h150q20 0 27 17q3 8 3 21v91"/>
  <path class="detail" d="M112 35h76" marker-end="url(#arrow)"/>
  <path class="outline" d="M266 59q0-10 9-10h40q9 0 9 10v115q0 17-16 19h-26q-16-2-16-19Z"/>
  <ellipse class="outline" cx="295" cy="59" rx="29" ry="8"/>
  <path class="detail" d="M270 76q25 7 50 0"/>
  <path class="detail" d="M266 164h30"/>
  <path class="guide" d="M275 105h38M275 132h38"/>
  <path class="outline" d="M252 48h88"/>
  <path class="detail" d="M335 44h18"/>
  <text class="label" x="45" y="226">反应瓶</text>
  <text class="label" x="229" y="226">向上排空气收集 CO₂</text>
  <text class="note" x="282" y="160">导管接近瓶底</text>
  <text class="gas" x="156" y="31">CO<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  <text class="note" x="315" y="39">玻璃片</text>
  `,
);

const oxygenWaterCollectionSvg = buildTemplateSvg(
  '氧气排水法收集装置',
  `
  <path class="outline" d="M30 204h324"/>
  <ellipse class="outline" cx="82" cy="65" rx="20" ry="6"/>
  <path class="outline" d="M70 65v37l-32 71q-5 10 8 17h72q13-7 8-17l-32-71V65"/>
  <path class="solid" d="M55 170Q82 179 109 170v13q-7 7-27 7q-20 0-27-7Z"/>
  <path class="stopper" d="M65 55h34l-4 12H69z"/>
  <ellipse cx="84" cy="61" rx="4.5" ry="2.3" fill="#ffffff" fill-opacity=".92"/>
  <path class="outline" d="M84 57V36h76q18 0 25 16q4 8 4 20v89h32"/>
  <path class="detail" d="M112 36h51" marker-end="url(#arrow)"/>
  <path class="outline" d="M180 123h158v60q0 11-9 17q-8 5-20 5H209q-12 0-20-5q-9-6-9-17Z"/>
  <path class="liquid" d="M183 141Q259 132 335 141v42q0 8-7 12q-7 4-18 4H208q-11 0-18-4q-7-4-7-12Z"/>
  <path class="outline" d="M226 49q0-9 8-9h36q8 0 8 9v80h-52Z"/>
  <ellipse class="outline" cx="252" cy="49" rx="26" ry="7"/>
  <path class="detail" d="M227 64q25 6 50 0"/>
  <path class="outline" d="M185 130h48"/>
  <circle cx="230" cy="161" r="3" fill="none" stroke="#0f172a" stroke-width="0.85"/>
  <circle cx="241" cy="153" r="2.5" fill="none" stroke="#0f172a" stroke-width="0.8"/>
  <circle cx="251" cy="162" r="2.3" fill="none" stroke="#0f172a" stroke-width="0.8"/>
  <text class="gas" x="122" y="31">O<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  <text class="label" x="224" y="35">倒置集气瓶</text>
  <text class="label" x="247" y="226">水槽</text>
  <text class="note" x="252" y="160">导管伸入瓶口</text>
  `,
);

const oxygenAirCollectionSvg = buildTemplateSvg(
  '氧气向上排空气法收集装置',
  `
  <path class="outline" d="M30 204h324"/>
  <ellipse class="outline" cx="84" cy="64" rx="20" ry="6"/>
  <path class="outline" d="M72 64v38l-33 71q-5 10 8 17h74q13-7 8-17l-33-71V64"/>
  <path class="solid" d="M56 170Q84 180 112 170v13q-7 7-28 7q-21 0-28-7Z"/>
  <path class="stopper" d="M67 54h34l-4 12H71z"/>
  <ellipse cx="86" cy="60" rx="4.5" ry="2.3" fill="#ffffff" fill-opacity=".92"/>
  <path class="outline" d="M86 56V35h165q19 0 26 17q4 9 4 22v76"/>
  <path class="detail" d="M116 35h78" marker-end="url(#arrow)"/>
  <path class="outline" d="M278 58q0-10 9-10h36q9 0 9 10v116q0 17-16 19h-22q-16-2-16-19Z"/>
  <ellipse class="outline" cx="305" cy="58" rx="27" ry="8"/>
  <path class="detail" d="M282 76q23 6 46 0"/>
  <path class="outline" d="M281 150h31"/>
  <path class="guide" d="M287 95h35M287 124h35"/>
  <path class="detail" d="M294 144Q313 122 309 90" marker-end="url(#arrow)"/>
  <text class="gas" x="146" y="30">O<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  <text class="label" x="237" y="226">向上排空气法</text>
  <text class="note" x="320" y="87">空气逸出</text>
  `,
);

const heatedTestTubeGasSvg = buildTemplateSvg(
  '加热试管制气体',
  `
  <path class="outline" d="M28 204h328"/>
  <path class="outline" d="M63 180h96"/>
  <path class="outline" d="M110 180V83"/>
  <circle cx="110" cy="101" r="4" fill="#ffffff" fill-opacity=".92" stroke="#0f172a" stroke-width="1"/>
  <path class="outline" d="M110 101h115"/>
  <path class="outline" d="M80 103l143-31"/>
  <path class="outline" d="M88 118l143-31"/>
  <path class="outline" d="M88 118q-18 4-22-10q-3-12 11-17"/>
  <path class="solid" d="M109 107l48-10 3 13-48 11Z"/>
  <path class="stopper" d="M214 71l31-7l2 13l-31 7z"/>
  <ellipse cx="232" cy="74" rx="4.2" ry="2.2" fill="#ffffff" fill-opacity=".92" transform="rotate(-12 232 74)"/>
  <path class="outline" d="M233 77l52-11q18-4 25 8q5 8 5 18v47"/>
  <ellipse class="outline" cx="315" cy="139" rx="27" ry="7"/>
  <path class="outline" d="M288 139v35q0 14 17 17h20q17-3 17-17v-35"/>
  <path class="detail" d="M255 75h38" marker-end="url(#arrow)"/>
  <path class="outline" d="M146 159q-14-19 0-39q11-17 13-17q2 0 13 17q14 20 0 39"/>
  <path class="detail" d="M159 123q-5 10 0 22q6-12 0-22"/>
  <path class="outline" d="M141 167h36"/>
  <path class="outline" d="M130 204l20-29h20l20 29"/>
  <text class="label" x="82" y="226">酒精灯加热</text>
  <text class="note" x="61" y="83">试管口略向下</text>
  <text class="label" x="275" y="226">收集气体</text>
  `,
);

const conicalFlaskGasSvg = buildTemplateSvg(
  '锥形瓶反应制气体',
  `
  <path class="outline" d="M30 204h324"/>
  <ellipse class="outline" cx="96" cy="75" rx="26" ry="7"/>
  <path class="outline" d="M84 75v40l-38 59q-6 9 8 17h84q14-8 8-17l-38-59V75"/>
  <path class="liquid" d="M59 162Q96 174 133 162v21q-8 8-37 8q-29 0-37-8Z"/>
  <path class="solid" d="M66 169Q96 179 126 169v12q-7 5-30 5q-23 0-30-5Z"/>
  <ellipse class="outline" cx="66" cy="33" rx="16" ry="7"/>
  <path class="outline" d="M57 33h18l-5 93h-8Z"/>
  <path class="stopper" d="M74 66h44l-5 12H79z"/>
  <ellipse cx="89" cy="72" rx="4.5" ry="2.3" fill="#ffffff" fill-opacity=".92"/>
  <ellipse cx="105" cy="72" rx="4.5" ry="2.3" fill="#ffffff" fill-opacity=".92"/>
  <path class="outline" d="M105 67V40h121q18 0 25 16q4 9 4 22v48"/>
  <path class="detail" d="M147 41h69" marker-end="url(#arrow)"/>
  <ellipse class="outline" cx="282" cy="127" rx="28" ry="7"/>
  <path class="outline" d="M254 127v47q0 9 7 14q6 4 21 4q15 0 21-4q7-5 7-14v-47"/>
  <path class="detail" d="M259 139q23 6 46 0"/>
  <text class="label" x="36" y="226">长颈漏斗 + 锥形瓶</text>
  <text class="note" x="42" y="151">漏斗下端液封</text>
  <text class="note" x="290" y="119">导出气体</text>
  <text class="gas" x="176" y="35">气体</text>
  `,
);

const co2FullTestSvg = buildTemplateSvg(
  '检验二氧化碳是否集满',
  `
  <path class="outline" d="M34 204h312"/>
  <ellipse class="outline" cx="210" cy="56" rx="29" ry="8"/>
  <path class="outline" d="M181 56v116q0 17 17 20h24q17-3 17-20V56"/>
  <path class="detail" d="M185 73q25 7 50 0"/>
  <path class="guide" d="M190 107h40M190 135h40"/>
  <path class="outline" d="M168 48h86"/>
  <path class="detail" d="M103 87l79 20"/>
  <path class="detail" d="M96 85l-34-9"/>
  <path class="outline" d="M55 66q12-22 26-10q4 3 5 10q15-9 25 6q6 11-2 21"/>
  <path class="detail" d="M56 102l40-32"/>
  <path class="detail" d="M83 109l18-31"/>
  <path class="detail" d="M64 62l25 40"/>
  <text class="gas" x="199" y="122">CO<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  <text class="label" x="40" y="226">燃着木条靠近瓶口</text>
  <text class="note" x="258" y="76">火焰熄灭</text>
  <text class="note" x="247" y="94">说明已集满</text>
  `,
);

const airtightnessTestSvg = buildTemplateSvg(
  '检查装置气密性',
  `
  <path class="outline" d="M30 204h324"/>
  <ellipse class="outline" cx="84" cy="65" rx="21" ry="6"/>
  <path class="outline" d="M72 65v37l-33 72q-5 10 8 17h74q13-7 8-17l-33-72V65"/>
  <path class="stopper" d="M67 55h34l-4 12H71z"/>
  <ellipse cx="86" cy="61" rx="4.5" ry="2.3" fill="#ffffff" fill-opacity=".92"/>
  <path class="outline" d="M86 57V36h119q18 0 25 16q4 9 4 22v86h25"/>
  <path class="detail" d="M114 36h63" marker-end="url(#arrow)"/>
  <ellipse class="outline" cx="292" cy="129" rx="38" ry="7"/>
  <path class="outline" d="M254 129v44q0 16 17 19h42q17-3 17-19v-44"/>
  <path class="liquid" d="M257 160Q292 154 327 160v14q0 9-8 13q-7 4-27 4q-20 0-27-4q-8-4-8-13Z"/>
  <path class="detail" d="M234 160h34"/>
  <circle cx="287" cy="171" r="3" fill="none" stroke="#0f172a" stroke-width="0.85"/>
  <circle cx="298" cy="162" r="2.7" fill="none" stroke="#0f172a" stroke-width="0.85"/>
  <circle cx="310" cy="171" r="2.3" fill="none" stroke="#0f172a" stroke-width="0.85"/>
  <path class="detail" d="M41 116q15-12 34 0"/>
  <path class="detail" d="M42 132q15-12 34 0"/>
  <path class="detail" d="M43 148q15-12 34 0"/>
  <text class="label" x="44" y="226">手握容器</text>
  <text class="label" x="228" y="226">导管口有气泡</text>
  <text class="note" x="131" y="31">空气受热膨胀</text>
  `,
);

const filtrationSvg = buildTemplateSvg(
  '过滤装置',
  `
  <path class="outline" d="M28 204h328"/>
  <path class="outline" d="M83 48v156"/>
  <path class="outline" d="M58 204h58"/>
  <circle cx="83" cy="94" r="4.5" fill="#ffffff" fill-opacity=".92" stroke="#0f172a" stroke-width="1"/>
  <path class="outline" d="M83 94h132"/>
  <ellipse class="outline" cx="188" cy="75" rx="43" ry="9"/>
  <path class="outline" d="M148 78l40 70l40-70"/>
  <path class="detail" d="M160 88l28 48l28-48"/>
  <path class="outline" d="M188 148v22"/>
  <ellipse class="outline" cx="226" cy="129" rx="38" ry="8"/>
  <path class="outline" d="M188 129v48q0 10 9 15h58q9-5 9-15v-48"/>
  <path class="liquid" d="M193 163Q226 156 259 163v13q0 7-7 11q-6 3-26 3q-20 0-26-3q-7-4-7-11Z"/>
  <path class="detail" d="M188 170q14-8 29-5"/>
  <path class="detail" d="M126 53l82 44"/>
  <path class="detail" d="M120 61l82 44"/>
  <text class="label" x="68" y="226">铁架台</text>
  <text class="label" x="138" y="64">玻璃棒引流</text>
  <text class="note" x="229" y="98">滤纸</text>
  <text class="note" x="271" y="162">三靠过滤</text>
  `,
);

const evaporationDishSvg = buildTemplateSvg(
  '蒸发皿加热',
  `
  <path class="outline" d="M30 204h324"/>
  <ellipse class="outline" cx="200" cy="111" rx="47" ry="10"/>
  <path class="outline" d="M156 112q9 26 44 26q35 0 44-26"/>
  <path class="liquid" d="M168 116Q200 124 232 116q-6 12-32 12q-26 0-32-12Z"/>
  <path class="detail" d="M145 91l98 23"/>
  <path class="detail" d="M143 99l98 23"/>
  <rect x="133" y="143" width="134" height="12" fill="none" stroke="#0f172a" stroke-width="1.05"/>
  <path class="detail" d="M149 143v12M165 143v12M181 143v12M197 143v12M213 143v12M229 143v12M245 143v12"/>
  <path class="detail" d="M144 155l20 49"/>
  <path class="detail" d="M256 155l-20 49"/>
  <path class="detail" d="M200 155v49"/>
  <path class="outline" d="M185 174q-14-18 0-38q12-16 15-16q3 0 15 16q14 20 0 38"/>
  <path class="detail" d="M200 139q-5 9 0 22q6-13 0-22"/>
  <path class="outline" d="M180 181h40"/>
  <path class="outline" d="M169 204l20-28h22l20 28"/>
  <path class="guide" d="M171 80q29-18 58 0"/>
  <path class="guide" d="M181 65q19-10 38 0"/>
  <text class="label" x="159" y="226">酒精灯加热</text>
  <text class="label" x="255" y="103">蒸发皿</text>
  <text class="note" x="256" y="151">石棉网承托</text>
  <text class="note" x="78" y="93">玻璃棒搅拌</text>
  `,
);

const partTestTubeSvg = buildPartSvg(
  '试管部件',
  `
  <ellipse class="outline" cx="110" cy="22" rx="18" ry="5"/>
  <path class="outline" d="M92 22v80q0 24 18 30q18-6 18-30V22"/>
  <path class="detail" d="M98 27v72q0 18 12 24"/>
  <path class="detail" d="M122 27v72q0 18-12 24"/>
  <path class="liquid" d="M97 88Q110 84 123 88v25q0 14-13 19q-13-5-13-19Z"/>
  `,
);

const partBeakerSvg = buildPartSvg(
  '烧杯部件',
  `
  <path class="outline" d="M57 30h81q12 0 17 7q3 5-3 11"/>
  <path class="outline" d="M66 31v90q0 10 10 13h49q10-3 10-13V48"/>
  <path class="detail" d="M66 31q35 9 70 0"/>
  <path class="liquid" d="M68 88Q101 81 133 88v39q0 7-8 9H76q-8-2-8-9Z"/>
  <path class="detail" d="M82 53h18M82 63h10M82 73h18M82 83h10M82 93h18M82 103h10M82 113h18"/>
  <path class="detail" d="M140 36q5 2 8 6"/>
  `,
);

const partConicalFlaskSvg = buildPartSvg(
  '锥形瓶部件',
  `
  <ellipse class="outline" cx="110" cy="22" rx="18" ry="5"/>
  <path class="outline" d="M100 22v37l-39 61q-5 8 8 13h82q13-5 8-13l-39-61V22"/>
  <path class="detail" d="M100 59q10 7 20 0"/>
  <path class="detail" d="M77 103q33 10 66 0"/>
  <path class="liquid" d="${buildContainedLiquidPath(110, 109, 124, 27, 33, 3, 5)}"/>
  `,
);

const partGasJarSvg = buildPartSvg(
  '集气瓶部件',
  `
  <ellipse class="outline" cx="110" cy="27" rx="31" ry="8"/>
  <path class="outline" d="M79 27v89q0 15 15 20h32q15-5 15-20V27"/>
  <path class="detail" d="M84 42q26 7 52 0"/>
  <path class="detail" d="M88 124q22 6 44 0"/>
  <path class="detail" d="M95 62h30M95 82h21M95 102h30"/>
  `,
);

const partFunnelSvg = buildPartSvg(
  '漏斗部件',
  `
  <ellipse class="outline" cx="110" cy="31" rx="55" ry="11"/>
  <path class="outline" d="M57 31l46 58v43h14V89l46-58"/>
  <path class="detail" d="M73 43q37 10 74 0"/>
  <path class="detail" d="M103 89h14"/>
  <path class="detail" d="M110 132v16"/>
  `,
);

const partLongNeckFunnelSvg = buildPartSvg(
  '长颈漏斗部件',
  `
  <ellipse class="outline" cx="110" cy="25" rx="37" ry="8"/>
  <path class="outline" d="M74 25l30 36v73h12V61l30-36"/>
  <path class="detail" d="M88 37q22 7 44 0"/>
  <path class="detail" d="M104 61h12"/>
  <path class="detail" d="M110 134v17"/>
  `,
);

const partSeparatoryFunnelSvg = buildPartSvg(
  '分液漏斗部件',
  `
  <ellipse class="outline" cx="110" cy="20" rx="18" ry="5"/>
  <path class="outline" d="M101 24v22M119 24v22"/>
  <path class="outline" d="M101 46q-24 15-27 41q-3 28 28 42h16q31-14 28-42q-3-26-27-41"/>
  <path class="liquid" d="M83 88q27 10 54 0v24q-6 9-27 12q-21-3-27-12Z"/>
  <path class="detail" d="M110 129v13"/>
  <path class="outline" d="M96 134h28"/>
  <circle cx="110" cy="134" r="4.5" fill="#ffffff" fill-opacity=".92" stroke="#0f172a" stroke-width="0.95"/>
  <path class="detail" d="M124 134h18"/>
  <path class="outline" d="M106 143h8l-3 18h-2Z"/>
  `,
);

const partStraightTubeSvg = buildPartSvg(
  '直导管部件',
  `
  <path class="outline" d="M42 76h136"/>
  <path class="outline" d="M42 90h136"/>
  <path class="detail" d="M52 83h116"/>
  <path class="detail" d="M42 76q-8 7 0 14M178 76q8 7 0 14"/>
  `,
);

const partBentTubeSvg = buildPartSvg(
  '弯导管部件',
  `
  <path class="outline" d="M55 123V74q0-21 21-21h87"/>
  <path class="outline" d="M69 123V84q0-17 17-17h77"/>
  <path class="detail" d="M62 116q7-6 7-16V79q0-12 12-12h72"/>
  <path class="detail" d="M55 123q7 7 14 0M163 53q7 7 0 14"/>
  `,
);

const partRubberStopperSvg = buildPartSvg(
  '橡胶塞部件',
  `
  <path class="dark" d="M67 55h86l13 40H54z"/>
  <ellipse cx="110" cy="68" rx="8" ry="4.5" fill="#ffffff" fill-opacity=".94"/>
  <path class="detail" d="M80 75h60"/>
  <path class="detail" d="M74 86h72"/>
  <path class="detail" d="M62 95h96"/>
  `,
);

const partWaterTroughSvg = buildPartSvg(
  '水槽部件',
  `
  <path class="outline" d="M42 56h136"/>
  <path class="outline" d="M52 56v59q0 12 12 12h92q12 0 12-12V56"/>
  <path class="liquid" d="M54 79Q110 71 166 79v36q0 12-12 12H66q-12 0-12-12Z"/>
  <path class="detail" d="M58 66h104"/>
  `,
);

const partIronStandSvg = buildPartSvg(
  '铁架台部件',
  `
  <path class="outline" d="M55 137h110"/>
  <path class="detail" d="M64 129h92"/>
  <path class="outline" d="M88 28v101"/>
  <circle cx="88" cy="56" r="5" fill="#ffffff" fill-opacity=".92" stroke="#0f172a" stroke-width="1"/>
  <path class="outline" d="M88 56h72"/>
  <path class="outline" d="M151 47q22 9 22 19q0 10-22 19"/>
  <path class="detail" d="M151 58h20M151 74h20"/>
  <path class="detail" d="M88 31h11M88 126h11"/>
  `,
);

const partAlcoholLampSvg = buildPartSvg(
  '酒精灯部件',
  `
  <path class="outline" d="M104 28q-15 20 0 39q15-19 0-39"/>
  <path class="detail" d="M104 42q-6 9 0 18q6-9 0-18"/>
  <path class="outline" d="M92 71h24"/>
  <path class="detail" d="M99 67h10"/>
  <path class="outline" d="M89 71v17l-28 40h86l-28-40V71"/>
  <path class="detail" d="M75 108Q104 118 133 108"/>
  <path class="detail" d="M83 94h42"/>
  <path class="detail" d="M72 128h64"/>
  `,
);

const partGlassRodSvg = buildPartSvg(
  '玻璃棒部件',
  `
  <path class="outline" d="M54 122L165 44"/>
  <path class="detail" d="M59 128L170 50"/>
  `,
);

const partGraduatedCylinderSvg = buildPartSvg(
  '量筒部件',
  `
  <ellipse class="outline" cx="110" cy="27" rx="25" ry="7"/>
  <path class="outline" d="M85 27v96q0 9 9 12h32q9-3 9-12V27"/>
  <path class="detail" d="M90 42q20 5 40 0"/>
  <path class="liquid" d="M88 84Q110 79 132 84v46q0 5-6 7H94q-6-2-6-7Z"/>
  <path class="detail" d="M98 45h18M98 53h10M98 61h14M98 69h10M98 77h18M98 85h10M98 93h14M98 101h10M98 109h18M98 117h10"/>
  <path class="outline" d="M72 143h76"/>
  <path class="detail" d="M94 135h32l14 8H80Z"/>
  `,
);

const partRoundBottomFlaskSvg = buildPartSvg(
  '圆底烧瓶部件',
  `
  <path class="outline" d="M95 18h30"/>
  <path class="outline" d="M101 18v50q-26 8-34 30q-7 21 8 36q13 13 35 13q22 0 35-13q15-15 8-36q-8-22-34-30V18"/>
  <path class="liquid" d="${buildContainedLiquidPath(110, 106, 130, 29, 25, 3, 8)}"/>
  <path class="detail" d="M95 75Q110 84 125 75"/>
  `,
);

const partFlatBottomFlaskSvg = buildPartSvg(
  '平底烧瓶部件',
  `
  <path class="outline" d="M94 18h32"/>
  <path class="outline" d="M100 18v47q-27 10-36 42q-4 15 8 27h76q12-12 8-27q-9-32-36-42V18"/>
  <path class="liquid" d="${buildContainedLiquidPath(110, 108, 126, 28, 24, 3, 2)}"/>
  <path class="detail" d="M82 100Q110 108 138 100"/>
  `,
);

const partWideMouthBottleSvg = buildPartSvg(
  '广口瓶部件',
  `
  <path class="outline" d="M77 35h66"/>
  <path class="outline" d="M83 35v84q0 13 13 13h28q13 0 13-13V35"/>
  <ellipse class="outline" cx="110" cy="35" rx="33" ry="9"/>
  <path class="liquid" d="M86 91Q110 85 134 91v27q0 10-10 10H96q-10 0-10-10Z"/>
  <path class="detail" d="M92 55h36M92 71h36"/>
  `,
);

const partReagentBottleSvg = buildPartSvg(
  '试剂瓶部件',
  `
  <path class="dark" d="M96 20h28l5 14H91z"/>
  <path class="outline" d="M91 36h38"/>
  <path class="outline" d="M83 36v89q0 11 11 11h32q11 0 11-11V36"/>
  <rect x="91" y="72" width="38" height="34" rx="3" fill="#ffffff" fill-opacity=".82" stroke="#0f172a" stroke-width="0.95"/>
  <path class="detail" d="M98 86h24M100 96h20"/>
  <path class="liquid" d="M86 113Q110 108 134 113v11q0 8-8 8H94q-8 0-8-8Z"/>
  `,
);

const partEvaporationDishSvg = buildPartSvg(
  '蒸发皿部件',
  `
  <path class="outline" d="M61 73h98"/>
  <path class="outline" d="M70 73q7 34 40 34q33 0 40-34"/>
  <path class="liquid" d="M77 78Q110 87 143 78q-6 15-33 15q-27 0-33-15Z"/>
  <path class="detail" d="M78 107h64"/>
  <path class="detail" d="M88 117h44"/>
  `,
);

const partCrucibleSvg = buildPartSvg(
  '坩埚部件',
  `
  <path class="outline" d="M73 58h74"/>
  <path class="outline" d="M82 58v47q0 17 28 17q28 0 28-17V58"/>
  <path class="detail" d="M87 73h46"/>
  <path class="detail" d="M92 122h36"/>
  <path class="outline" d="M68 48h84"/>
  <path class="detail" d="M88 42h44"/>
  `,
);

const partTTubeSvg = buildPartSvg(
  'T 形管部件',
  `
  <path class="outline" d="M55 69h110"/>
  <path class="outline" d="M55 83h48v50h14V83h48"/>
  <path class="detail" d="M63 76h94M110 83v42"/>
  `,
);

const partUTubeSvg = buildPartSvg(
  'U 形管部件',
  `
  <path class="outline" d="M76 31v73q0 30 34 30q34 0 34-30V31"/>
  <path class="outline" d="M90 31v73q0 16 20 16q20 0 20-16V31"/>
  <path class="liquid" d="M91 96q0 24 19 24q19 0 19-24v10q0 20-19 20q-19 0-19-20Z"/>
  <path class="detail" d="M68 31h30M122 31h30"/>
  `,
);

const partRubberHoseSvg = buildPartSvg(
  '乳胶管部件',
  `
  <path class="outline" d="M43 99q28-47 70-25q34 18 64-20"/>
  <path class="outline" d="M49 111q28-39 62-20q38 21 72-24"/>
  <path class="detail" d="M53 105q27-41 59-23q35 20 66-21"/>
  `,
);

const partGlassPlateSvg = buildPartSvg(
  '玻璃片部件',
  `
  <rect x="58" y="56" width="104" height="58" rx="4" fill="none" stroke="#0f172a" stroke-width="1.75"/>
  <path class="detail" d="M70 102L148 66"/>
  <path class="detail" d="M84 108L160 73"/>
  <path class="detail" d="M58 56l104 58"/>
  `,
);

const partSingleHoleStopperSvg = buildPartSvg(
  '单孔塞部件',
  `
  <path class="dark" d="M63 55h94l14 42H49z"/>
  <ellipse cx="110" cy="73" rx="9" ry="5" fill="#ffffff" fill-opacity=".94"/>
  <path class="detail" d="M76 82h68"/>
  <path class="detail" d="M69 93h82"/>
  <path class="detail" d="M58 97h104"/>
  `,
);

const partDoubleHoleStopperSvg = buildPartSvg(
  '双孔塞部件',
  `
  <path class="dark" d="M63 55h94l14 42H49z"/>
  <ellipse cx="95" cy="73" rx="8" ry="4.5" fill="#ffffff" fill-opacity=".94"/>
  <ellipse cx="125" cy="73" rx="8" ry="4.5" fill="#ffffff" fill-opacity=".94"/>
  <path class="detail" d="M76 82h68"/>
  <path class="detail" d="M69 93h82"/>
  <path class="detail" d="M58 97h104"/>
  `,
);

const partTripodSvg = buildPartSvg(
  '三脚架部件',
  `
  <ellipse class="outline" cx="110" cy="54" rx="47" ry="12"/>
  <path class="detail" d="M78 63l-28 78"/>
  <path class="detail" d="M110 66v78"/>
  <path class="detail" d="M142 63l28 78"/>
  <path class="outline" d="M45 142h24M98 144h24M151 142h24"/>
  <path class="detail" d="M78 54h64"/>
  `,
);

const partWireGauzeSvg = buildPartSvg(
  '石棉网部件',
  `
  <rect x="56" y="43" width="108" height="84" fill="none" stroke="#0f172a" stroke-width="1.75"/>
  <path class="detail" d="M74 43v84M92 43v84M110 43v84M128 43v84M146 43v84"/>
  <path class="detail" d="M56 57h108M56 71h108M56 85h108M56 99h108M56 113h108"/>
  <rect x="91" y="66" width="38" height="38" fill="#0f172a" fill-opacity=".1" stroke="#0f172a" stroke-width="0.95"/>
  `,
);

const partIronRingSvg = buildPartSvg(
  '铁圈部件',
  `
  <path class="outline" d="M56 84h55"/>
  <ellipse class="outline" cx="142" cy="84" rx="36" ry="28"/>
  <ellipse class="detail" cx="142" cy="84" rx="25" ry="18"/>
  <path class="detail" d="M56 76v16"/>
  `,
);

const partIronClampSvg = buildPartSvg(
  '铁夹部件',
  `
  <path class="outline" d="M52 84h74"/>
  <path class="outline" d="M124 64q38 8 38 20q0 12-38 20"/>
  <path class="detail" d="M123 75h35M123 93h35"/>
  <circle cx="82" cy="84" r="8" fill="none" stroke="#0f172a" stroke-width="1.05"/>
  `,
);

const partTestTubeClampSvg = buildPartSvg(
  '试管夹部件',
  `
  <path class="outline" d="M50 102l94-54"/>
  <path class="outline" d="M59 116l94-54"/>
  <path class="detail" d="M123 58q20 13 25 33"/>
  <path class="detail" d="M136 50q19 12 25 32"/>
  <path class="detail" d="M67 109l18 20"/>
  `,
);

const partCombustionSpoonSvg = buildPartSvg(
  '燃烧匙部件',
  `
  <path class="outline" d="M63 118L149 43"/>
  <path class="detail" d="M69 124L155 49"/>
  <ellipse class="outline" cx="58" cy="123" rx="17" ry="10" transform="rotate(-36 58 123)"/>
  <path class="solid" d="M49 121q10 10 23 2q-3 9-12 11q-9 2-11-13Z"/>
  `,
);

const partDropperSvg = buildPartSvg(
  '滴管部件',
  `
  <path class="dark" d="M86 35q0-16 24-16q24 0 24 16q0 12-12 17H98q-12-5-12-17Z"/>
  <path class="outline" d="M99 53h22l-8 80q-1 10-3 10q-2 0-3-10Z"/>
  <path class="liquid" d="M103 78h14l-4 40q-1 7-3 7q-2 0-3-7Z"/>
  <circle cx="110" cy="151" r="3" fill="none" stroke="#0f172a" stroke-width="0.85"/>
  `,
);

const partBuretteSvg = buildPartSvg(
  '滴定管部件',
  `
  <ellipse class="outline" cx="110" cy="20" rx="12" ry="4"/>
  <path class="outline" d="M102 20v102l8 22l8-22V20"/>
  <path class="detail" d="M106 25v92M114 25v92"/>
  <path class="detail" d="M122 36h-12M122 44h-7M122 52h-10M122 60h-7M122 68h-12M122 76h-7M122 84h-10M122 92h-7M122 100h-12M122 108h-7"/>
  <path class="outline" d="M92 116h36"/>
  <circle cx="110" cy="116" r="4" fill="#ffffff" fill-opacity=".92" stroke="#0f172a" stroke-width="0.95"/>
  <path class="detail" d="M128 116h20"/>
  <path class="detail" d="M110 121v16"/>
  `,
);

const partCondenserSvg = buildPartSvg(
  '冷凝管部件',
  `
  <path class="outline" d="M42 84h136"/>
  <path class="outline" d="M42 106h136"/>
  <path class="detail" d="M55 95h110"/>
  <path class="detail" d="M55 89h110M55 101h110"/>
  <path class="outline" d="M70 70l22 14"/>
  <path class="outline" d="M128 106l22 14"/>
  <path class="detail" d="M70 70h-27M150 120h27"/>
  <path class="detail" d="M61 78l12-16M142 112l-12 16"/>
  <path class="detail" d="M76 112h70" marker-end="url(#part-arrow)"/>
  `,
);

const partSpoonSvg = buildPartSvg(
  '药匙部件',
  `
  <path class="outline" d="M59 112l101-63"/>
  <path class="detail" d="M66 121l101-63"/>
  <ellipse class="outline" cx="55" cy="116" rx="20" ry="10" transform="rotate(-32 55 116)"/>
  <path class="detail" d="M86 96l34-21"/>
  `,
);

const partTweezersSvg = buildPartSvg(
  '镊子部件',
  `
  <path class="outline" d="M80 34l54 100"/>
  <path class="outline" d="M104 34l36 96"/>
  <path class="detail" d="M82 34q11 9 22 0"/>
  <path class="detail" d="M134 134l19 15M140 130l9 20"/>
  `,
);

const partMortarSvg = buildPartSvg(
  '研钵部件',
  `
  <path class="outline" d="M64 83h92"/>
  <path class="outline" d="M74 83q4 42 36 42q32 0 36-42"/>
  <path class="detail" d="M85 118h50"/>
  <path class="outline" d="M120 76l39-38"/>
  <path class="detail" d="M128 83l39-38"/>
  <path class="solid" d="M79 94q31 15 62 0q-6 22-31 22q-25 0-31-22Z"/>
  `,
);

const partWatchGlassSvg = buildPartSvg(
  '表面皿部件',
  `
  <ellipse class="outline" cx="110" cy="86" rx="58" ry="22"/>
  <path class="detail" d="M62 86q48 19 96 0"/>
  <path class="detail" d="M78 76q32-8 64 0"/>
  <path class="liquid" d="M73 88q37 13 74 0q-8 13-37 13q-29 0-37-13Z"/>
  `,
);

// 当前图库全部保持项目原创 SVG，避免内置授权不明的教材、题库或商业素材图片。
export const chemistryApparatusItems = [
  {
    id: 'co2-limewater-test',
    name: 'CO2 通入澄清石灰水',
    category: '检验装置',
    description: '二氧化碳导入澄清石灰水并观察变浑浊。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(co2LimewaterSvg),
  },
  {
    id: 'co2-air-collection',
    name: 'CO2 收集',
    category: '收集装置',
    description: '二氧化碳用向上排空气法收集。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(co2CollectionSvg),
  },
  {
    id: 'oxygen-water-collection',
    name: 'O2 排水法收集',
    category: '收集装置',
    description: '氧气经导管进入倒置集气瓶，排水收集。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(oxygenWaterCollectionSvg),
  },
  {
    id: 'oxygen-air-collection',
    name: 'O2 向上排空气法',
    category: '收集装置',
    description: '氧气进入集气瓶底部并向上排出空气。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(oxygenAirCollectionSvg),
  },
  {
    id: 'heated-test-tube-gas',
    name: '加热试管制气体',
    category: '制气装置',
    description: '酒精灯加热斜放试管并通过导管导出气体。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(heatedTestTubeGasSvg),
  },
  {
    id: 'conical-flask-gas',
    name: '锥形瓶反应制气体',
    category: '制气装置',
    description: '锥形瓶、长颈漏斗和导管组成的常见制气装置。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(conicalFlaskGasSvg),
  },
  {
    id: 'co2-full-test',
    name: '检验 CO2 是否集满',
    category: '检验装置',
    description: '燃着木条靠近集气瓶口，火焰熄灭则二氧化碳已集满。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(co2FullTestSvg),
  },
  {
    id: 'airtightness-test',
    name: '检查装置气密性',
    category: '检验装置',
    description: '手握容器加热空气，观察水中导管口是否产生气泡。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(airtightnessTestSvg),
  },
  {
    id: 'filtration',
    name: '过滤装置',
    category: '分离与加热',
    description: '铁架台、漏斗、滤纸、玻璃棒和烧杯组成的过滤装置。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(filtrationSvg),
  },
  {
    id: 'evaporation-dish-heating',
    name: '蒸发皿加热',
    category: '分离与加热',
    description: '蒸发皿置于三脚架上，用酒精灯加热并用玻璃棒搅拌。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 340,
    defaultHeightPx: 208,
    src: svgDataUri(evaporationDishSvg),
  },
] as const satisfies readonly ChemistryApparatusItem[];

export const chemistryLineArtParts = [
  {
    id: 'part-test-tube',
    name: '试管',
    category: '容器',
    description: '可旋转摆放的基础试管线稿。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 78,
    defaultHeightPx: 110,
    src: svgDataUri(partTestTubeSvg),
    editableContainer: editableContainerDefinitions.testTube,
    connectors: testTubeConnectors,
  },
  {
    id: 'part-beaker',
    name: '烧杯',
    category: '容器',
    description: '带液面和刻度的烧杯部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 120,
    defaultHeightPx: 96,
    src: svgDataUri(partBeakerSvg),
    editableContainer: editableContainerDefinitions.beaker,
    connectors: beakerConnectors,
  },
  {
    id: 'part-conical-flask',
    name: '锥形瓶',
    category: '容器',
    description: '常用于制气反应的锥形瓶部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 118,
    defaultHeightPx: 112,
    src: svgDataUri(partConicalFlaskSvg),
    editableContainer: editableContainerDefinitions.conicalFlask,
    connectors: conicalFlaskConnectors,
  },
  {
    id: 'part-gas-jar',
    name: '集气瓶',
    category: '容器',
    description: '用于气体收集和检验的集气瓶部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 108,
    defaultHeightPx: 118,
    src: svgDataUri(partGasJarSvg),
    editableContainer: editableContainerDefinitions.gasJar,
    connectors: gasJarConnectors,
  },
  {
    id: 'part-round-bottom-flask',
    name: '圆底烧瓶',
    category: '容器',
    description: '可用于加热或蒸馏装置的圆底烧瓶部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 118,
    defaultHeightPx: 124,
    src: svgDataUri(partRoundBottomFlaskSvg),
    editableContainer: editableContainerDefinitions.roundBottomFlask,
    connectors: roundBottomFlaskConnectors,
  },
  {
    id: 'part-flat-bottom-flask',
    name: '平底烧瓶',
    category: '容器',
    description: '可平放的基础平底烧瓶线稿。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 120,
    defaultHeightPx: 122,
    src: svgDataUri(partFlatBottomFlaskSvg),
    editableContainer: editableContainerDefinitions.flatBottomFlask,
    connectors: flatBottomFlaskConnectors,
  },
  {
    id: 'part-wide-mouth-bottle',
    name: '广口瓶',
    category: '容器',
    description: '常用于收集和盛放物质的广口瓶部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 112,
    defaultHeightPx: 108,
    src: svgDataUri(partWideMouthBottleSvg),
    editableContainer: editableContainerDefinitions.wideMouthBottle,
    connectors: wideMouthBottleConnectors,
  },
  {
    id: 'part-reagent-bottle',
    name: '试剂瓶',
    category: '容器',
    description: '带瓶塞和标签区的试剂瓶部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 106,
    defaultHeightPx: 118,
    src: svgDataUri(partReagentBottleSvg),
    editableContainer: editableContainerDefinitions.reagentBottle,
    connectors: reagentBottleConnectors,
  },
  {
    id: 'part-graduated-cylinder',
    name: '量筒',
    category: '计量器具',
    description: '带刻度和液面的量筒部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 96,
    defaultHeightPx: 128,
    src: svgDataUri(partGraduatedCylinderSvg),
    editableContainer: editableContainerDefinitions.graduatedCylinder,
    connectors: graduatedCylinderConnectors,
  },
  {
    id: 'part-funnel',
    name: '漏斗',
    category: '分离器材',
    description: '过滤和转移液体常用漏斗部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 110,
    defaultHeightPx: 100,
    src: svgDataUri(partFunnelSvg),
  },
  {
    id: 'part-long-neck-funnel',
    name: '长颈漏斗',
    category: '分离器材',
    description: '制气装置中用于加液的长颈漏斗部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 90,
    defaultHeightPx: 116,
    src: svgDataUri(partLongNeckFunnelSvg),
  },
  {
    id: 'part-separatory-funnel',
    name: '分液漏斗',
    category: '分离器材',
    description: '萃取和控液实验常用分液漏斗部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 96,
    defaultHeightPx: 120,
    src: svgDataUri(partSeparatoryFunnelSvg),
    editableContainer: editableContainerDefinitions.separatoryFunnel,
  },
  {
    id: 'part-condenser',
    name: '冷凝管',
    category: '分离器材',
    description: '蒸馏和回流装置常用的直形冷凝管部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 142,
    defaultHeightPx: 82,
    src: svgDataUri(partCondenserSvg),
  },
  {
    id: 'part-straight-tube',
    name: '直导管',
    category: '导管与塞',
    description: '双线表现玻璃管厚度的直导管部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 128,
    defaultHeightPx: 58,
    src: svgDataUri(partStraightTubeSvg),
  },
  {
    id: 'part-bent-tube',
    name: '弯导管',
    category: '导管与塞',
    description: '用于连接发生装置和收集装置的弯导管部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 126,
    defaultHeightPx: 96,
    src: svgDataUri(partBentTubeSvg),
  },
  {
    id: 'part-rubber-stopper',
    name: '橡胶塞',
    category: '导管与塞',
    description: '可与试管、锥形瓶组合的橡胶塞部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 92,
    defaultHeightPx: 54,
    src: svgDataUri(partRubberStopperSvg),
  },
  {
    id: 'part-single-hole-stopper',
    name: '单孔塞',
    category: '导管与塞',
    description: '带一个插孔的橡胶塞部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 94,
    defaultHeightPx: 56,
    src: svgDataUri(partSingleHoleStopperSvg),
    connectors: singleHoleStopperConnectors,
  },
  {
    id: 'part-double-hole-stopper',
    name: '双孔塞',
    category: '导管与塞',
    description: '带两个插孔的橡胶塞部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 94,
    defaultHeightPx: 56,
    src: svgDataUri(partDoubleHoleStopperSvg),
    connectors: doubleHoleStopperConnectors,
  },
  {
    id: 'part-t-tube',
    name: 'T 形管',
    category: '导管与塞',
    description: '用于分流或连接支路的 T 形玻璃管部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 122,
    defaultHeightPx: 92,
    src: svgDataUri(partTTubeSvg),
  },
  {
    id: 'part-u-tube',
    name: 'U 形管',
    category: '导管与塞',
    description: '可用于洗气、液封或压强示意的 U 形管部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 104,
    defaultHeightPx: 126,
    src: svgDataUri(partUTubeSvg),
  },
  {
    id: 'part-rubber-hose',
    name: '乳胶管',
    category: '导管与塞',
    description: '可作为柔性连接段的乳胶管部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 136,
    defaultHeightPx: 82,
    src: svgDataUri(partRubberHoseSvg),
  },
  {
    id: 'part-glass-plate',
    name: '玻璃片',
    category: '导管与塞',
    description: '收集气体和盖口操作常用玻璃片部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 112,
    defaultHeightPx: 72,
    src: svgDataUri(partGlassPlateSvg),
  },
  {
    id: 'part-water-trough',
    name: '水槽',
    category: '容器',
    description: '排水法收集气体常用水槽部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 140,
    defaultHeightPx: 88,
    src: svgDataUri(partWaterTroughSvg),
    editableContainer: editableContainerDefinitions.waterTrough,
    connectors: waterTroughConnectors,
  },
  {
    id: 'part-iron-stand',
    name: '铁架台',
    category: '支架与加热',
    description: '用于固定漏斗、试管和导管的铁架台部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 108,
    defaultHeightPx: 124,
    src: svgDataUri(partIronStandSvg),
  },
  {
    id: 'part-tripod',
    name: '三脚架',
    category: '支架与加热',
    description: '支撑石棉网、蒸发皿或坩埚的三脚架部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 126,
    defaultHeightPx: 114,
    src: svgDataUri(partTripodSvg),
  },
  {
    id: 'part-wire-gauze',
    name: '石棉网',
    category: '支架与加热',
    description: '加热时用于均匀受热的石棉网部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 116,
    defaultHeightPx: 94,
    src: svgDataUri(partWireGauzeSvg),
  },
  {
    id: 'part-iron-ring',
    name: '铁圈',
    category: '支架与加热',
    description: '可与铁架台组合承托漏斗或加热器皿的铁圈部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 132,
    defaultHeightPx: 82,
    src: svgDataUri(partIronRingSvg),
  },
  {
    id: 'part-iron-clamp',
    name: '铁夹',
    category: '支架与加热',
    description: '用于夹持试管、导管或冷凝管的铁夹部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 128,
    defaultHeightPx: 74,
    src: svgDataUri(partIronClampSvg),
  },
  {
    id: 'part-alcohol-lamp',
    name: '酒精灯',
    category: '支架与加热',
    description: '基础加热用酒精灯部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 112,
    defaultHeightPx: 104,
    src: svgDataUri(partAlcoholLampSvg),
  },
  {
    id: 'part-evaporation-dish',
    name: '蒸发皿',
    category: '支架与加热',
    description: '蒸发结晶和加热浓缩常用蒸发皿部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 116,
    defaultHeightPx: 82,
    src: svgDataUri(partEvaporationDishSvg),
  },
  {
    id: 'part-crucible',
    name: '坩埚',
    category: '支架与加热',
    description: '高温灼烧实验常用坩埚部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 104,
    defaultHeightPx: 88,
    src: svgDataUri(partCrucibleSvg),
  },
  {
    id: 'part-test-tube-clamp',
    name: '试管夹',
    category: '支架与加热',
    description: '手持加热试管时使用的试管夹部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 126,
    defaultHeightPx: 88,
    src: svgDataUri(partTestTubeClampSvg),
  },
  {
    id: 'part-combustion-spoon',
    name: '燃烧匙',
    category: '支架与加热',
    description: '硫、磷等物质燃烧实验常用燃烧匙部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 116,
    defaultHeightPx: 98,
    src: svgDataUri(partCombustionSpoonSvg),
  },
  {
    id: 'part-glass-rod',
    name: '玻璃棒',
    category: '分离器材',
    description: '过滤、蒸发和引流常用玻璃棒部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 120,
    defaultHeightPx: 78,
    src: svgDataUri(partGlassRodSvg),
  },
  {
    id: 'part-dropper',
    name: '滴管',
    category: '计量器具',
    description: '少量加液常用的胶头滴管部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 84,
    defaultHeightPx: 132,
    src: svgDataUri(partDropperSvg),
  },
  {
    id: 'part-burette',
    name: '滴定管',
    category: '计量器具',
    description: '滴定实验常用的带刻度滴定管部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 82,
    defaultHeightPx: 134,
    src: svgDataUri(partBuretteSvg),
    editableContainer: editableContainerDefinitions.burette,
  },
  {
    id: 'part-spoon',
    name: '药匙',
    category: '操作器材',
    description: '取用固体药品常用药匙部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 118,
    defaultHeightPx: 78,
    src: svgDataUri(partSpoonSvg),
  },
  {
    id: 'part-tweezers',
    name: '镊子',
    category: '操作器材',
    description: '夹取小块固体或实验材料的镊子部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 92,
    defaultHeightPx: 126,
    src: svgDataUri(partTweezersSvg),
  },
  {
    id: 'part-mortar',
    name: '研钵',
    category: '操作器材',
    description: '研磨固体试剂常用的研钵和研杵部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 124,
    defaultHeightPx: 88,
    src: svgDataUri(partMortarSvg),
  },
  {
    id: 'part-watch-glass',
    name: '表面皿',
    category: '操作器材',
    description: '承接少量液体或覆盖烧杯口的表面皿部件。',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 部件',
    defaultWidthPx: 122,
    defaultHeightPx: 68,
    src: svgDataUri(partWatchGlassSvg),
  },
] as const satisfies readonly ChemistryLineArtPart[];

export type ChemistryApparatusId = (typeof chemistryApparatusItems)[number]['id'];
export type ChemistryLineArtPartId = (typeof chemistryLineArtParts)[number]['id'];

export function getChemistryApparatusById(id: string): ChemistryApparatusItem | null {
  return chemistryApparatusItems.find((item) => item.id === id) ?? null;
}

export function getChemistryLineArtPartById(id: string): ChemistryLineArtPart | null {
  return chemistryLineArtParts.find((item) => item.id === id) ?? null;
}

export function createChemistryEditableContainerStateForPart(
  part: ChemistryLineArtPart,
): ChemistryEditableContainerState | null {
  if (!part.editableContainer) {
    return null;
  }

  return createChemistryEditableContainerState(part.editableContainer);
}

export function buildChemistryLineArtPartRenderSrc(
  part: ChemistryLineArtPart,
  state?: ChemistryEditableContainerState | null,
): string {
  if (!part.editableContainer || !state) {
    return part.src;
  }

  return buildChemistryEditableContainerSrc(part.name, part.editableContainer, state);
}
