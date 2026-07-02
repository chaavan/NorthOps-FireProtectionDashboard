import type { EstimatePumpBundleSize } from "@/lib/estimateTypes";
import { buildMaterialCatalogRowMetadata } from "@/lib/estimate/system1Template";

export const SYNTHETIC_PUMP_BUNDLE_ROW_KEY = "synthetic-pump-bundle";

export type DirectChildMode = "multiplier" | "fixed";

export type DirectChildSpec = {
  childRowKey: string;
  mode: DirectChildMode;
  value: number;
};

export type DirectChildRule = {
  parentRowKey: string;
  children: DirectChildSpec[];
};

export type AggregatorRule = {
  childRowKey: string;
  triggerRowKeys: string[];
  exclude?: string[];
};

export type PumpBundleEntry = {
  childRowKey: string;
  quantity: number;
};

export type PumpBundleRule = {
  parentSyntheticKey: typeof SYNTHETIC_PUMP_BUNDLE_ROW_KEY;
  commonChildren: PumpBundleEntry[];
  sizeChildren: Record<EstimatePumpBundleSize, PumpBundleEntry[]>;
};

const rowKey = (sheetRow: number) => `row-${sheetRow}`;

const range = (start: number, end: number) => {
  const out: string[] = [];
  for (let row = start; row <= end; row += 1) out.push(rowKey(row));
  return out;
};

const combine = (...lists: string[][]) =>
  Array.from(new Set(lists.flat()));

export const SYSTEM1_DIRECT_CHILD_RULES: DirectChildRule[] = [
  {
    parentRowKey: rowKey(789),
    children: [{ childRowKey: rowKey(790), mode: "multiplier", value: 1 }],
  },
  {
    parentRowKey: rowKey(900),
    children: [{ childRowKey: rowKey(901), mode: "multiplier", value: 1 }],
  },
  {
    parentRowKey: rowKey(942),
    children: [{ childRowKey: rowKey(943), mode: "multiplier", value: 1 }],
  },
  {
    parentRowKey: rowKey(1150),
    children: [{ childRowKey: rowKey(1151), mode: "multiplier", value: 1 }],
  },
];

export const SYSTEM1_AGGREGATOR_RULES: AggregatorRule[] = [
  {
    childRowKey: rowKey(301),
    triggerRowKeys: [
      rowKey(209), rowKey(212), rowKey(215), rowKey(218), rowKey(221),
      rowKey(226),
      ...range(232, 236),
      ...range(239, 242),
    ],
  },
  {
    childRowKey: rowKey(302),
    triggerRowKeys: [
      rowKey(210), rowKey(216),
      ...range(222, 224),
      ...range(227, 229),
      rowKey(237),
    ],
  },
  {
    childRowKey: rowKey(326),
    triggerRowKeys: range(209, 257),
    exclude: range(329, 334),
  },
  {
    childRowKey: rowKey(648),
    triggerRowKeys: [rowKey(297)],
  },
  {
    childRowKey: rowKey(664),
    triggerRowKeys: [rowKey(297)],
  },
  {
    childRowKey: rowKey(731),
    triggerRowKeys: range(721, 730),
  },
  {
    childRowKey: rowKey(769),
    triggerRowKeys: range(751, 754),
  },
  {
    childRowKey: rowKey(770),
    triggerRowKeys: range(755, 767),
  },
  {
    childRowKey: rowKey(772),
    triggerRowKeys: range(709, 767),
    exclude: [rowKey(731)],
  },
  {
    childRowKey: rowKey(777),
    triggerRowKeys: [rowKey(776), rowKey(780), rowKey(781), rowKey(782), rowKey(784)],
  },
  {
    childRowKey: rowKey(778),
    triggerRowKeys: [rowKey(783)],
  },
  {
    childRowKey: rowKey(779),
    triggerRowKeys: [
      rowKey(776), rowKey(780), rowKey(781), rowKey(782), rowKey(783), rowKey(784),
    ],
  },
  {
    childRowKey: rowKey(785),
    triggerRowKeys: [rowKey(784)],
    exclude: [rowKey(786)],
  },
  {
    childRowKey: rowKey(807),
    triggerRowKeys: [rowKey(783)],
  },
  {
    childRowKey: rowKey(809),
    triggerRowKeys: [rowKey(776), rowKey(780), rowKey(781), rowKey(782), rowKey(784)],
  },
  {
    childRowKey: rowKey(829),
    triggerRowKeys: [rowKey(789)],
  },
  {
    childRowKey: rowKey(833),
    triggerRowKeys: range(828, 831),
  },
  {
    childRowKey: rowKey(844),
    triggerRowKeys: [rowKey(185)],
  },
  {
    childRowKey: rowKey(897),
    triggerRowKeys: range(890, 895),
  },
  {
    childRowKey: rowKey(898),
    triggerRowKeys: combine(range(870, 876), range(890, 895)),
  },
  {
    childRowKey: rowKey(923),
    triggerRowKeys: [rowKey(185)],
  },
  {
    childRowKey: rowKey(937),
    triggerRowKeys: combine(range(878, 884), range(890, 895)),
  },
  {
    childRowKey: rowKey(938),
    triggerRowKeys: combine(range(878, 884), range(890, 895)),
  },
  {
    childRowKey: rowKey(940),
    triggerRowKeys: [rowKey(833)],
  },
  {
    childRowKey: rowKey(947),
    triggerRowKeys: [rowKey(945), rowKey(946)],
  },
  {
    childRowKey: rowKey(962),
    triggerRowKeys: combine(
      range(709, 736),
      range(798, 802),
      range(844, 862),
      [rowKey(900)],
      range(916, 941),
    ),
  },
];

