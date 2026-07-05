export type ChemistryApparatusCategory = '基础仪器' | '气体实验' | '检验装置';

export interface ChemistryApparatusItem {
  id: string;
  name: string;
  category: ChemistryApparatusCategory;
  license: '项目原创';
  sourceLabel: string;
  defaultWidthPx: number;
  defaultHeightPx: number;
  src: string;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildLineSvg(label: string, body: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160" role="img" aria-label="${label}">
  <rect width="240" height="160" fill="#fff"/>
  <g fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    ${body}
  </g>
</svg>`.trim();
}

function buildTextSvg(label: string, body: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="260" height="170" viewBox="0 0 260 170" role="img" aria-label="${label}">
  <rect width="260" height="170" fill="#fff"/>
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0 0 L10 4 L0 8 Z" fill="#111827"/>
    </marker>
  </defs>
  <g fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    ${body}
  </g>
</svg>`.trim();
}

const testTubeSvg = buildLineSvg(
  '试管',
  `
    <path d="M98 20h44"/>
    <path d="M104 20v88c0 20 32 20 32 0V20"/>
    <path d="M108 105c7 8 25 8 32 0"/>
    <path d="M109 92h30"/>
  `,
);

const beakerSvg = buildLineSvg(
  '烧杯',
  `
    <path d="M76 32h78"/>
    <path d="M154 32c16 0 22 7 16 18"/>
    <path d="M84 32v86c0 9 7 16 16 16h48c9 0 16-7 16-16V52"/>
    <path d="M96 93h56"/>
    <path d="M96 115h56"/>
    <path d="M100 62h16M100 76h12"/>
  `,
);

const conicalFlaskSvg = buildLineSvg(
  '锥形瓶',
  `
    <path d="M105 26h30"/>
    <path d="M111 26v35L74 128c-4 8 2 16 12 16h68c10 0 16-8 12-16l-37-67V26"/>
    <path d="M90 112c18 10 42 10 60 0"/>
    <path d="M88 130h64"/>
  `,
);

const gasJarSvg = buildLineSvg(
  '集气瓶',
  `
    <path d="M86 34h68"/>
    <path d="M95 34v91c0 10 8 18 18 18h22c10 0 18-8 18-18V34"/>
    <path d="M104 51h40"/>
  `,
);

const alcoholLampSvg = buildLineSvg(
  '酒精灯',
  `
    <path d="M112 65c-10-12-4-27 8-39 12 12 18 27 8 39"/>
    <path d="M109 77h22"/>
    <path d="M105 77v18l-28 42h86l-28-42V77"/>
    <path d="M88 118c18 10 46 10 64 0"/>
    <path d="M78 142h84"/>
  `,
);

const deliveryTubeJarSvg = buildTextSvg(
  '导管集气瓶',
  `
    <path d="M95 45h72"/>
    <path d="M104 45v86c0 9 7 16 16 16h28c9 0 16-7 16-16V45"/>
    <path d="M132 45V24h-47"/>
    <path d="M84 24h-34" marker-end="url(#arrow)"/>
    <path d="M173 38l33-18"/>
    <path d="M175 44l31 18"/>
  `,
);

const limewaterTestSvg = buildTextSvg(
  '澄清石灰水检验',
  `
    <path d="M120 30h48"/>
    <path d="M126 30v96c0 13 36 13 36 0V30"/>
    <path d="M129 94h30"/>
    <path d="M88 28h28v76"/>
    <path d="M56 28h31" marker-end="url(#arrow)"/>
    <path d="M116 104c10 6 28 6 44 0"/>
  `,
).replace(
  '</svg>',
  '  <text x="24" y="33" fill="#111827" font-size="18" font-family="Arial, sans-serif">CO2</text>\n  <text x="170" y="99" fill="#111827" font-size="16" font-family="Arial, Microsoft YaHei, sans-serif">澄清</text>\n  <text x="170" y="119" fill="#111827" font-size="16" font-family="Arial, Microsoft YaHei, sans-serif">石灰水</text>\n</svg>',
);

const co2CollectionSvg = buildTextSvg(
  '二氧化碳收集示意',
  `
    <path d="M106 45h66"/>
    <path d="M115 45v88c0 9 7 16 16 16h24c9 0 16-7 16-16V45"/>
    <path d="M139 45V26h-38"/>
    <path d="M73 26h28" marker-end="url(#arrow)"/>
    <path d="M175 31l29-18"/>
    <path d="M177 38l26 16"/>
    <path d="M123 128h40"/>
  `,
).replace(
  '</svg>',
  '  <text x="29" y="31" fill="#111827" font-size="20" font-family="Arial, sans-serif">CO2</text>\n</svg>',
);

// 第一版素材全部为项目原创线稿，避免把授权不明的教材或题库图片直接内置进产品。
export const chemistryApparatusItems = [
  {
    id: 'test-tube',
    name: '试管',
    category: '基础仪器',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 180,
    defaultHeightPx: 120,
    src: svgDataUri(testTubeSvg),
  },
  {
    id: 'beaker',
    name: '烧杯',
    category: '基础仪器',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 180,
    defaultHeightPx: 120,
    src: svgDataUri(beakerSvg),
  },
  {
    id: 'conical-flask',
    name: '锥形瓶',
    category: '基础仪器',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 180,
    defaultHeightPx: 120,
    src: svgDataUri(conicalFlaskSvg),
  },
  {
    id: 'gas-jar',
    name: '集气瓶',
    category: '基础仪器',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 180,
    defaultHeightPx: 120,
    src: svgDataUri(gasJarSvg),
  },
  {
    id: 'alcohol-lamp',
    name: '酒精灯',
    category: '基础仪器',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 180,
    defaultHeightPx: 120,
    src: svgDataUri(alcoholLampSvg),
  },
  {
    id: 'delivery-tube-jar',
    name: '导管集气瓶',
    category: '气体实验',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 210,
    defaultHeightPx: 138,
    src: svgDataUri(deliveryTubeJarSvg),
  },
  {
    id: 'limewater-test',
    name: '澄清石灰水检验',
    category: '检验装置',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 220,
    defaultHeightPx: 144,
    src: svgDataUri(limewaterTestSvg),
  },
  {
    id: 'co2-collection',
    name: '二氧化碳收集示意',
    category: '气体实验',
    license: '项目原创',
    sourceLabel: 'LAYOUT3.0 原创 SVG 线稿',
    defaultWidthPx: 220,
    defaultHeightPx: 144,
    src: svgDataUri(co2CollectionSvg),
  },
] as const satisfies readonly ChemistryApparatusItem[];

export type ChemistryApparatusId = (typeof chemistryApparatusItems)[number]['id'];

export function getChemistryApparatusById(id: string): ChemistryApparatusItem | null {
  return chemistryApparatusItems.find((item) => item.id === id) ?? null;
}
