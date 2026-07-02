"use client";

import type { EstimateSummarySection as EstimateSummaryNumbers } from "@/lib/estimateTypes";
import { estimateBentoTile, estimateBentoValue, estimateProgressTrack } from "@/lib/estimate/estimateUi";

type Props = {
  summary: EstimateSummaryNumbers;
};

function formatCurrency(value: number | null) {
  if (value === null || Number.isNaN(value)) return "-";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pctOfTotal(amount: number, total: number): number {
  if (!total || Number.isNaN(total)) return 0;
  return Math.min(100, Math.max(0, (amount / total) * 100));
}

type TileDef = {
  key: string;
  label: string;
  amount: number;
  helper: string;
  accent: string;
  borderAccent: string;
  barClass: string;
};

function BentoTile({
  label,
  amount,
  helper,
  totalCost,
  accent,
  borderAccent,
  barClass,
}: Omit<TileDef, "key"> & { totalCost: number }) {
  const pct = pctOfTotal(amount, totalCost);
  const pctLabel =
    totalCost > 0
      ? `${pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}% of total`
      : "-";

  return (
    <article
      className={`${estimateBentoTile} ${borderAccent} ${accent}`}
    >
      <div className="relative flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
            {label}
          </h4>
          <span className="shrink-0 text-[10px] text-slate-500">{helper}</span>
        </div>
        <p className={estimateBentoValue}>
          {formatCurrency(amount)}
        </p>
        <p className="text-[11px] font-medium text-slate-500">{pctLabel}</p>
        <div className={`h-1 w-full ${estimateProgressTrack}`}>
          <div
            className={`h-full rounded-full transition-all duration-500 ${barClass}`}
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>
      </div>
    </article>
  );
}

export default function EstimateSummaryBento({ summary }: Props) {
  const total = summary.totalCost;
  const tiles: TileDef[] = [
    {
      key: "material",
      label: "Total material",
      amount: summary.totalMaterialCost,
      helper: "after tax",
      accent: "ring-1 ring-blue-500/20",
      borderAccent: "border-blue-500/25",
      barClass: "bg-gradient-to-r from-blue-500/90 to-sky-400/90",
    },
    {
      key: "base",
      label: "Material base",
      amount: summary.materialSubtotal,
      helper: "before tax",
      accent: "ring-1 ring-emerald-500/20",
      borderAccent: "border-emerald-500/25",
      barClass: "bg-gradient-to-r from-emerald-500/90 to-teal-400/90",
    },
    {
      key: "tax",
      label: "Sales tax",
      amount: summary.salesTaxCost,
      helper: "estimate",
      accent: "ring-1 ring-amber-500/20",
      borderAccent: "border-amber-500/25",
      barClass: "bg-gradient-to-r from-amber-500/90 to-orange-400/90",
    },
    {
      key: "inflation",
      label: "Inflation",
      amount: summary.materialInflationCost,
      helper: "estimate",
      accent: "ring-1 ring-violet-500/20",
      borderAccent: "border-violet-500/25",
      barClass: "bg-gradient-to-r from-violet-500/90 to-fuchsia-400/90",
    },
    {
      key: "overhead",
      label: "Overhead",
      amount: summary.overheadCost,
      helper: "estimate",
      accent: "ring-1 ring-slate-400/20",
      borderAccent: "border-slate-500/30",
      barClass: "bg-gradient-to-r from-slate-400/90 to-slate-500/90",
    },
    {
      key: "fees",
      label: "Fees",
      amount: summary.fees,
      helper: "fixed",
      accent: "ring-1 ring-cyan-500/20",
      borderAccent: "border-cyan-500/25",
      barClass: "bg-gradient-to-r from-cyan-500/90 to-cyan-400/80",
    },
    {
      key: "profit",
      label: "Profit",
      amount: summary.profitCost,
      helper: "estimate",
      accent: "ring-1 ring-rose-500/20",
      borderAccent: "border-rose-500/25",
      barClass: "bg-gradient-to-r from-rose-500/90 to-pink-400/90",
    },
  ];

  const byKey = Object.fromEntries(tiles.map((tile) => [tile.key, tile])) as Record<
    string,
    TileDef
  >;

  return (
    <div className="relative">
      <div className="relative grid grid-cols-2 gap-3 lg:grid-cols-4 lg:grid-rows-3">
        <div className="col-span-2 lg:col-span-2 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div
            className="relative flex h-full min-h-[140px] flex-col justify-center overflow-hidden rounded-2xl border border-fuchsia-500/35 bg-gradient-to-br from-fuchsia-50 to-white p-6 dark:bg-slate-900/90 dark:backdrop-blur-md"
            role="region"
            aria-label={`Total cost ${formatCurrency(total)}`}
          >
            <div className="relative flex flex-col items-center text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-700 dark:text-fuchsia-200/80">
                Total cost
              </p>
              <p className="mt-2 font-mono text-3xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-4xl dark:text-white">
                {formatCurrency(total)}
              </p>
              <p className="mt-2 text-[10px] text-slate-500">final estimate</p>
            </div>
          </div>
        </div>

        <div className="lg:col-start-1 lg:row-start-1">
          <BentoTile {...byKey.material} totalCost={total} />
        </div>
        <div className="lg:col-start-4 lg:row-start-1">
          <BentoTile {...byKey.base} totalCost={total} />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <BentoTile {...byKey.tax} totalCost={total} />
        </div>
        <div className="lg:col-start-4 lg:row-start-2">
          <BentoTile {...byKey.inflation} totalCost={total} />
        </div>
        <div className="lg:col-start-1 lg:row-start-3">
          <BentoTile {...byKey.overhead} totalCost={total} />
        </div>
        <div className="lg:col-start-2 lg:row-start-3">
          <BentoTile {...byKey.fees} totalCost={total} />
        </div>
        <div className="col-span-2 lg:col-span-2 lg:col-start-3 lg:row-start-3">
          <BentoTile {...byKey.profit} totalCost={total} />
        </div>
      </div>
    </div>
  );
}
