"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  CRM_OPPORTUNITY_STAGES,
  crmStageLabel,
  type CrmOpportunityRecord,
  type CrmOpportunityStage,
} from "@/lib/crm/crmTypes";

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function OpportunityCard({ opp, disabled }: { opp: CrmOpportunityRecord; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opp.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800 ${
        disabled ? "" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <div className="font-medium text-slate-800 dark:text-slate-100">{opp.title}</div>
      <div className="mt-1 text-xs text-slate-500">{opp.account.name}</div>
      <div className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{formatCurrency(opp.value)}</div>
    </div>
  );
}

function StageColumn({
  stage,
  opps,
  disabled,
}: {
  stage: CrmOpportunityStage;
  opps: CrmOpportunityRecord[];
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = opps.reduce((sum, opp) => sum + (opp.value ?? 0), 0);
  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 ${
        isOver
          ? "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-500/10"
          : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40"
      }`}
    >
      <div className="mb-2 px-1">
        <div className="text-xs font-semibold uppercase text-slate-500">{crmStageLabel(stage)}</div>
        <div className="text-xs text-slate-400">
          {opps.length} · {formatCurrency(total)}
        </div>
      </div>
      <div className="flex min-h-[60px] flex-col gap-2">
        {opps.map((opp) => (
          <OpportunityCard key={opp.id} opp={opp} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

export default function CrmPipelineBoard({
  opportunities,
  canEdit,
  onStageChange,
}: {
  opportunities: CrmOpportunityRecord[];
  canEdit: boolean;
  onStageChange: (opportunityId: string, stage: CrmOpportunityStage) => Promise<void>;
}) {
  // Local mirror so a drop reflects instantly (optimistic) before the parent refetches.
  const [items, setItems] = useState<CrmOpportunityRecord[]>(opportunities);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(opportunities);
  }, [opportunities]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byStage = useMemo(() => {
    const map = new Map<CrmOpportunityStage, CrmOpportunityRecord[]>();
    for (const stage of CRM_OPPORTUNITY_STAGES) map.set(stage, []);
    for (const opp of items) {
      const list = map.get(opp.stage);
      if (list) list.push(opp);
    }
    return map;
  }, [items]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const opportunityId = String(event.active.id);
    const overStage = event.over ? (String(event.over.id) as CrmOpportunityStage) : null;
    if (!overStage || !CRM_OPPORTUNITY_STAGES.includes(overStage)) return;
    const opp = items.find((item) => item.id === opportunityId);
    if (!opp || opp.stage === overStage) return;

    const previous = items;
    setItems((current) =>
      current.map((item) => (item.id === opportunityId ? { ...item, stage: overStage } : item)),
    );
    setError(null);
    try {
      await onStageChange(opportunityId, overStage);
    } catch (moveError) {
      setItems(previous); // roll back on failure
      setError((moveError as Error).message);
    }
  };

  return (
    <div>
      {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {CRM_OPPORTUNITY_STAGES.map((stage) => (
            <StageColumn key={stage} stage={stage} opps={byStage.get(stage) ?? []} disabled={!canEdit} />
          ))}
        </div>
      </DndContext>
      {!canEdit ? (
        <p className="mt-2 text-xs text-slate-400">You have view-only access; drag-and-drop is disabled.</p>
      ) : null}
    </div>
  );
}
