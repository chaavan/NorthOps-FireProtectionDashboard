"use client";

import type { EstimateComputed } from "@/lib/estimateTypes";
import EstimateSectionCard from "@/components/estimate/EstimateSectionCard";
import {
  estimateBodyText,
  estimateFinalTotalBadge,
  estimateFinalTotalLabel,
  estimateHeroLabel,
  estimateHeroPanel,
  estimateHeroSubvalue,
  estimateMetricCard,
  estimatePanel,
  estimatePanelTitle,
  estimateProgressTrack,
  estimateStatusPass,
  estimateStatusWarn,
  estimateTile,
  estimateTileValue,
  estimateValueHero,
  estimateValueLg,
  estimateValueMd,
  estimateWaterfallTrack,
} from "@/lib/estimate/estimateUi";

type Props = {
  computed: EstimateComputed;
};

type CostItem = {
  key: string;
  label: string;
  amount: number;
  helper?: string;
  tone: string;
  bar: string;
};

type MetricItem = {
  label: string;
  value: string;
  helper: string;
};

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function pctOfTotal(amount: number, total: number) {
  if (!total || Number.isNaN(total)) return 0;
  return Math.min(100, Math.max(0, (amount / total) * 100));
}

function HealthTile({
  label,
  value,
  helper,
  accent,
}: {
  label: string;
  value: string;
  helper: string;
  accent: string;
}) {
  return (
    <div className={`${estimateTile} ${accent}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className={estimateTileValue}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function CostCard({ item, total }: { item: CostItem; total: number }) {
  const pct = pctOfTotal(item.amount, total);
  return (
    <article className={`${estimateTile} p-4 ${item.tone}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            {item.label}
          </div>
          {item.helper ? <div className="mt-1 text-xs text-slate-500">{item.helper}</div> : null}
        </div>
        <div className="shrink-0 text-xs font-semibold text-slate-400">
          {pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%
        </div>
      </div>
      <div className={`mt-3 ${estimateValueLg}`}>
        {formatCurrency(item.amount)}
      </div>
      <div className={`mt-3 ${estimateProgressTrack}`}>
        <div className={`h-full rounded-full ${item.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </article>
  );
}

function Waterfall({ items, total }: { items: CostItem[]; total: number }) {
  return (
    <div className={estimatePanel}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className={estimatePanelTitle}>Cost Waterfall</h3>
          <p className="mt-1 text-sm text-slate-500">
            How each estimate bucket builds into the final bid.
          </p>
        </div>
        <div className={estimateFinalTotalBadge}>
          <div className={estimateFinalTotalLabel}>
            Final Total
          </div>
          <div className={estimateValueMd}>{formatCurrency(total)}</div>
        </div>
      </div>
      <div className="space-y-3">
        {items.map((item) => {
          const pct = pctOfTotal(item.amount, total);
          return (
            <div key={item.key} className="grid gap-2 lg:grid-cols-[11rem_minmax(0,1fr)_8rem] lg:items-center">
              <div className="min-w-0">
                <div className={estimateBodyText}>{item.label}</div>
                {item.helper ? <div className="text-xs text-slate-500">{item.helper}</div> : null}
              </div>
              <div className={estimateWaterfallTrack}>
                <div
                  className={`flex h-full min-w-10 items-center justify-end rounded-lg pr-2 text-xs font-bold text-slate-900 dark:text-white ${item.bar}`}
                  style={{ width: `${Math.max(2, pct)}%` }}
                >
                  {pct.toLocaleString(undefined, { maximumFractionDigits: 0 })}%
                </div>
              </div>
              <div className={`${estimateValueMd} lg:text-right`}>
                {formatCurrency(item.amount)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ metric }: { metric: MetricItem }) {
  return (
    <div className={estimateMetricCard}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {metric.label}
      </div>
      <div className={estimateTileValue}>{metric.value}</div>
      <div className="mt-1 text-xs text-slate-500">{metric.helper}</div>
    </div>
  );
}

export default function EstimateSummarySection({ computed }: Props) {
  const { summary, parity } = computed;
  const inputs = computed.draft.inputs;
  const missingPriceCount = computed.visibleMaterialLines.filter(
    (line) => line.priceSource === "missing",
  ).length;
  const manualPriceCount = computed.visibleMaterialLines.filter(
    (line) => line.priceSource === "manual",
  ).length;
  const materialLineCount = computed.visibleMaterialLines.length;

  const costItems: CostItem[] = [
    {
      key: "material",
      label: "Total Material",
      amount: summary.totalMaterialCost,
      helper: `${formatPercent(inputs.salesTaxPercent)} tax, ${formatPercent(inputs.materialInflationPercent)} inflation`,
      tone: "border-blue-500/25",
      bar: "bg-gradient-to-r from-blue-600 to-sky-400",
    },
    {
      key: "field",
      label: "Field",
      amount: summary.totalFieldCost,
      helper: `${formatNumber(summary.totalFieldHours, 1)} hrs`,
      tone: "border-emerald-500/25",
      bar: "bg-gradient-to-r from-emerald-600 to-teal-400",
    },
    {
      key: "shop",
      label: "Shop",
      amount: summary.totalShopCost,
      helper: `${formatNumber(summary.totalShopHours, 1)} hrs`,
      tone: "border-cyan-500/25",
      bar: "bg-gradient-to-r from-cyan-600 to-cyan-300",
    },
    {
      key: "design",
      label: "Design",
      amount: summary.totalDesignCost,
      helper: `${formatNumber(summary.totalDesignHours, 1)} hrs`,
      tone: "border-violet-500/25",
      bar: "bg-gradient-to-r from-violet-600 to-fuchsia-400",
    },
    {
      key: "subs",
      label: "Subs & Misc",
      amount: summary.subsTotal,
      helper: `${formatPercent(inputs.subsMarkupPercent)} markup`,
      tone: "border-amber-500/25",
      bar: "bg-gradient-to-r from-amber-600 to-orange-400",
    },
    {
      key: "overhead",
      label: "Overhead",
      amount: summary.overheadCost,
      helper: formatPercent(inputs.overheadPercent),
      tone: "border-slate-500/35",
      bar: "bg-gradient-to-r from-slate-500 to-slate-300",
    },
    {
      key: "profit",
      label: "Profit",
      amount: summary.profitCost,
      helper: formatPercent(inputs.profitPercent),
      tone: "border-rose-500/25",
      bar: "bg-gradient-to-r from-rose-600 to-pink-400",
    },
    {
      key: "fees",
      label: "Fees / PE / Bond",
      amount: summary.feesTotal,
      helper: "calculated adders",
      tone: "border-lime-500/25",
      bar: "bg-gradient-to-r from-lime-600 to-green-400",
    },
  ];

  const detailedCostItems: CostItem[] = [
    {
      key: "material-base",
      label: "Material Base",
      amount: summary.materialSubtotal,
      helper: "catalog + custom before tax",
      tone: "border-sky-500/25",
      bar: "bg-gradient-to-r from-sky-600 to-blue-400",
    },
    {
      key: "sales-tax",
      label: "Sales Tax",
      amount: summary.salesTaxCost,
      helper: formatPercent(inputs.salesTaxPercent),
      tone: "border-amber-500/25",
      bar: "bg-gradient-to-r from-amber-600 to-yellow-400",
    },
    {
      key: "inflation",
      label: "Inflation",
      amount: summary.materialInflationCost,
      helper: formatPercent(inputs.materialInflationPercent),
      tone: "border-indigo-500/25",
      bar: "bg-gradient-to-r from-indigo-600 to-violet-400",
    },
    {
      key: "total-material",
      label: "Total Material",
      amount: summary.totalMaterialCost,
      helper: "material after tax + inflation",
      tone: "border-blue-500/30",
      bar: "bg-gradient-to-r from-blue-600 to-cyan-400",
    },
    {
      key: "field",
      label: "Field Labor",
      amount: summary.totalFieldCost,
      helper: `${formatNumber(summary.totalFieldHours, 1)} hrs`,
      tone: "border-emerald-500/25",
      bar: "bg-gradient-to-r from-emerald-600 to-teal-400",
    },
    {
      key: "shop",
      label: "Shop Labor",
      amount: summary.totalShopCost,
      helper: `${formatNumber(summary.totalShopHours, 1)} hrs`,
      tone: "border-cyan-500/25",
      bar: "bg-gradient-to-r from-cyan-600 to-cyan-300",
    },
    {
      key: "design",
      label: "Design Labor",
      amount: summary.totalDesignCost,
      helper: `${formatNumber(summary.totalDesignHours, 1)} hrs`,
      tone: "border-violet-500/25",
      bar: "bg-gradient-to-r from-violet-600 to-fuchsia-400",
    },
    {
      key: "subs",
      label: "Subs & Misc",
      amount: summary.subsTotal,
      helper: `${formatPercent(inputs.subsMarkupPercent)} markup`,
      tone: "border-orange-500/25",
      bar: "bg-gradient-to-r from-orange-600 to-amber-400",
    },
    {
      key: "fees",
      label: "Fees",
      amount: summary.fees,
      helper: "automatic fee table",
      tone: "border-lime-500/25",
      bar: "bg-gradient-to-r from-lime-600 to-green-400",
    },
    {
      key: "pe-bond",
      label: "PE / Bond",
      amount: summary.peStamp + summary.bondCost,
      helper: "pricing adders",
      tone: "border-teal-500/25",
      bar: "bg-gradient-to-r from-teal-600 to-emerald-400",
    },
    {
      key: "overhead",
      label: "Overhead",
      amount: summary.overheadCost,
      helper: formatPercent(inputs.overheadPercent),
      tone: "border-slate-500/35",
      bar: "bg-gradient-to-r from-slate-500 to-slate-300",
    },
    {
      key: "profit",
      label: "Profit",
      amount: summary.profitCost,
      helper: formatPercent(inputs.profitPercent),
      tone: "border-rose-500/25",
      bar: "bg-gradient-to-r from-rose-600 to-pink-400",
    },
  ];

  const productivityMetrics: MetricItem[] = [
    { label: "Sprinklers", value: formatNumber(summary.totalSprinklers, 0), helper: "total heads" },
    { label: "Total / Head", value: formatCurrency(summary.totalCostPerHead), helper: "final bid per sprinkler" },
    { label: "Material / Head", value: formatCurrency(summary.materialCostPerHead), helper: "material cost per sprinkler" },
    { label: "Hours / Head", value: formatNumber(summary.hoursPerHead, 2), helper: "labor hours per sprinkler" },
    { label: "Cost / Sq Ft", value: formatCurrency(summary.totalCostPerSquareFoot), helper: "uses project square footage" },
    { label: "Labor Hours", value: formatNumber(summary.grandTotalLaborHours, 1), helper: "field + shop + design" },
    { label: "Travel Zone", value: formatNumber(summary.travelZone, 0), helper: "derived from miles to job" },
    { label: "Material Lines", value: formatNumber(materialLineCount, 0), helper: "selected catalog/custom lines" },
  ];

  return (
    <EstimateSectionCard
      title="Estimate Summary"
      description="Cost story, pricing health, labor productivity, and final bid composition."
      rightSlot={
        <div
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            parity.status === "pass" ? estimateStatusPass : estimateStatusWarn
          }`}
        >
          {parity.status === "pass" ? "Ready for PDF" : "Missing Prices"}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <HealthTile
            label="PDF Status"
            value={parity.status === "pass" ? "Ready" : "Blocked"}
            helper={parity.status === "pass" ? "no blocking price issues" : "resolve missing prices"}
            accent={
              parity.status === "pass"
                ? "border-emerald-500/35 text-emerald-200"
                : "border-amber-500/35 text-amber-200"
            }
          />
          <HealthTile
            label="Missing Prices"
            value={formatNumber(missingPriceCount, 0)}
            helper="must be resolved before PDF"
            accent={missingPriceCount > 0 ? "border-amber-500/35" : "border-slate-700/70"}
          />
          <HealthTile
            label="Manual Prices"
            value={formatNumber(manualPriceCount, 0)}
            helper="estimate-specific pricing"
            accent="border-blue-500/25"
          />
          <HealthTile
            label="Material Lines"
            value={formatNumber(materialLineCount, 0)}
            helper="priced and selected lines"
            accent="border-slate-700/70"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.3fr]">
          <section className={estimateHeroPanel}>
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/80 to-transparent" />
            <div className={estimateHeroLabel}>
              Final Bid
            </div>
            <div className={`mt-4 ${estimateValueHero}`}>
              {formatCurrency(summary.totalCost)}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs text-slate-500">Subtotal</div>
                <div className={estimateHeroSubvalue}>{formatCurrency(summary.subtotal)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">With Overhead</div>
                <div className={estimateHeroSubvalue}>{formatCurrency(summary.subtotalWithOverhead)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">With Profit</div>
                <div className={estimateHeroSubvalue}>{formatCurrency(summary.subtotalWithProfit)}</div>
              </div>
            </div>
          </section>

          <Waterfall items={costItems} total={summary.totalCost} />
        </div>

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className={estimatePanelTitle}>Cost Composition</h3>
              <p className="mt-1 text-sm text-slate-500">
                Each card shows dollars, rate context, and share of final total.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {detailedCostItems.map((item) => (
              <CostCard key={item.key} item={item} total={summary.totalCost} />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3">
            <h3 className={estimatePanelTitle}>Productivity & Ratios</h3>
            <p className="mt-1 text-sm text-slate-500">
              The estimate translated into production, labor, and unit-cost signals.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {productivityMetrics.map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </div>
        </section>
      </div>
    </EstimateSectionCard>
  );
}
