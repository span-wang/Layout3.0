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
  <rect width="400" height="240" fill="#ffffff"/>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0 0 L8 3 L0 6 Z" fill="#111827"/>
    </marker>
    <pattern id="dots" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.1" fill="#111827"/>
    </pattern>
  </defs>
  <style>
    .outline{fill:none;stroke:#111827;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
    .detail{fill:none;stroke:#111827;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}
    .guide{fill:none;stroke:#111827;stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:4 4}
    .liquid{fill:#f4fbfb;stroke:#111827;stroke-width:1.3;stroke-linejoin:round}
    .solid{fill:url(#dots);stroke:#111827;stroke-width:1.3;stroke-linejoin:round}
    .stopper{fill:#111827}
    .label{fill:#111827;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:15px;font-weight:600}
    .note{fill:#4b5563;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:12px}
    .gas{fill:#111827;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:18px;font-weight:700}
  </style>
  ${body}
</svg>`.trim();
}

function buildPartSvg(label: string, body: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="170" viewBox="0 0 220 170" role="img" aria-label="${label}">
  <rect width="220" height="170" fill="#ffffff"/>
  <style>
    .outline{fill:none;stroke:#111827;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
    .detail{fill:none;stroke:#111827;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
    .liquid{fill:#f4fbfb;stroke:#111827;stroke-width:1.2;stroke-linejoin:round}
    .solid{fill:#111827;fill-opacity:.14;stroke:#111827;stroke-width:1.2;stroke-linejoin:round}
    .dark{fill:#111827}
  </style>
  ${body}
</svg>`.trim();
}

function clampContainerLevel(level: number): number {
  return Math.max(5, Math.min(95, Math.round(level)));
}

function buildLiquidPath(left: number, right: number, top: number, bottom: number, curveDepth: number): string {
  const centerX = (left + right) / 2;
  return `M${left} ${bottom}L${left} ${top}Q${centerX} ${top - curveDepth} ${right} ${top}L${right} ${bottom}Z`;
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
      const liquidTop = 97 - state.liquidLevel * 0.42;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M88 18h30"/>
  <path class="outline" d="M92 18v73q0 18 11 28q11-10 11-28V18"/>
  <path class="detail" d="M95 18v70q0 13 8 22"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(96, 110, liquidTop, 99, 4)}"/>` : ''}
  ${state.showStopper ? '<rect class="dark" x="88" y="13" width="34" height="9" rx="2"/>' : ''}
  `,
      );
    }
    case 'beaker': {
      const liquidTop = 116 - state.liquidLevel * 0.6;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M58 26h76"/>
  <path class="outline" d="M135 26q10 0 13 7q2 5-2 10"/>
  <path class="outline" d="M64 26v89q0 12 12 12h49q12 0 12-12V47"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(66, 136, liquidTop, 127, 5)}"/>` : ''}
  ${state.showScaleMarks ? buildScaleMarks(78, 55, 105, 18, 12, 12) : ''}
  `,
      );
    }
    case 'conicalFlask': {
      const liquidTop = 122 - state.liquidLevel * 0.55;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M92 20h34"/>
  <path class="outline" d="M98 20v34l-37 58q-6 10 7 18h82q13-8 7-18l-37-58V20"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(76, 142, liquidTop, 121, 6)}"/>` : ''}
  <path class="detail" d="M83 96Q109 105 135 96"/>
  ${state.showStopper ? '<rect class="dark" x="92" y="14" width="34" height="9" rx="2"/>' : ''}
  `,
      );
    }
    case 'gasJar': {
      const liquidTop = 124 - state.liquidLevel * 0.72;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M83 26q0-10 8-10h38q8 0 8 10v88q0 16-15 19h-16q-15-3-15-19Z"/>
  ${state.showScaleMarks ? '<path class="detail" d="M86 42h48"/><path class="detail" d="M91 80h38"/><path class="detail" d="M91 103h38"/>' : '<path class="detail" d="M86 42h48"/>'}
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(92, 128, liquidTop, 132, 4)}"/>` : ''}
  ${state.showStopper ? '<rect class="dark" x="84" y="13" width="52" height="8" rx="2"/>' : ''}
  `,
      );
    }
    case 'roundBottomFlask': {
      const liquidTop = 122 - state.liquidLevel * 0.5;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M95 18h30"/>
  <path class="outline" d="M101 18v50q-26 8-34 30q-7 21 8 36q13 13 35 13q22 0 35-13q15-15 8-36q-8-22-34-30V18"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(79, 141, liquidTop, 133, 7)}"/>` : ''}
  <path class="detail" d="M95 75Q110 84 125 75"/>
  ${state.showStopper ? '<rect class="dark" x="95" y="12" width="30" height="9" rx="2"/>' : ''}
  `,
      );
    }
    case 'flatBottomFlask': {
      const liquidTop = 124 - state.liquidLevel * 0.52;
      return buildPartSvg(
        label,
        `
  <path class="outline" d="M94 18h32"/>
  <path class="outline" d="M100 18v47q-27 10-36 42q-4 15 8 27h76q12-12 8-27q-9-32-36-42V18"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(76, 144, liquidTop, 126, 6)}"/>` : ''}
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
  <rect x="91" y="72" width="38" height="34" rx="3" fill="#ffffff" stroke="#111827" stroke-width="1.2"/>
  <path class="detail" d="M98 86h24M100 96h20"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(86, 134, liquidTop, 132, 4)}"/>` : ''}
  `,
      );
    }
    case 'graduatedCylinder': {
      const liquidTop = 132 - state.liquidLevel * 0.84;
      return buildPartSvg(
        label,
        `
  <ellipse class="outline" cx="108" cy="27" rx="25" ry="8"/>
  <path class="outline" d="M83 27v96q0 8 8 12h34q8-4 8-12V27"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(86, 130, liquidTop, 132, 4)}"/>` : ''}
  ${state.showScaleMarks ? buildScaleMarks(96, 46, 114, 17, 11, 13) : ''}
  <path class="outline" d="M74 142h68"/>
  <path class="detail" d="M95 134h26l11 8H84Z"/>
  `,
      );
    }
    case 'separatoryFunnel': {
      // 分液漏斗的液面只画在球胆区域里，避免覆盖上方细颈和下端活塞。
      const liquidTop = 112 - state.liquidLevel * 0.42;
      return buildPartSvg(
        label,
        `
  ${state.showStopper ? '<rect class="dark" x="93" y="14" width="34" height="9" rx="2"/>' : '<path class="outline" d="M96 18h28"/>'}
  <path class="outline" d="M100 22v24"/>
  <path class="outline" d="M100 46q-18 13-24 31q-6 18 5 34q10 15 29 18v12h0v-12q19-3 29-18q11-16 5-34q-6-18-24-31V22"/>
  <path class="detail" d="M110 129v15"/>
  <path class="outline" d="M95 134h30"/>
  <circle cx="110" cy="134" r="4.5" fill="#ffffff" stroke="#111827" stroke-width="1.2"/>
  <path class="detail" d="M125 134h18"/>
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
  <path class="outline" d="M101 20h18"/>
  <path class="outline" d="M104 20v100l6 24l6-24V20"/>
  ${state.showLiquid ? `<path class="liquid" d="${buildLiquidPath(106, 114, liquidTop, 118, 3)}"/>` : ''}
  ${state.showScaleMarks ? buildScaleMarks(120, 38, 106, -10, -7, 13) : ''}
  <path class="outline" d="M92 116h36"/>
  <circle cx="110" cy="116" r="4" fill="#ffffff" stroke="#111827" stroke-width="1.2"/>
  <path class="detail" d="M128 116h20"/>
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
  <path class="outline" d="M70 60h38"/>
  <path class="outline" d="M76 60v34l-28 77q-4 12 11 21h60q15-9 11-21l-28-77V60"/>
  <path class="detail" d="M84 60v33l-22 63"/>
  <path class="solid" d="M60 170Q89 182 118 170v18Q108 197 89 197Q70 197 60 188Z"/>
  <rect class="stopper" x="74" y="52" width="31" height="10" rx="2"/>
  <path class="outline" d="M91 52v-20h77q18 0 24 17q3 8 3 17v81"/>
  <path class="detail" d="M101 33h47" marker-end="url(#arrow)"/>
  <path class="outline" d="M190 68h42"/>
  <path class="outline" d="M195 68v102q0 9 7 15q7 6 14 6h3q7 0 14-6q7-6 7-15V68"/>
  <path class="detail" d="M198 84h39"/>
  <path class="liquid" d="M199 141Q219 135 239 141v25q0 9-6 14q-6 5-14 5h0q-8 0-14-5q-6-5-6-14Z"/>
  <rect class="stopper" x="189" y="60" width="44" height="9" rx="2"/>
  <circle cx="220" cy="145" r="3" fill="#ffffff" stroke="#111827" stroke-width="1.2"/>
  <circle cx="215" cy="155" r="2.3" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  <circle cx="225" cy="161" r="2.2" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  <text class="label" x="47" y="226">大理石 + 稀盐酸</text>
  <text class="label" x="255" y="142">澄清石灰水</text>
  <text class="note" x="261" y="161">变浑浊</text>
  <text class="gas" x="141" y="28">CO<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  `,
);

const co2CollectionSvg = buildTemplateSvg(
  '二氧化碳收集装置',
  `
  <path class="outline" d="M30 204h324"/>
  <path class="outline" d="M64 62h38"/>
  <path class="outline" d="M70 62v35l-27 75q-5 12 11 21h59q16-9 11-21L97 97V62"/>
  <path class="solid" d="M57 169Q84 180 111 169v18Q101 196 84 196Q67 196 57 187Z"/>
  <rect class="stopper" x="69" y="54" width="30" height="9" rx="2"/>
  <path class="outline" d="M86 54V35h149q20 0 25 17q2 8 2 19v77"/>
  <path class="detail" d="M113 35h77" marker-end="url(#arrow)"/>
  <path class="outline" d="M260 56q0-10 9-10h38q9 0 9 10v119q0 18-17 18h-22q-17 0-17-18Z"/>
  <path class="detail" d="M262 74h52"/>
  <path class="guide" d="M269 104h37"/>
  <path class="guide" d="M269 133h37"/>
  <path class="outline" d="M242 45h90"/>
  <path class="detail" d="M317 41l18 0"/>
  <text class="label" x="46" y="226">反应瓶</text>
  <text class="label" x="232" y="226">向上排空气收集</text>
  <text class="gas" x="155" y="31">CO<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  <text class="note" x="318" y="48">玻璃片</text>
  `,
);

const oxygenWaterCollectionSvg = buildTemplateSvg(
  '氧气排水法收集装置',
  `
  <path class="outline" d="M30 204h324"/>
  <path class="outline" d="M62 64h38"/>
  <path class="outline" d="M68 64v35l-27 73q-5 12 11 21h58q16-9 11-21L94 99V64"/>
  <path class="solid" d="M55 169Q81 179 107 169v18Q98 196 81 196Q64 196 55 187Z"/>
  <rect class="stopper" x="67" y="56" width="30" height="9" rx="2"/>
  <path class="outline" d="M84 56V35h73q17 0 23 16q4 8 4 18v92h34"/>
  <path class="detail" d="M112 35h51" marker-end="url(#arrow)"/>
  <path class="outline" d="M182 122h154v61q0 10-8 16q-8 6-18 6H208q-10 0-18-6q-8-6-8-16Z"/>
  <path class="liquid" d="M185 140Q259 131 333 140v42q0 8-6 12q-6 4-16 4H207q-10 0-16-4q-6-4-6-12Z"/>
  <path class="outline" d="M226 49q0-9 8-9h34q8 0 8 9v80h-50Z"/>
  <path class="detail" d="M226 64h50"/>
  <path class="outline" d="M184 129h51"/>
  <circle cx="229" cy="161" r="3" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  <circle cx="239" cy="152" r="2.6" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  <circle cx="249" cy="161" r="2.3" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  <text class="gas" x="122" y="30">O<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  <text class="label" x="232" y="34">倒置集气瓶</text>
  <text class="label" x="248" y="226">水槽</text>
  <text class="note" x="252" y="160">气泡</text>
  `,
);

const oxygenAirCollectionSvg = buildTemplateSvg(
  '氧气向上排空气法收集装置',
  `
  <path class="outline" d="M30 204h324"/>
  <path class="outline" d="M66 63h38"/>
  <path class="outline" d="M72 63v35l-27 74q-4 12 11 21h58q16-9 11-21L98 98V63"/>
  <path class="solid" d="M59 169Q85 179 111 169v18Q102 196 85 196Q68 196 59 187Z"/>
  <rect class="stopper" x="71" y="55" width="30" height="9" rx="2"/>
  <path class="outline" d="M88 55V35h162q19 0 24 17q3 8 3 19v79"/>
  <path class="detail" d="M116 35h78" marker-end="url(#arrow)"/>
  <path class="outline" d="M275 56q0-10 9-10h34q9 0 9 10v119q0 18-17 18h-18q-17 0-17-18Z"/>
  <path class="detail" d="M278 128h46"/>
  <path class="guide" d="M282 94h38"/>
  <path class="guide" d="M282 124h38"/>
  <path class="detail" d="M292 144Q312 124 307 89" marker-end="url(#arrow)"/>
  <text class="gas" x="146" y="30">O<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  <text class="label" x="239" y="226">向上排空气法</text>
  <text class="note" x="324" y="85">空气逸出</text>
  `,
);

const heatedTestTubeGasSvg = buildTemplateSvg(
  '加热试管制气体',
  `
  <path class="outline" d="M28 204h328"/>
  <path class="outline" d="M61 178h96"/>
  <path class="outline" d="M109 178V86"/>
  <path class="outline" d="M77 103l146-30"/>
  <path class="outline" d="M86 117l145-30"/>
  <path class="outline" d="M86 117q-16 3-20-10q-3-12 9-16"/>
  <path class="solid" d="M108 106l49-10 3 13-49 11Z"/>
  <rect class="stopper" x="214" y="71" width="29" height="11" rx="2" transform="rotate(-12 214 71)"/>
  <path class="outline" d="M232 79l52-11q17-4 23 7q5 9 5 17v46"/>
  <path class="outline" d="M285 138h51"/>
  <path class="outline" d="M292 138v36q0 16 19 16h6q19 0 19-16v-36"/>
  <path class="detail" d="M254 77h37" marker-end="url(#arrow)"/>
  <path class="outline" d="M146 159q-11-18 0-36q11-18 12-18q1 0 12 18q11 18 0 36"/>
  <path class="outline" d="M141 167h34"/>
  <path class="outline" d="M131 204l18-28h18l18 28"/>
  <path class="detail" d="M100 92l117-25"/>
  <text class="label" x="82" y="226">酒精灯加热</text>
  <text class="note" x="66" y="82">固体混合物</text>
  <text class="label" x="274" y="226">收集气体</text>
  `,
);

const conicalFlaskGasSvg = buildTemplateSvg(
  '锥形瓶反应制气体',
  `
  <path class="outline" d="M30 204h324"/>
  <path class="outline" d="M71 76h46"/>
  <path class="outline" d="M80 76v41l-35 55q-8 11 7 21h94q15-10 7-21l-35-55V76"/>
  <path class="liquid" d="M60 162Q99 176 138 162v20Q131 190 99 190Q67 190 60 182Z"/>
  <path class="solid" d="M67 169Q97 179 127 169v11Q122 186 97 186Q72 186 67 180Z"/>
  <path class="outline" d="M60 36h18"/>
  <path class="outline" d="M69 36v88"/>
  <ellipse class="outline" cx="69" cy="31" rx="16" ry="7"/>
  <rect class="stopper" x="75" y="68" width="38" height="10" rx="2"/>
  <path class="outline" d="M94 68V38h129q18 0 24 17q3 8 3 18v51"/>
  <path class="detail" d="M147 40h69" marker-end="url(#arrow)"/>
  <path class="outline" d="M248 125h57"/>
  <path class="outline" d="M256 125v48q0 8 6 13q6 5 14 5h9q8 0 14-5q6-5 6-13v-48"/>
  <path class="detail" d="M259 137h43"/>
  <text class="label" x="38" y="226">长颈漏斗 + 锥形瓶</text>
  <text class="note" x="288" y="119">导出气体</text>
  <text class="gas" x="176" y="34">气体</text>
  `,
);

const co2FullTestSvg = buildTemplateSvg(
  '检验二氧化碳是否集满',
  `
  <path class="outline" d="M34 204h312"/>
  <path class="outline" d="M183 55q0-10 8-10h36q8 0 8 10v117q0 18-18 18h-16q-18 0-18-18Z"/>
  <path class="detail" d="M185 72h48"/>
  <path class="guide" d="M191 108h36"/>
  <path class="guide" d="M191 136h36"/>
  <path class="outline" d="M172 48h74"/>
  <path class="detail" d="M105 86l78 20"/>
  <path class="detail" d="M98 84l-32-9"/>
  <path class="outline" d="M57 66q11-22 25-10q4 3 5 10q15-9 24 6q6 11-2 21"/>
  <path class="detail" d="M57 101l39-31"/>
  <path class="detail" d="M83 108l18-30"/>
  <path class="detail" d="M64 62l25 39"/>
  <text class="gas" x="199" y="121">CO<tspan baseline-shift="sub" font-size="12">2</tspan></text>
  <text class="label" x="40" y="226">燃着木条靠近瓶口</text>
  <text class="note" x="257" y="76">火焰熄灭</text>
  <text class="note" x="247" y="94">说明已集满</text>
  `,
);

const airtightnessTestSvg = buildTemplateSvg(
  '检查装置气密性',
  `
  <path class="outline" d="M30 204h324"/>
  <path class="outline" d="M63 64h40"/>
  <path class="outline" d="M69 64v35l-27 73q-4 12 11 21h59q15-9 11-21L96 99V64"/>
  <rect class="stopper" x="68" y="56" width="30" height="9" rx="2"/>
  <path class="outline" d="M85 56V36h117q18 0 24 17q3 8 3 18v86h23"/>
  <path class="detail" d="M113 36h63" marker-end="url(#arrow)"/>
  <path class="outline" d="M252 128h74"/>
  <path class="outline" d="M258 128v45q0 17 16 17h30q16 0 16-17v-45"/>
  <path class="liquid" d="M260 160Q289 154 318 160v13q0 7-5 12q-5 5-12 5h-24q-7 0-12-5q-5-5-5-12Z"/>
  <circle cx="288" cy="170" r="3" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  <circle cx="298" cy="161" r="2.7" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  <circle cx="308" cy="170" r="2.3" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  <path class="detail" d="M40 116q15-12 34 0"/>
  <path class="detail" d="M41 132q15-12 34 0"/>
  <path class="detail" d="M42 148q15-12 34 0"/>
  <text class="label" x="44" y="226">手握试管</text>
  <text class="label" x="228" y="226">导管口有气泡</text>
  <text class="note" x="131" y="31">空气受热膨胀</text>
  `,
);

const filtrationSvg = buildTemplateSvg(
  '过滤装置',
  `
  <path class="outline" d="M28 204h328"/>
  <path class="outline" d="M84 49v155"/>
  <path class="outline" d="M61 204h46"/>
  <path class="outline" d="M84 94h128"/>
  <path class="outline" d="M166 73h76"/>
  <path class="outline" d="M150 79h72l-35 66Z"/>
  <path class="detail" d="M160 87h52l-25 47Z"/>
  <path class="outline" d="M187 145v22"/>
  <path class="outline" d="M236 126h54"/>
  <path class="outline" d="M244 126v47q0 8 6 13q6 5 14 5h6q8 0 14-5q6-5 6-13v-47"/>
  <path class="liquid" d="M246 161Q267 156 288 161v11q0 7-5 11q-5 4-13 4h-6q-8 0-13-4q-5-4-5-11Z"/>
  <path class="detail" d="M127 53l84 44"/>
  <path class="detail" d="M121 61l83 44"/>
  <text class="label" x="69" y="226">铁架台</text>
  <text class="label" x="139" y="64">玻璃棒</text>
  <text class="note" x="230" y="98">滤纸</text>
  <text class="note" x="296" y="161">滤液</text>
  `,
);

const evaporationDishSvg = buildTemplateSvg(
  '蒸发皿加热',
  `
  <path class="outline" d="M30 204h324"/>
  <path class="outline" d="M156 110h88"/>
  <path class="outline" d="M164 110q8 24 36 24q28 0 36-24"/>
  <path class="liquid" d="M170 114Q200 122 230 114q-5 11-30 11q-25 0-30-11Z"/>
  <path class="detail" d="M145 90l98 23"/>
  <path class="detail" d="M143 98l98 23"/>
  <path class="outline" d="M132 143h136"/>
  <path class="detail" d="M144 143l20 61"/>
  <path class="detail" d="M256 143l-20 61"/>
  <path class="outline" d="M185 174q-11-17 0-34q11-17 15-17q4 0 15 17q11 17 0 34"/>
  <path class="outline" d="M180 181h40"/>
  <path class="outline" d="M170 204l19-28h22l19 28"/>
  <path class="guide" d="M171 80q29-18 58 0"/>
  <path class="guide" d="M181 65q19-10 38 0"/>
  <text class="label" x="159" y="226">酒精灯加热</text>
  <text class="label" x="255" y="102">蒸发皿</text>
  <text class="note" x="86" y="92">玻璃棒搅拌</text>
  `,
);

const partTestTubeSvg = buildPartSvg(
  '试管部件',
  `
  <path class="outline" d="M88 18h30"/>
  <path class="outline" d="M92 18v73q0 18 11 28q11-10 11-28V18"/>
  <path class="detail" d="M95 18v70q0 13 8 22"/>
  <path class="liquid" d="M95 82Q103 86 111 82v12Q111 103 103 110Q95 103 95 94Z"/>
  `,
);

const partBeakerSvg = buildPartSvg(
  '烧杯部件',
  `
  <path class="outline" d="M58 26h76"/>
  <path class="outline" d="M135 26q10 0 13 7q2 5-2 10"/>
  <path class="outline" d="M64 26v89q0 12 12 12h49q12 0 12-12V47"/>
  <path class="liquid" d="M66 87Q101 80 136 87v28q0 12-12 12H78q-12 0-12-12Z"/>
  <path class="detail" d="M78 55h18M78 67h14M78 79h18"/>
  `,
);

const partConicalFlaskSvg = buildPartSvg(
  '锥形瓶部件',
  `
  <path class="outline" d="M92 20h34"/>
  <path class="outline" d="M98 20v34l-37 58q-6 10 7 18h82q13-8 7-18l-37-58V20"/>
  <path class="liquid" d="M76 104Q109 115 142 104v14Q135 126 109 126Q83 126 76 118Z"/>
  <path class="detail" d="M83 96Q109 105 135 96"/>
  `,
);

const partGasJarSvg = buildPartSvg(
  '集气瓶部件',
  `
  <path class="outline" d="M83 26q0-10 8-10h38q8 0 8 10v88q0 16-15 19h-16q-15-3-15-19Z"/>
  <path class="detail" d="M86 42h48"/>
  <path class="detail" d="M91 80h38"/>
  <path class="detail" d="M91 103h38"/>
  `,
);

const partFunnelSvg = buildPartSvg(
  '漏斗部件',
  `
  <path class="outline" d="M57 28h106L115 87v42h-10V87Z"/>
  <path class="detail" d="M73 43h74"/>
  <path class="detail" d="M106 87h18"/>
  `,
);

const partLongNeckFunnelSvg = buildPartSvg(
  '长颈漏斗部件',
  `
  <path class="outline" d="M76 20h68l-28 33v73h-12V53Z"/>
  <path class="detail" d="M90 34h40"/>
  <path class="detail" d="M104 53h12"/>
  `,
);

const partSeparatoryFunnelSvg = buildPartSvg(
  '分液漏斗部件',
  `
  <path class="outline" d="M94 18h32"/>
  <path class="outline" d="M100 24q-18 15-18 38q0 23 28 46q28-23 28-46q0-23-18-38"/>
  <path class="detail" d="M87 62h46"/>
  <path class="outline" d="M110 108v18"/>
  <path class="outline" d="M99 120h22"/>
  <circle cx="110" cy="120" r="2.2" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  `,
);

const partStraightTubeSvg = buildPartSvg(
  '直导管部件',
  `
  <path class="outline" d="M43 77h130"/>
  <path class="outline" d="M43 89h130"/>
  <path class="detail" d="M53 83h110"/>
  `,
);

const partBentTubeSvg = buildPartSvg(
  '弯导管部件',
  `
  <path class="outline" d="M56 121V72q0-18 18-18h86"/>
  <path class="outline" d="M68 121V83q0-16 16-16h76"/>
  <path class="detail" d="M62 116q6-5 6-13V78q0-12 12-12h72"/>
  `,
);

const partRubberStopperSvg = buildPartSvg(
  '橡胶塞部件',
  `
  <path class="dark" d="M68 57h84l12 37H56z"/>
  <ellipse cx="110" cy="69" rx="8" ry="4.5" fill="#ffffff"/>
  <path class="detail" d="M82 74h56"/>
  <path class="detail" d="M76 84h68"/>
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
  <path class="outline" d="M64 130h84"/>
  <path class="outline" d="M106 24v106"/>
  <path class="outline" d="M106 49h62"/>
  <path class="outline" d="M157 49v27"/>
  <path class="detail" d="M149 76h16"/>
  <path class="detail" d="M66 130h80"/>
  `,
);

const partAlcoholLampSvg = buildPartSvg(
  '酒精灯部件',
  `
  <path class="outline" d="M104 30q-10 15 0 31q10-16 0-31"/>
  <path class="outline" d="M94 67h20"/>
  <path class="outline" d="M91 67v17l-27 39h80l-27-39V67"/>
  <path class="detail" d="M76 105Q104 116 132 105"/>
  <path class="detail" d="M84 92h40"/>
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
  <ellipse class="outline" cx="108" cy="27" rx="25" ry="8"/>
  <path class="outline" d="M83 27v96q0 8 8 12h34q8-4 8-12V27"/>
  <path class="liquid" d="M85 91Q108 86 131 91v31q0 7-7 10H92q-7-3-7-10Z"/>
  <path class="detail" d="M96 46h17M96 59h11M96 72h17M96 85h11M96 98h17M96 111h11"/>
  <path class="outline" d="M74 142h68"/>
  <path class="detail" d="M95 134h26l11 8H84Z"/>
  `,
);

const partRoundBottomFlaskSvg = buildPartSvg(
  '圆底烧瓶部件',
  `
  <path class="outline" d="M95 18h30"/>
  <path class="outline" d="M101 18v50q-26 8-34 30q-7 21 8 36q13 13 35 13q22 0 35-13q15-15 8-36q-8-22-34-30V18"/>
  <path class="liquid" d="M78 115Q110 125 142 115q-4 18-32 18q-28 0-32-18Z"/>
  <path class="detail" d="M95 75Q110 84 125 75"/>
  `,
);

const partFlatBottomFlaskSvg = buildPartSvg(
  '平底烧瓶部件',
  `
  <path class="outline" d="M94 18h32"/>
  <path class="outline" d="M100 18v47q-27 10-36 42q-4 15 8 27h76q12-12 8-27q-9-32-36-42V18"/>
  <path class="liquid" d="M76 112Q110 123 144 112v14q-3 8-12 8H88q-9 0-12-8Z"/>
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
  <rect x="91" y="72" width="38" height="34" rx="3" fill="#ffffff" stroke="#111827" stroke-width="1.2"/>
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
  <rect x="58" y="56" width="104" height="58" rx="4" fill="#ffffff" stroke="#111827" stroke-width="2.1"/>
  <path class="detail" d="M70 102L148 66"/>
  <path class="detail" d="M84 108L160 73"/>
  <path class="detail" d="M58 56l104 58"/>
  `,
);

const partSingleHoleStopperSvg = buildPartSvg(
  '单孔塞部件',
  `
  <path class="dark" d="M63 56h94l14 42H49z"/>
  <ellipse cx="110" cy="74" rx="9" ry="5" fill="#ffffff"/>
  <path class="detail" d="M77 82h66"/>
  <path class="detail" d="M70 93h80"/>
  `,
);

const partDoubleHoleStopperSvg = buildPartSvg(
  '双孔塞部件',
  `
  <path class="dark" d="M63 56h94l14 42H49z"/>
  <ellipse cx="95" cy="74" rx="8" ry="4.5" fill="#ffffff"/>
  <ellipse cx="125" cy="74" rx="8" ry="4.5" fill="#ffffff"/>
  <path class="detail" d="M77 82h66"/>
  <path class="detail" d="M70 93h80"/>
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
  <rect x="56" y="43" width="108" height="84" fill="#ffffff" stroke="#111827" stroke-width="2.1"/>
  <path class="detail" d="M74 43v84M92 43v84M110 43v84M128 43v84M146 43v84"/>
  <path class="detail" d="M56 57h108M56 71h108M56 85h108M56 99h108M56 113h108"/>
  <rect x="91" y="66" width="38" height="38" fill="#111827" fill-opacity=".12" stroke="#111827" stroke-width="1.2"/>
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
  <circle cx="82" cy="84" r="8" fill="#ffffff" stroke="#111827" stroke-width="1.4"/>
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
  <circle cx="110" cy="151" r="3" fill="#ffffff" stroke="#111827" stroke-width="1.1"/>
  `,
);

const partBuretteSvg = buildPartSvg(
  '滴定管部件',
  `
  <path class="outline" d="M101 20h18"/>
  <path class="outline" d="M104 20v102l6 22l6-22V20"/>
  <path class="detail" d="M120 44h-10M120 57h-7M120 70h-10M120 83h-7M120 96h-10"/>
  <path class="outline" d="M92 116h36"/>
  <circle cx="110" cy="116" r="4" fill="#ffffff" stroke="#111827" stroke-width="1.2"/>
  <path class="detail" d="M128 116h20"/>
  `,
);

const partCondenserSvg = buildPartSvg(
  '冷凝管部件',
  `
  <path class="outline" d="M43 87h134"/>
  <path class="outline" d="M43 103h134"/>
  <path class="detail" d="M54 95h112"/>
  <path class="outline" d="M70 70l20 17"/>
  <path class="outline" d="M130 103l20 17"/>
  <path class="detail" d="M70 70h-25M150 120h25"/>
  <path class="detail" d="M61 78l11-15M142 112l-11 15"/>
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