export const SYSTEM1_PUMP_BUNDLE_RULE: PumpBundleRule = {
  parentSyntheticKey: SYNTHETIC_PUMP_BUNDLE_ROW_KEY,
  commonChildren: [
    { childRowKey: rowKey(966), quantity: 1 },
    { childRowKey: rowKey(968), quantity: 1 },
    { childRowKey: rowKey(969), quantity: 1 },
  ],
  sizeChildren: {
    4: [
      { childRowKey: rowKey(341), quantity: 69 },
      { childRowKey: rowKey(472), quantity: 5 },
      { childRowKey: rowKey(491), quantity: 4 },
      { childRowKey: rowKey(501), quantity: 1 },
      { childRowKey: rowKey(519), quantity: 1 },
      { childRowKey: rowKey(558), quantity: 28 },
      { childRowKey: rowKey(566), quantity: 3 },
      { childRowKey: rowKey(589), quantity: 9 },
      { childRowKey: rowKey(596), quantity: 2 },
      { childRowKey: rowKey(665), quantity: 8 },
      { childRowKey: rowKey(767), quantity: 4 },
      { childRowKey: rowKey(775), quantity: 2 },
      { childRowKey: rowKey(787), quantity: 1 },
      { childRowKey: rowKey(901), quantity: 1 },
    ],
    6: [
      { childRowKey: rowKey(341), quantity: 21 },
      { childRowKey: rowKey(342), quantity: 48 },
      { childRowKey: rowKey(464), quantity: 1 },
      { childRowKey: rowKey(472), quantity: 2 },
      { childRowKey: rowKey(473), quantity: 3 },
      { childRowKey: rowKey(492), quantity: 4 },
      { childRowKey: rowKey(503), quantity: 1 },
      { childRowKey: rowKey(519), quantity: 1 },
      { childRowKey: rowKey(558), quantity: 7 },
      { childRowKey: rowKey(560), quantity: 20 },
      { childRowKey: rowKey(568), quantity: 3 },
      { childRowKey: rowKey(590), quantity: 9 },
      { childRowKey: rowKey(597), quantity: 1 },
      { childRowKey: rowKey(604), quantity: 1 },
      { childRowKey: rowKey(665), quantity: 8 },
      { childRowKey: rowKey(768), quantity: 4 },
      { childRowKey: rowKey(776), quantity: 2 },
      { childRowKey: rowKey(788), quantity: 1 },
      { childRowKey: rowKey(901), quantity: 1 },
    ],
    8: [
      { childRowKey: rowKey(341), quantity: 21 },
      { childRowKey: rowKey(343), quantity: 48 },
      { childRowKey: rowKey(465), quantity: 1 },
      { childRowKey: rowKey(472), quantity: 2 },
      { childRowKey: rowKey(474), quantity: 3 },
      { childRowKey: rowKey(493), quantity: 4 },
      { childRowKey: rowKey(504), quantity: 1 },
      { childRowKey: rowKey(519), quantity: 1 },
      { childRowKey: rowKey(558), quantity: 7 },
      { childRowKey: rowKey(561), quantity: 20 },
      { childRowKey: rowKey(569), quantity: 3 },
      { childRowKey: rowKey(591), quantity: 9 },
      { childRowKey: rowKey(597), quantity: 1 },
      { childRowKey: rowKey(605), quantity: 1 },
      { childRowKey: rowKey(666), quantity: 8 },
      { childRowKey: rowKey(769), quantity: 4 },
      { childRowKey: rowKey(777), quantity: 2 },
      { childRowKey: rowKey(789), quantity: 1 },
      { childRowKey: rowKey(901), quantity: 1 },
    ],
    10: [
      { childRowKey: rowKey(344), quantity: 63 },
      { childRowKey: rowKey(439), quantity: 1 },
      { childRowKey: rowKey(442), quantity: 6 },
      { childRowKey: rowKey(472), quantity: 2 },
      { childRowKey: rowKey(475), quantity: 4 },
      { childRowKey: rowKey(494), quantity: 2 },
      { childRowKey: rowKey(505), quantity: 1 },
      { childRowKey: rowKey(519), quantity: 1 },
      { childRowKey: rowKey(558), quantity: 7 },
      { childRowKey: rowKey(562), quantity: 20 },
      { childRowKey: rowKey(592), quantity: 9 },
      { childRowKey: rowKey(599), quantity: 1 },
      { childRowKey: rowKey(606), quantity: 2 },
      { childRowKey: rowKey(667), quantity: 8 },
      { childRowKey: rowKey(790), quantity: 5 },
      { childRowKey: rowKey(806), quantity: 2 },
      { childRowKey: rowKey(901), quantity: 5 },
    ],
  },
};

