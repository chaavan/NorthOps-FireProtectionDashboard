"use client";

import { useCallback, useEffect, useState } from "react";
import type { CrmEntityType, CrmTagRecord } from "@/lib/crm/crmTypes";

export default function CrmTagEditor({
  entityType,
  entityId,
  canEdit,
}: {
  entityType: CrmEntityType;
  entityId: string;
  canEdit: boolean;
}) {
  const [tags, setTags] = useState<CrmTagRecord[]>([]);
  const [allTags, setAllTags] = useState<CrmTagRecord[]>([]);
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ entityType, entityId });
      const [entityRes, allRes] = await Promise.all([
        fetch(`/api/crm/entity-tags?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/crm/tags", { cache: "no-store" }),
      ]);
      const entityPayload = await entityRes.json();
      const allPayload = await allRes.json();
      if (!entityRes.ok) throw new Error(entityPayload.error || "Failed to load tags");
      setTags(entityPayload.tags || []);
      if (allRes.ok) setAllTags(allPayload.tags || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addTag = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    try {
      // Reuse an existing tag by name if present, otherwise create it.
      let tag = allTags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
      if (!tag) {
        const createRes = await fetch("/api/crm/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        const createPayload = await createRes.json();
        if (!createRes.ok) throw new Error(createPayload.error || "Failed to create tag");
        tag = createPayload.tag;
      }
      const assignRes = await fetch("/api/crm/entity-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId: tag!.id, entityType, entityId }),
      });
      if (!assignRes.ok) {
        const assignPayload = await assignRes.json();
        throw new Error(assignPayload.error || "Failed to add tag");
      }
      setNewTag("");
      await load();
    } catch (addError) {
      setError((addError as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const removeTag = async (tagId: string) => {
    setError(null);
    try {
      const params = new URLSearchParams({ tagId, entityType, entityId });
      const res = await fetch(`/api/crm/entity-tags?${params.toString()}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || "Failed to remove tag");
      }
      await load();
    } catch (removeError) {
      setError((removeError as Error).message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: tag.color }}
        >
          {tag.name}
          {canEdit ? (
            <button type="button" onClick={() => void removeTag(tag.id)} className="ml-0.5 opacity-80 hover:opacity-100">
              ×
            </button>
          ) : null}
        </span>
      ))}
      {canEdit ? (
        <input
          list="crm-tag-options"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addTag(newTag);
          }}
          placeholder="+ tag"
          disabled={adding}
          className="w-24 rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
      ) : null}
      <datalist id="crm-tag-options">
        {allTags.map((tag) => (
          <option key={tag.id} value={tag.name} />
        ))}
      </datalist>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}