export type AutoChildIndexEntry = {
  childRowKey: string;
  mode: DirectChildMode;
  value: number;
};

/**
 * Flattens every direct rule and aggregator rule into a parent-keyed lookup
 * so the engine can resolve children with a single map.get(parentRowKey).
 * Aggregators contribute one entry per triggering parent with mode=multiplier,
 * value=1 (one child instance per parent, qty matches parent qty).
 */
export function buildAutoChildRuleIndex(): Map<string, AutoChildIndexEntry[]> {
  const index = new Map<string, AutoChildIndexEntry[]>();

  const push = (parentRowKey: string, entry: AutoChildIndexEntry) => {
    const existing = index.get(parentRowKey);
    if (existing) {
      existing.push(entry);
    } else {
      index.set(parentRowKey, [entry]);
    }
  };

  SYSTEM1_DIRECT_CHILD_RULES.forEach((rule) => {
    rule.children.forEach((spec) => {
      push(rule.parentRowKey, {
        childRowKey: spec.childRowKey,
        mode: spec.mode,
        value: spec.value,
      });
    });
  });

  SYSTEM1_AGGREGATOR_RULES.forEach((rule) => {
    const excluded = new Set(rule.exclude ?? []);
    rule.triggerRowKeys.forEach((triggerRowKey) => {
      if (excluded.has(triggerRowKey)) return;
      push(triggerRowKey, {
        childRowKey: rule.childRowKey,
        mode: "multiplier",
        value: 1,
      });
    });
  });

  return index;
}

let validatedOnce = false;

/**
 * Throws if any rule references a catalog row key that does not exist in the
 * generated row metadata. Idempotent; only runs once per process.
 */
export function validateAutoChildRules(): void {
  if (validatedOnce) return;
  validatedOnce = true;

  const catalogRowKeys = new Set(
    buildMaterialCatalogRowMetadata().map((row) => row.rowKey),
  );
  // Synthetic Pump Bundle row is registered by the template itself, but allow
  // it explicitly in case validation runs before that registration completes.
  catalogRowKeys.add(SYNTHETIC_PUMP_BUNDLE_ROW_KEY);

  const missing: string[] = [];
  const check = (key: string, source: string) => {
    if (!catalogRowKeys.has(key)) {
      missing.push(`${source}: ${key}`);
    }
  };

  SYSTEM1_DIRECT_CHILD_RULES.forEach((rule) => {
    check(rule.parentRowKey, "direct parent");
    rule.children.forEach((child) => check(child.childRowKey, "direct child"));
  });
  SYSTEM1_AGGREGATOR_RULES.forEach((rule) => {
    check(rule.childRowKey, "aggregator child");
    // Trigger rows may legitimately be missing from the catalog (the user's
    // mapping is range-based and some Excel rows are blank separators). Those
    // triggers can never fire, so don't fail validation on them.
  });
  SYSTEM1_PUMP_BUNDLE_RULE.commonChildren.forEach((entry) =>
    check(entry.childRowKey, "pump bundle common"),
  );
  ([4, 6, 8, 10] as EstimatePumpBundleSize[]).forEach((size) => {
    SYSTEM1_PUMP_BUNDLE_RULE.sizeChildren[size].forEach((entry) =>
      check(entry.childRowKey, `pump bundle size ${size}`),
    );
  });

  if (missing.length > 0) {
    throw new Error(
      `system1AutoChildRules: rule references unknown catalog rows -> ${missing.join(", ")}`,
    );
  }
}
