"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/hooks/useAuth";
import type { JobLineItem, JobMetadata } from "@/lib/types";
import type { BackordersOtherVendor, DeliveryRecord } from "@/lib/deliveryTypes";
import { formatDateInAppTimeZone, toDateKeyInAppTimeZone } from "@/lib/timezone";
import { getRemainingQty } from "@/lib/quantityMath";

const TEST_GAUGE_VENDOR_NAME = "TEST GAUGE";

function isLineItemDelivered(
  delivered: JobLineItem["delivered"] | boolean | null | undefined,
): boolean {
  if (delivered === true) return true;
  if (typeof delivered === "string" && delivered.trim().toLowerCase() === "yes") {
    return true;
  }
  return false;
}

function formDataToDeliveryPayload(form: {
  fabPipe: boolean;
  loosePipe: boolean;
  thdFittings: boolean;
  grvdFittings: boolean;
  nipples: boolean;
  valves: boolean;
  heads: boolean;
  hangers: boolean;
  rodStrut: boolean;
  flexDrops: boolean;
  cpvcPipe: boolean;
  cpvcFittings: boolean;
  quickDrops: boolean;
  pipeStand: boolean;
  compressor: boolean;
  backflow: boolean;
  signs: boolean;
  other: boolean;
  locations: any[];
  pickupGalloup: boolean;
  pickupEtna: boolean;
  pickupViking: boolean;
  pickupOther: string;
  deliveryGalloup: boolean;
  deliveryEtna: boolean;
  deliveryViking: boolean;
  deliveryOther: string;
  fitterPickingUpMaterial: boolean;
  picker: string;
  pickerDate: string;
  receiver: string;
  receiverDate: string;
  additionalReceiverDates: string[];
  loaderDriver: string;
  fitter: string;
  notes: string;
  backordersEtnaOrdered: boolean;
  backordersGalloupOrdered: boolean;
  backordersVikingOrdered: boolean;
  backordersCoreMainOrdered: boolean;
  backordersOtherOrdered: boolean;
  backordersEtnaPartial: boolean;
  backordersGalloupPartial: boolean;
  backordersVikingPartial: boolean;
  backordersCoreMainPartial: boolean;
  backordersOtherPartial: boolean;
  backordersEtnaReceived: boolean;
  backordersGalloupReceived: boolean;
  backordersVikingReceived: boolean;
  backordersCoreMainReceived: boolean;
  backordersOtherReceived: boolean;
  backordersOtherName: string;
  backordersOtherVendors: BackordersOtherVendor[];
  fromShopComplete: boolean;
  fromShopStillNeed: boolean;
  fromShopNa: boolean;
  fromSuppliersComplete: boolean;
  fromSuppliersStillNeed: boolean;
  fromSuppliersNa: boolean;
  date: string;
}): Partial<DeliveryRecord> & { locations: any[] } {
  const normalizedOtherVendors = form.backordersOtherVendors
    .map((vendor) => ({
      name: vendor.name.trim(),
      ordered: vendor.ordered,
      partial: vendor.partial,
      received: vendor.received,
    }))
    .filter(
      (vendor) =>
        vendor.name !== "" || vendor.ordered || vendor.partial || vendor.received,
    );

  return {
    fabPipes: form.fabPipe,
    loosePipes: form.loosePipe,
    thdFittings: form.thdFittings,
    grvdFittings: form.grvdFittings,
    nipples: form.nipples,
    valves: form.valves,
    heads: form.heads,
    hangers: form.hangers,
    rodStrut: form.rodStrut,
    flexDrops: form.flexDrops,
    cpvcPipes: form.cpvcPipe,
    cpvcFittings: form.cpvcFittings,
    quickDrops: form.quickDrops,
    pipeStand: form.pipeStand,
    compressor: form.compressor,
    backflow: form.backflow,
    signs: form.signs,
    other: form.other,

    locations: form.locations.map((loc: any, index: number) => ({
      locationType: loc.locationType || null,
      row: loc.row || null,
      column: loc.column || null,
      order: index,
    })),

    pickupGalloup: form.pickupGalloup,
    pickupEtna: form.pickupEtna,
    pickupViking: form.pickupViking,
    pickupOther: form.pickupOther || null,

    deliveryGalloup: form.deliveryGalloup,
    deliveryEtna: form.deliveryEtna,
    deliveryViking: form.deliveryViking,
    deliveryOther: form.deliveryOther || null,

    fitterPickingUpMaterial: form.fitterPickingUpMaterial,
    picker: form.picker || null,
    pickerDate: form.pickerDate || null,
    receiver: form.receiver || null,
    receiverDate: form.receiverDate || null,
    additionalReceiverDates: form.additionalReceiverDates.filter(
      (d) => d && d.trim() !== "",
    ),
    loaderDriver: form.loaderDriver || null,
    fitter: form.fitter || null,
    notes: form.notes || null,

    backordersEtnaOrdered: form.backordersEtnaOrdered,
    backordersGalloupOrdered: form.backordersGalloupOrdered,
    backordersVikingOrdered: form.backordersVikingOrdered,
    backordersCoreMainOrdered: form.backordersCoreMainOrdered,
    backordersOtherOrdered: normalizedOtherVendors.some((v) => v.ordered),
    backordersEtnaPartial: form.backordersEtnaPartial,
    backordersGalloupPartial: form.backordersGalloupPartial,
    backordersVikingPartial: form.backordersVikingPartial,
    backordersCoreMainPartial: form.backordersCoreMainPartial,
    backordersOtherPartial: normalizedOtherVendors.some((v) => v.partial),
    backordersEtnaReceived: form.backordersEtnaReceived,
    backordersGalloupReceived: form.backordersGalloupReceived,
    backordersVikingReceived: form.backordersVikingReceived,
    backordersCoreMainReceived: form.backordersCoreMainReceived,
    backordersOtherReceived: normalizedOtherVendors.some((v) => v.received),
    backordersOtherName:
      normalizedOtherVendors.map((v) => v.name).filter(Boolean).join(", ") || null,
    backordersOtherVendors: normalizedOtherVendors,

    fromShopComplete: form.fromShopComplete,
    fromShopStillNeed: form.fromShopStillNeed,
    fromShopNa: form.fromShopNa,
    fromSuppliersComplete: form.fromSuppliersComplete,
    fromSuppliersStillNeed: form.fromSuppliersStillNeed,
    fromSuppliersNa: form.fromSuppliersNa,

    date: form.date || null,
  };
}

interface DeliveryTabProps {
  jobNumber: string;
  jobName: string;
  lineItems: JobLineItem[];
  jobMeta?: JobMetadata | null;
  listNumber?: string | null;
  listNumberContext?: string | null;
  isSaving: boolean;
  /** Can the user edit delivery details on this job (job.delivery.edit). */
  canEditOverride?: boolean;
  /** Can the user mark this job/list delivered (job.delivery.mark_delivered). */
  canMarkDeliveredOverride?: boolean;
  /** Can the user confirm supplier pickup (job.delivery.mark_pickup). */
  canMarkPickupOverride?: boolean;
  /** Can the user record partial delivery (job.delivery.partial_delivery). */
  canPartialDeliveryOverride?: boolean;
  /** Can the user see the "Edit Job" button (jobs.edit_metadata). */
  canShowEditJobButtonOverride?: boolean;
  onEditJob?: () => void;
  onUnsavedChangesChange?: (hasChanges: boolean) => void;
  registerSaveHandler?: (
    handler: ((opts?: { silent?: boolean }) => Promise<boolean>) | null,
  ) => void;
  /** Called after pickup-from-supplier is confirmed so the parent can refresh line items */
  onPickupConfirmed?: () => void | Promise<void>;
}

export default function DeliveryTab({
  jobNumber,
  jobName,
  lineItems,
  jobMeta = null,
  listNumber,
  listNumberContext,
  isSaving: parentIsSaving,
  canEditOverride,
  canMarkDeliveredOverride,
  canMarkPickupOverride,
  canPartialDeliveryOverride,
  canShowEditJobButtonOverride,
  onEditJob,
  onUnsavedChangesChange,
  registerSaveHandler,
  onPickupConfirmed,
}: DeliveryTabProps) {
  // Get the first line item for job-level details (area, address, etc.)
  const jobDetails = lineItems[0] || {};
  const jobInfo = {
    listNumber: jobDetails.listNumber ?? jobMeta?.listNumber ?? null,
    area: jobDetails.area ?? jobMeta?.area ?? null,
    location:
      jobDetails.location ?? jobMeta?.locationShipTo ?? null,
    contractNumber: jobDetails.contractNumber ?? null,
  };

  const { isPrivileged } = useAuth();
  const canEdit = isPrivileged || canEditOverride === true;
  const canMarkDelivered = isPrivileged || canMarkDeliveredOverride === true;
  const canMarkPickup = isPrivileged || canMarkPickupOverride === true;
  const canPartialDelivery = isPrivileged || canPartialDeliveryOverride === true;
  const canShowDeliveryActions =
    canEdit || canMarkDelivered || canMarkPickup || canPartialDelivery;
  const canShowEditJobButton = isPrivileged || canShowEditJobButtonOverride === true;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Local state for the delivery form
  const [formData, setFormData] = useState({
    // Parts checkboxes
    fabPipe: false,
    loosePipe: false,
    thdFittings: false,
    grvdFittings: false,
    nipples: false,
    valves: false,
    heads: false,
    hangers: false,
    rodStrut: false,
    flexDrops: false,
    cpvcPipe: false,
    cpvcFittings: false,
    quickDrops: false,
    pipeStand: false,
    compressor: false,
    backflow: false,
    signs: false,
    other: false,

    // Multiple locations
    locations: [] as any[],

    // Large parts location
    largePartsBackflow: false,
    largePartsOther: "",

    // Pickup locations
    pickupGalloup: false,
    pickupEtna: false,
    pickupViking: false,
    pickupOther: "",

    // Delivery locations
    deliveryGalloup: false,
    deliveryEtna: false,
    deliveryViking: false,
    deliveryOther: "",

    // Personnel
    fitterPickingUpMaterial: false,
    picker: "",
    pickerDate: "",
    receiver: "",
    receiverDate: "",
    additionalReceiverDates: [] as string[],
    loaderDriver: "",
    fitter: "",
    notes: "",

    // Backorders
    backordersEtnaOrdered: false,
    backordersGalloupOrdered: false,
    backordersVikingOrdered: false,
    backordersCoreMainOrdered: false,
    backordersOtherOrdered: false,
    backordersEtnaPartial: false,
    backordersGalloupPartial: false,
    backordersVikingPartial: false,
    backordersCoreMainPartial: false,
    backordersOtherPartial: false,
    backordersEtnaReceived: false,
    backordersGalloupReceived: false,
    backordersVikingReceived: false,
    backordersCoreMainReceived: false,
    backordersOtherReceived: false,
    backordersOtherName: "",
    backordersOtherVendors: [
      { name: "", ordered: false, partial: false, received: false },
    ] as BackordersOtherVendor[],

    // Material tracking
    fromShopComplete: false,
    fromShopStillNeed: false,
    fromShopNa: false,
    fromSuppliersComplete: false,
    fromSuppliersStillNeed: false,
    fromSuppliersNa: false,

    date: toDateKeyInAppTimeZone(new Date()),
  });

  const [hasChanges, setHasChanges] = useState(false);
  const [initialData, setInitialData] = useState<typeof formData | null>(null);
  const [deliveryRecord, setDeliveryRecord] = useState<DeliveryRecord | null>(
    null,
  );
  const [expandedLocations, setExpandedLocations] = useState<Set<number>>(
    new Set(),
  );
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  // Set up portal for header actions
  useEffect(() => {
    setPortalNode(document.getElementById("tab-actions-portal"));
  }, []);

  // State for mark as delivered functionality
  const [showMarkDeliveredModal, setShowMarkDeliveredModal] = useState(false);
  const [isMarkingDelivered, setIsMarkingDelivered] = useState(false);
  const [markDeliveredError, setMarkDeliveredError] = useState<string | null>(
    null,
  );
  const [deliveredOverride, setDeliveredOverride] = useState<boolean | null>(null);

  // State for supplier pickup functionality
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [isMarkingPickup, setIsMarkingPickup] = useState(false);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [pickupSelection, setPickupSelection] = useState<Set<number>>(
    () => new Set(),
  );

  // State for record partial delivery
  const [showPartialDeliveryModal, setShowPartialDeliveryModal] = useState(false);
  const [partialDeliveryNote, setPartialDeliveryNote] = useState("");
  const [partialDeliveryRecordedDate, setPartialDeliveryRecordedDate] = useState("");
  const [isRecordingPartialDelivery, setIsRecordingPartialDelivery] = useState(false);
  const [partialDeliveryError, setPartialDeliveryError] = useState<string | null>(null);

  // State for job info popup
  const [showJobInfoPopup, setShowJobInfoPopup] = useState(false);
  const normalizedPropListContext =
    typeof listNumberContext === "string" ? listNumberContext.trim() : "";
  const normalizedPropListNumber =
    typeof listNumber === "string" ? listNumber.trim() : "";
  const resolvedListContext =
    normalizedPropListContext && normalizedPropListContext !== "__ALL__"
      ? normalizedPropListContext
      : normalizedPropListNumber || null;

  const formDataRef = useRef(formData);
  const hasChangesRef = useRef(hasChanges);
  const canEditRef = useRef(canEdit);
  const isLoadingRef = useRef(isLoading);
  const jobNumberRef = useRef(jobNumber);
  const listContextRef = useRef<string | null>(resolvedListContext);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    formDataRef.current = formData;
    hasChangesRef.current = hasChanges;
    canEditRef.current = canEdit;
    isLoadingRef.current = isLoading;
    jobNumberRef.current = jobNumber;
    listContextRef.current = resolvedListContext;
  }, [formData, hasChanges, canEdit, isLoading, jobNumber, resolvedListContext]);

  // Load delivery data for this job (abort stale requests when deps change)
  const loadAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setDeliveredOverride(null);
    loadDeliveryData(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobNumber, resolvedListContext]);

  useEffect(() => {
    onUnsavedChangesChange?.(hasChanges);
  }, [hasChanges, onUnsavedChangesChange]);

  useEffect(() => {
    return () => onUnsavedChangesChange?.(false);
  }, [onUnsavedChangesChange]);

  useEffect(() => {
    if (deliveredOverride === null) return;
    if (!lineItems || lineItems.length === 0) return;
    const reflected = lineItems.every((item) => isLineItemDelivered(item.delivered));
    if (reflected === deliveredOverride) {
      setDeliveredOverride(null);
    }
  }, [lineItems, deliveredOverride]);

  // Helpers for supplier pickup lines
  const hasPickupLines = (items: JobLineItem[]): boolean => {
    return items.some(
      (item) =>
        item.pickupFromSupplier === true &&
        typeof item.ordered === "string" &&
        item.ordered.toLowerCase() === "yes",
    );
  };

  const hasOutstandingSupplierPickup = (items: JobLineItem[]): boolean => {
    return items.some((item) => {
      if (
        item.pickupFromSupplier !== true ||
        typeof item.ordered !== "string" ||
        item.ordered.toLowerCase() !== "yes"
      ) {
        return false;
      }
      const orderedQty = item.quantityOrdered ?? 0;
      const receivedQty = item.quantityReceivedFromOrder ?? 0;
      return orderedQty > receivedQty;
    });
  };

  const loadDeliveryData = async (signal?: AbortSignal) => {
    try {
      setIsLoading(true);
      setError(null);
      setWarning(null);

      const deliveryQuery = new URLSearchParams({
        jobNumber,
      });
      if (resolvedListContext && resolvedListContext.trim() !== "") {
        deliveryQuery.set("listNumber", resolvedListContext);
      }
      const getDatesUrl = new URL(
        `/api/jobs/${encodeURIComponent(jobNumber)}/get-dates`,
        window.location.origin,
      );
      if (lineItems[0]?.partNumber) {
        getDatesUrl.searchParams.set("partNumber", lineItems[0].partNumber);
      }
      if (resolvedListContext && resolvedListContext.trim() !== "") {
        getDatesUrl.searchParams.set("listNumber", resolvedListContext);
      }
      const [deliveryRes, jobDatesRes] = await Promise.all([
        fetch(`/api/delivery/get?${deliveryQuery.toString()}`, { signal }),
        fetch(getDatesUrl.toString(), { signal }),
      ]);

      if (signal?.aborted) return;

      if (!deliveryRes.ok) {
        throw new Error("Failed to load delivery data");
      }

      const { delivery } = await deliveryRes.json();
      if (signal?.aborted) return;

      setDeliveryRecord(delivery);

      let jobDeliveryDate: string | null = null;
      if (jobDatesRes.ok) {
        const jobDates = await jobDatesRes.json();
        jobDeliveryDate = jobDates.deliveryDate || null;
      }

      if (signal?.aborted) return;

      if (delivery) {
        // Map delivery record to form data
        const loadedData = {
          fabPipe: delivery.fabPipes || false,
          loosePipe: delivery.loosePipes || false,
          thdFittings: delivery.thdFittings || false,
          grvdFittings: delivery.grvdFittings || false,
          nipples: delivery.nipples || false,
          valves: delivery.valves || false,
          heads: delivery.heads || false,
          hangers: delivery.hangers || false,
          rodStrut: delivery.rodStrut || false,
          flexDrops: delivery.flexDrops || false,
          cpvcPipe: delivery.cpvcPipes || false,
          cpvcFittings: delivery.cpvcFittings ?? false,
          quickDrops: delivery.quickDrops || false,
          pipeStand: delivery.pipeStand || false,
          compressor: delivery.compressor || false,
          backflow: delivery.backflow || false,
          signs: delivery.signs || false,
          other: delivery.other ?? false,

          locations:
            delivery.locations && delivery.locations.length > 0
              ? delivery.locations.map((loc: any) => ({
                  id: loc.id,
                  locationType: loc.locationType || null,
                  row: loc.row || null,
                  column: loc.column || null,
                  order: loc.order || 0,
                }))
              : delivery.location ||
                  delivery.locationRow ||
                  delivery.locationColumn
                ? [
                    {
                      locationType: delivery.location || null,
                      row: delivery.locationRow || null,
                      column: delivery.locationColumn || null,
                    },
                  ]
                : [],

          largePartsBackflow: false,
          largePartsOther: "",

          pickupGalloup: delivery.pickupGalloup || false,
          pickupEtna: delivery.pickupEtna || false,
          pickupViking: delivery.pickupViking || false,
          pickupOther: delivery.pickupOther || "",

          deliveryGalloup: delivery.deliveryGalloup || false,
          deliveryEtna: delivery.deliveryEtna || false,
          deliveryViking: delivery.deliveryViking || false,
          deliveryOther: delivery.deliveryOther || "",

          fitterPickingUpMaterial: delivery.fitterPickingUpMaterial || false,
          picker: delivery.picker || "",
          pickerDate: delivery.pickerDate || "",
          receiver: delivery.receiver || "",
          receiverDate: delivery.receiverDate || "",
          additionalReceiverDates: Array.isArray(delivery.additionalReceiverDates)
            ? delivery.additionalReceiverDates
            : [],
          loaderDriver: delivery.loaderDriver || "",
          fitter: delivery.fitter || "",
          notes: delivery.notes || "",

          backordersEtnaOrdered: delivery.backordersEtnaOrdered || false,
          backordersGalloupOrdered: delivery.backordersGalloupOrdered || false,
          backordersVikingOrdered: delivery.backordersVikingOrdered || false,
          backordersCoreMainOrdered:
            delivery.backordersCoreMainOrdered || false,
          backordersOtherOrdered: delivery.backordersOtherOrdered || false,
          backordersEtnaPartial: delivery.backordersEtnaPartial || false,
          backordersGalloupPartial: delivery.backordersGalloupPartial || false,
          backordersVikingPartial: delivery.backordersVikingPartial || false,
          backordersCoreMainPartial:
            delivery.backordersCoreMainPartial || false,
          backordersOtherPartial: delivery.backordersOtherPartial || false,
          backordersEtnaReceived: delivery.backordersEtnaReceived || false,
          backordersGalloupReceived:
            delivery.backordersGalloupReceived || false,
          backordersVikingReceived: delivery.backordersVikingReceived || false,
          backordersCoreMainReceived:
            delivery.backordersCoreMainReceived || false,
          backordersOtherReceived: delivery.backordersOtherReceived || false,
          backordersOtherName: delivery.backordersOtherName || "",
          backordersOtherVendors:
            Array.isArray(delivery.backordersOtherVendors) &&
            delivery.backordersOtherVendors.length > 0
              ? delivery.backordersOtherVendors
              : delivery.backordersOtherName ||
                  delivery.backordersOtherOrdered ||
                  delivery.backordersOtherPartial ||
                  delivery.backordersOtherReceived
                ? [
                    {
                      name: delivery.backordersOtherName || "",
                      ordered: delivery.backordersOtherOrdered || false,
                      partial: delivery.backordersOtherPartial || false,
                      received: delivery.backordersOtherReceived || false,
                    },
                  ]
                : [{ name: "", ordered: false, partial: false, received: false }],

          fromShopComplete: delivery.fromShopComplete || false,
          fromShopStillNeed: delivery.fromShopStillNeed || false,
          fromShopNa: delivery.fromShopNa || false,
          fromSuppliersComplete: delivery.fromSuppliersComplete || false,
          fromSuppliersStillNeed: delivery.fromSuppliersStillNeed || false,
          fromSuppliersNa: delivery.fromSuppliersNa || false,

          date: jobDeliveryDate || delivery.date || toDateKeyInAppTimeZone(new Date()),
        };

        setFormData(loadedData);
        setInitialData(loadedData);
        // Start with all location dropdowns expanded
        const locationIndices = loadedData.locations.map((_: any, i: number) => i);
        setExpandedLocations(new Set(locationIndices));
      } else {
        // No existing delivery record - use job's delivery/ship date if available
        const defaultDate = jobDeliveryDate || toDateKeyInAppTimeZone(new Date());
        const updatedData = { ...formData, date: defaultDate };
        setFormData(updatedData);
        setInitialData(updatedData);
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      console.error("Error loading delivery data:", err);
      setError((err as Error).message);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  };

  // Helper functions to check job status
  const isAlreadyDelivered = (): boolean => {
    if (deliveredOverride !== null) return deliveredOverride;
    if (!lineItems || lineItems.length === 0) return false;
    return lineItems.every((item) => isLineItemDelivered(item.delivered));
  };

  const getOutstandingDeliveryParts = (): Array<{
    partNumber: string;
    description: string | null;
    remaining: number;
    unreceivedOrder: boolean;
  }> => {
    if (!lineItems || lineItems.length === 0) return [];

    return lineItems
      .map((item) => {
        const ordered =
          item.ordered === "Yes" ||
          item.ordered === "yes" ||
          item.ordered === "YES";
        const received =
          item.receivedFromOrder === "Yes" ||
          item.receivedFromOrder === "yes" ||
          item.receivedFromOrder === "YES";
        const remaining = getRemainingQty({
          needed: item.quantityNeeded,
          fab: item.quantityFab,
          shop: item.quantityPulled,
          preorder: item.quantityPreordered,
          vendor: item.quantityReceivedFromOrder,
        });

        return {
          partNumber: item.partNumber?.trim() || "Unknown part",
          description: item.description?.trim() || null,
          remaining,
          unreceivedOrder: ordered && !received,
        };
      })
      .filter((entry) => entry.remaining > 0 || entry.unreceivedOrder)
      .sort((a, b) => b.remaining - a.remaining);
  };

  const markDirty = () => {
    hasChangesRef.current = true;
    setHasChanges(true);
  };

  const updateField = (field: string, value: any) => {
    if (!canEdit || isSaving) return; // Prevent updates if not allowed
    setFormData((prev) => ({ ...prev, [field]: value }));
    markDirty();
  };

  const updateMaterialStatus = (
    source: "shop" | "suppliers",
    status: "complete" | "need" | "na",
  ) => {
    if (!canEdit || isSaving) return;

    if (source === "shop") {
      setFormData((prev) => ({
        ...prev,
        fromShopComplete: status === "complete",
        fromShopStillNeed: status === "need",
        fromShopNa: status === "na",
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        fromSuppliersComplete: status === "complete",
        fromSuppliersStillNeed: status === "need",
        fromSuppliersNa: status === "na",
      }));
    }
    markDirty();
  };

  const updateOtherVendor = (
    index: number,
    field: keyof BackordersOtherVendor,
    value: string | boolean,
  ) => {
    if (!canEdit || isSaving) return;
    setFormData((prev) => ({
      ...prev,
      backordersOtherVendors: prev.backordersOtherVendors.map((vendor, i) =>
        i === index ? { ...vendor, [field]: value } : vendor,
      ),
    }));
    markDirty();
  };

  const addOtherVendor = () => {
    if (!canEdit || isSaving) return;
    setFormData((prev) => ({
      ...prev,
      backordersOtherVendors: [
        ...prev.backordersOtherVendors,
        { name: "", ordered: false, partial: false, received: false },
      ],
    }));
    markDirty();
  };

  const removeOtherVendor = (index: number) => {
    if (!canEdit || isSaving) return;
    setFormData((prev) => {
      const next = prev.backordersOtherVendors.filter((_, i) => i !== index);
      return {
        ...prev,
        backordersOtherVendors:
          next.length > 0
            ? next
            : [{ name: "", ordered: false, partial: false, received: false }],
      };
    });
    markDirty();
  };

  const getTestGaugeVendor = () =>
    formData.backordersOtherVendors.find(
      (vendor) =>
        vendor.name.trim().toUpperCase() === TEST_GAUGE_VENDOR_NAME,
    );

  const updateTestGaugeField = (
    field: "ordered" | "partial" | "received",
    value: boolean,
  ) => {
    if (!canEdit || isSaving) return;
    setFormData((prev) => {
      const existingIndex = prev.backordersOtherVendors.findIndex(
        (vendor) =>
          vendor.name.trim().toUpperCase() === TEST_GAUGE_VENDOR_NAME,
      );
      if (existingIndex >= 0) {
        return {
          ...prev,
          backordersOtherVendors: prev.backordersOtherVendors.map(
            (vendor, index) =>
              index === existingIndex ? { ...vendor, [field]: value } : vendor,
          ),
        };
      }
      return {
        ...prev,
        backordersOtherVendors: [
          ...prev.backordersOtherVendors,
          {
            name: TEST_GAUGE_VENDOR_NAME,
            ordered: field === "ordered" ? value : false,
            partial: field === "partial" ? value : false,
            received: field === "received" ? value : false,
          },
        ],
      };
    });
    markDirty();
  };

  // Location toggle function
  const toggleLocation = (index: number) => {
    setExpandedLocations((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // Location management functions
  const addLocation = () => {
    if (!canEdit || isSaving) return;
    const newLocation = {
      locationType: null,
      row: null,
      column: null,
    };
    setFormData((prev) => ({
      ...prev,
      locations: [...prev.locations, newLocation],
    }));
    // Auto-expand the newly added location
    setExpandedLocations((prev) => {
      const newSet = new Set(prev);
      newSet.add(formData.locations.length); // Index of the new location
      return newSet;
    });
    markDirty();
  };

  const removeLocation = (index: number) => {
    if (!canEdit || isSaving) return;
    setFormData((prev) => ({
      ...prev,
      locations: prev.locations.filter((_, i) => i !== index),
    }));
    markDirty();
  };

  const updateLocation = (index: number, field: string, value: any) => {
    if (!canEdit || isSaving) return;
    setFormData((prev) => ({
      ...prev,
      locations: prev.locations.map((loc: any, i: number) =>
        i === index ? { ...loc, [field]: value } : loc,
      ),
    }));
    markDirty();
  };

  const handleSave = useCallback(
    async (options?: { silent?: boolean }): Promise<boolean> => {
      while (true) {
        while (saveInFlightRef.current) {
          try {
            await saveInFlightRef.current;
          } catch {
            /* ignore */
          }
        }

        if (!hasChangesRef.current) {
          return true;
        }

        const snapshot = formDataRef.current;
        const savePromise = (async (): Promise<boolean> => {
          try {
            setIsSaving(true);
            setError(null);
            if (!options?.silent) {
              setSuccessMessage(null);
            }

            const payload = formDataToDeliveryPayload(snapshot);

            const res = await fetch("/api/delivery/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobNumber,
                listNumberContext: resolvedListContext,
                data: payload,
              }),
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.error || `Save failed (${res.status})`);
            }

            const { delivery } = await res.json();
            if (delivery) {
              setDeliveryRecord(delivery);
            }

            const currentJson = JSON.stringify(
              formDataToDeliveryPayload(formDataRef.current),
            );
            const savedJson = JSON.stringify(payload);
            if (currentJson === savedJson) {
              hasChangesRef.current = false;
              setHasChanges(false);
              setInitialData(formDataRef.current);
              if (!options?.silent) {
                setSuccessMessage("Delivery info saved.");
                setTimeout(() => setSuccessMessage(null), 3000);
              }
            }
            return true;
          } catch (err) {
            console.error("Error saving delivery data:", err);
            setError((err as Error).message);
            return false;
          } finally {
            setIsSaving(false);
          }
        })();

        saveInFlightRef.current = savePromise;
        let ok: boolean;
        try {
          ok = await savePromise;
        } finally {
          saveInFlightRef.current = null;
        }

        if (!ok) {
          return false;
        }
        if (!hasChangesRef.current) {
          return true;
        }
      }
    },
    [jobNumber, resolvedListContext],
  );

  const saveRequestRef = useRef<
    (opts?: { silent?: boolean }) => Promise<boolean>
  >(async () => false);
  saveRequestRef.current = async (opts?: { silent?: boolean }) => {
    try {
      return await handleSave(opts);
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!registerSaveHandler) return;
    registerSaveHandler((opts) => saveRequestRef.current(opts));
    return () => registerSaveHandler(null);
  }, [registerSaveHandler, handleSave]);

  // Debounced auto-save: 10 seconds after last change
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hasChanges || !canEdit || isLoading) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveRequestRef.current();
    }, 10_000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, hasChanges, canEdit, isLoading]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) return;
      if (!canEditRef.current || isLoadingRef.current) return;
      if (!hasChangesRef.current) return;
      void saveRequestRef.current({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const onPageHide = () => {
      if (!hasChangesRef.current || !canEditRef.current) return;
      const payload = formDataToDeliveryPayload(formDataRef.current);
      void fetch("/api/delivery/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobNumber: jobNumberRef.current,
          listNumberContext: listContextRef.current,
          data: payload,
        }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Handle mark as delivered action
  const handleMarkAsDelivered = () => {
    // Check for unsaved changes first - block if present
    if (hasChanges) {
      setError("Please save your changes before marking the job as delivered.");
      return;
    }

    // Show modal to confirm
    setShowMarkDeliveredModal(true);
  };

  const confirmMarkAsDelivered = async () => {
    try {
      setIsMarkingDelivered(true);
      setMarkDeliveredError(null);

      const newDelivered = !isAlreadyDelivered();
      const res = await fetch("/api/jobs/mark-delivered", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobNumber,
          delivered: newDelivered,
          listNumber: resolvedListContext,
          listNumberContext: resolvedListContext,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to mark as delivered (${res.status})`,
        );
      }

      setShowMarkDeliveredModal(false);
      setSuccessMessage(
        newDelivered ? "Job marked as delivered." : "Delivery status cleared.",
      );
      setTimeout(() => setSuccessMessage(null), 4000);

      setDeliveredOverride(newDelivered);
      await onPickupConfirmed?.();
      await loadDeliveryData();
    } catch (err) {
      console.error("Error marking as delivered:", err);
      setMarkDeliveredError((err as Error).message);
    } finally {
      setIsMarkingDelivered(false);
    }
  };

  // Get warning message for modal
  const getWarningMessage = (): {
    title: string;
    message: string;
    isWarning: boolean;
    outstandingParts?: Array<{
      partNumber: string;
      description: string | null;
      remaining: number;
      unreceivedOrder: boolean;
    }>;
  } => {
    // This should never be called if hasChanges is true (button is disabled),
    // but include it as a safety check
    if (hasChanges) {
      return {
        title: "Unsaved Changes",
        message:
          "You have unsaved changes in the delivery tab. Please save them first before marking the job as delivered.",
        isWarning: true,
      };
    }

    const alreadyDelivered = isAlreadyDelivered();

    if (alreadyDelivered) {
      return {
        title: "Unmark as Delivered?",
        message:
          "This job is already marked as delivered. Do you want to unmark it?",
        isWarning: false,
      };
    }

    const outstandingParts = getOutstandingDeliveryParts();
    if (outstandingParts.length > 0) {
      return {
        title: "Remaining Parts Not Complete",
        message: `This job still has ${outstandingParts.length} part(s) with remaining quantity or open vendor orders. Mark as delivered anyway?`,
        isWarning: true,
        outstandingParts,
      };
    }

    return {
      title: "Mark as Delivered?",
      message: "Mark this job as delivered?",
      isWarning: false,
    };
  };

  const handleRecordPartialDelivery = () => {
    setPartialDeliveryError(null);
    setPartialDeliveryNote(deliveryRecord?.partialDeliveryNote ?? "");
    const existingAt = deliveryRecord?.partialDeliveryRecordedAt;
    setPartialDeliveryRecordedDate(
      existingAt
        ? toDateKeyInAppTimeZone(new Date(existingAt))
        : toDateKeyInAppTimeZone(new Date()),
    );
    setShowPartialDeliveryModal(true);
  };

  const confirmRecordPartialDelivery = async () => {
    try {
      setIsRecordingPartialDelivery(true);
      setPartialDeliveryError(null);

      const res = await fetch("/api/delivery/partial-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobNumber,
          note: partialDeliveryNote,
          recordedDate:
            partialDeliveryRecordedDate.trim() ||
            toDateKeyInAppTimeZone(new Date()),
          listNumberContext: resolvedListContext,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to record partial delivery (${res.status})`,
        );
      }

      const data = await res.json();

      setShowPartialDeliveryModal(false);
      setPartialDeliveryNote("");
      setPartialDeliveryRecordedDate("");

      setDeliveryRecord((prev) =>
        prev
          ? {
              ...prev,
              partialDeliveryNote: data.partialDeliveryNote ?? null,
              partialDeliveryRecordedAt:
                data.partialDeliveryRecordedAt ?? null,
            }
          : prev,
      );

      setSuccessMessage("Partial delivery recorded.");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Error recording partial delivery:", err);
      setPartialDeliveryError((err as Error).message);
    } finally {
      setIsRecordingPartialDelivery(false);
    }
  };

  const clearPartialDeliveryRecord = async (options?: { closeModal?: boolean }) => {
    try {
      setIsRecordingPartialDelivery(true);
      setPartialDeliveryError(null);
      setError(null);

      const res = await fetch("/api/delivery/partial-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobNumber,
          listNumberContext: resolvedListContext,
          clear: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to clear partial delivery (${res.status})`,
        );
      }

      const data = await res.json();

      if (options?.closeModal) {
        setShowPartialDeliveryModal(false);
      }
      setPartialDeliveryNote("");

      setDeliveryRecord((prev) =>
        prev
          ? {
              ...prev,
              partialDeliveryNote: data.partialDeliveryNote ?? null,
              partialDeliveryRecordedAt: data.partialDeliveryRecordedAt ?? null,
            }
          : prev,
      );

      setSuccessMessage("Partial delivery record cleared.");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Error clearing partial delivery:", err);
      setError((err as Error).message);
    } finally {
      setIsRecordingPartialDelivery(false);
    }
  };

  const getPickupLinesNeedingReceive = (): JobLineItem[] => {
    if (!lineItems || lineItems.length === 0) return [];
    return lineItems.filter((item) => {
      if (
        item.pickupFromSupplier !== true ||
        typeof item.ordered !== "string" ||
        item.ordered.toLowerCase() !== "yes"
      ) {
        return false;
      }
      const orderedQty = item.quantityOrdered ?? 0;
      const receivedQty = item.quantityReceivedFromOrder ?? 0;
      return orderedQty > receivedQty;
    });
  };

  const confirmPickupFromSupplier = async () => {
    try {
      setIsMarkingPickup(true);
      setPickupError(null);

      const pickupLines = getPickupLinesNeedingReceive().filter((item) =>
        pickupSelection.has(item.rowIndex),
      );
      if (pickupLines.length === 0) {
        setPickupError("Please select at least one part to pick up.");
        return;
      }

      const items = pickupLines.map((item) => ({
        jobNumber,
        listNumber: item.listNumber || resolvedListContext || "1",
        partNumber: item.partNumber || "",
      }));

      const res = await fetch("/api/delivery/confirm-pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobNumber,
          listNumberContext: resolvedListContext,
          items,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Pickup confirmation failed (${res.status})`,
        );
      }

      const data = await res.json();

      setShowPickupModal(false);
      setPickupSelection(new Set());
      setSuccessMessage(
        `Picked up ${data.updatedCount} item(s) from supplier.`,
      );
      setTimeout(() => setSuccessMessage(null), 4000);

      onPickupConfirmed?.();
      await loadDeliveryData();
    } catch (err) {
      console.error("Error confirming pickup:", err);
      setPickupError((err as Error).message);
    } finally {
      setIsMarkingPickup(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl backdrop-blur-sm shadow-xl">
        <div className="text-center p-6">
          <div className="relative">
            <div className="absolute inset-0 bg-purple-500 rounded-full opacity-20 animate-ping"></div>
            <img
              src="/icon.png"
              alt="Total Fire Protection"
              className="h-20 w-20 mx-auto animate-float relative z-10 rounded-2xl shadow-xl"
            />
          </div>
          <p className="text-white font-bold mt-8 text-2xl">
            Total Fire Protection
          </p>
          <p className="text-slate-400 font-semibold mt-3">
            Loading delivery information...
          </p>
          <div className="flex justify-center gap-2 mt-4">
            <div
              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
              style={{ animationDelay: "0ms" }}
            ></div>
            <div
              className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
              style={{ animationDelay: "150ms" }}
            ></div>
            <div
              className="w-2 h-2 bg-green-400 rounded-full animate-bounce"
              style={{ animationDelay: "300ms" }}
            ></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Header with Record partial delivery and Mark as Delivered - Teleported to header */}
      {portalNode &&
        canShowDeliveryActions &&
        createPortal(
          <div className="flex items-center gap-2">
            {canPartialDelivery && (
            <button
              onClick={handleRecordPartialDelivery}
              disabled={
                isSaving ||
                isRecordingPartialDelivery ||
                hasChanges ||
                !lineItems ||
                lineItems.length === 0
              }
              className="px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                hasChanges
                  ? "Please save your changes first"
                  : "Record that only some parts were delivered"
              }
            >
              Record partial delivery
            </button>
            )}
            {canMarkPickup &&
              lineItems &&
              lineItems.length > 0 &&
              getPickupLinesNeedingReceive().length > 0 && (
                <button
                  onClick={() => {
                    setPickupError(null);
                    const candidates = getPickupLinesNeedingReceive();
                    setPickupSelection(
                      new Set(candidates.map((item) => item.rowIndex)),
                    );
                    setShowPickupModal(true);
                  }}
                  disabled={
                    isSaving ||
                    isMarkingPickup ||
                    hasChanges ||
                    !lineItems ||
                    lineItems.length === 0
                  }
                  className="px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg bg-amber-600 hover:bg-amber-700 text-white shadow-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={
                    hasChanges
                      ? "Please save your changes first"
                      : "Mark selected pickup-from-supplier lines as picked up"
                  }
                >
                  Pick Up from Supplier
                </button>
              )}
            {canMarkDelivered && (
            <button
              onClick={handleMarkAsDelivered}
              disabled={
                isSaving ||
                isMarkingDelivered ||
                isMarkingPickup ||
                (!isAlreadyDelivered() &&
                  lineItems &&
                  hasOutstandingSupplierPickup(lineItems)) ||
                hasChanges ||
                !lineItems ||
                lineItems.length === 0
              }
              className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg ${
                isAlreadyDelivered()
                  ? "bg-orange-500 hover:bg-orange-600 text-white shadow-orange-500/20"
                  : "bg-green-600 hover:bg-green-700 text-white shadow-green-500/20"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={
                hasChanges
                  ? "Please save your changes first"
                  : !isAlreadyDelivered() &&
                      lineItems &&
                      hasOutstandingSupplierPickup(lineItems)
                    ? "Pick up from supplier before marking as delivered"
                    : undefined
              }
            >
              {isAlreadyDelivered() ? "Unmark as Delivered" : "Mark as Delivered"}
            </button>
            )}
          </div>,
          portalNode,
        )}

      {/* Error Message */}
      {error && (
        <div className="flex-shrink-0 bg-red-500 border border-red-600 rounded-lg p-2 flex items-start space-x-2 shadow-lg shadow-red-500/20 backdrop-blur-sm mb-2">
          <svg
            className="w-6 h-6 text-white flex-shrink-0 animate-pulse"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white">Error</h3>
            <p className="text-sm text-white/90 dark:text-white/90 mt-1">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-white hover:text-white/80 transition-all transform hover:scale-110"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Warning Message */}
      {warning && !error && (
        <div className="flex-shrink-0 bg-amber-100 border border-amber-300 rounded-lg p-2 flex items-start space-x-2 shadow-lg shadow-amber-400/20 backdrop-blur-sm mb-2 text-amber-900">
          <svg
            className="w-6 h-6 text-amber-500 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.596c.75 1.335-.213 2.997-1.742 2.997H3.48c-1.53 0-2.492-1.662-1.743-2.997l6.52-11.596zM11 14a1 1 0 10-2 0 1 1 0 002 0zm-1-2a1 1 0 01-1-1V8a1 1 0 112 0v3a1 1 0 01-1 1z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-bold">Heads up</h3>
            <p className="text-sm mt-1">{warning}</p>
          </div>
          <button
            onClick={() => setWarning(null)}
            className="text-amber-700 hover:text-amber-500 transition-all transform hover:scale-110"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Success Message */}
      {successMessage && !error && (
        <div className="flex-shrink-0 bg-green-500 border border-green-600 rounded-lg p-2 flex items-center space-x-2 shadow-lg shadow-green-500/20 backdrop-blur-sm mb-2">
          <svg className="w-6 h-6 text-white flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <p className="text-sm font-semibold text-white">{successMessage}</p>
        </div>
      )}

      {/* Partial delivery recorded info box */}
      {deliveryRecord?.partialDeliveryRecordedAt && (
        <div className="flex-shrink-0 mb-3 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-sm flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-amber-800 dark:text-amber-200">Partial delivery recorded</span>
            <span className="text-amber-700 dark:text-amber-300">
              {" "}
              on {deliveryRecord.partialDeliveryRecordedAt ? formatDateInAppTimeZone(deliveryRecord.partialDeliveryRecordedAt, { dateStyle: "medium" }) : ""}
              {deliveryRecord.partialDeliveryNote ? ": " : ""}
            </span>
            {deliveryRecord.partialDeliveryNote && (
              <span className="text-amber-800 dark:text-amber-200">{deliveryRecord.partialDeliveryNote}</span>
            )}
          </div>
          {canPartialDelivery && (
            <button
              type="button"
              onClick={() => void clearPartialDeliveryRecord()}
              disabled={isSaving || isRecordingPartialDelivery || hasChanges}
              title={hasChanges ? "Please save your changes first" : "Remove partial delivery note and date"}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border border-amber-300 dark:border-amber-500/50 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRecordingPartialDelivery ? "Please wait..." : "Clear record"}
            </button>
          )}
        </div>
      )}

      {/* Main Content - Grid Layout - Fills Height */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="grid grid-cols-12 delivery-gap-sm w-full h-full items-stretch">
            {/* Left Column - Job Info & Location */}
            <div className="col-span-3 flex flex-col delivery-gap-sm overflow-hidden min-h-0 min-w-0 h-full">
              {/* Job Information */}
              <div
                className="flex-shrink-0 bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/80 transition-colors"
                onClick={() => setShowJobInfoPopup(true)}
                title="Click to view full details"
              >
                <h3 className="delivery-text-sm font-bold text-slate-900 dark:text-white delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50">
                  Job Info
                </h3>
                <div className="delivery-space-y-2 delivery-text-sm">
                  <div className="flex justify-between items-start gap-3">
                    <span className="text-slate-700 dark:text-slate-300 font-bold flex-shrink-0">
                      Name:
                    </span>
                    <span className="text-slate-900 dark:text-white font-medium flex-1 min-w-0 text-right line-clamp-1">
                      {deliveryRecord?.jobName || jobName}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-slate-700 dark:text-slate-300 font-bold flex-shrink-0">
                      Job #:
                    </span>
                    <span className="text-slate-900 dark:text-white font-medium text-right">
                      {jobNumber}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-slate-700 dark:text-slate-300 font-bold flex-shrink-0">
                      List #:
                    </span>
                    <span className="text-slate-900 dark:text-white font-medium text-right">
                      {jobInfo.listNumber || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-3">
                    <span className="text-slate-700 dark:text-slate-300 font-bold flex-shrink-0">
                      Area:
                    </span>
                    <span className="text-slate-900 dark:text-white font-medium truncate flex-1 min-w-0 text-right">
                      {deliveryRecord?.jobArea || jobInfo.area || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-3">
                    <span className="text-slate-700 dark:text-slate-300 font-bold flex-shrink-0">
                      Address:
                    </span>
                    <span className="text-slate-900 dark:text-white font-medium flex-1 min-w-0 text-right line-clamp-1">
                      {deliveryRecord?.address || jobInfo.location || "—"}
                    </span>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <label className="block delivery-text-xs text-slate-700 dark:text-slate-300 font-bold delivery-mb-1">
                      Date:
                    </label>
                    <input
                      type="date"
                      value={formData.date}
                      onChange={(e) => updateField("date", e.target.value)}
                      disabled={!canEdit || isSaving}
                      className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white delivery-rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>

              {/* Location in Shop */}
              <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl flex-1 min-h-0 overflow-y-auto flex flex-col">
                <div className="flex justify-between items-center delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50 flex-shrink-0">
                  <h3 className="delivery-text-sm font-bold text-slate-900 dark:text-white">Locations</h3>
                  <button
                    onClick={addLocation}
                    disabled={!canEdit || isSaving}
                    className="delivery-input bg-blue-600 hover:bg-blue-700 text-white delivery-text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    + Add
                  </button>
                </div>
                <div className="delivery-space-y-2 delivery-text-sm flex-1">
                  {formData.locations.length === 0 ? (
                    <div className="text-center delivery-py-2 text-slate-600 dark:text-slate-400 delivery-text-xs">
                      No locations added. Click "Add Location" to add one.
                    </div>
                  ) : (
                    formData.locations.map((location, index) => (
                      <div
                        key={index}
                        className="border border-gray-300 dark:border-slate-600/50 delivery-rounded-sm bg-gray-50 dark:bg-slate-700/30 relative"
                      >
                        <div className="flex justify-between items-center delivery-p-2">
                          <div className="flex items-center delivery-gap-sm flex-1">
                            <button
                              onClick={() => toggleLocation(index)}
                              className="flex-shrink-0 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                            >
                              <span className="delivery-text-sm">
                                {expandedLocations.has(index) ? "▼" : "▶"}
                              </span>
                            </button>
                            <span className="delivery-text-sm font-semibold text-slate-700 dark:text-slate-300">
                              Location #{index + 1}
                            </span>
                          </div>
                          <button
                            onClick={() => removeLocation(index)}
                            disabled={!canEdit || isSaving}
                            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 delivery-text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Remove
                          </button>
                        </div>
                        {expandedLocations.has(index) && (
                          <div className="delivery-px-2 delivery-pb-2 border-t border-gray-300 dark:border-slate-600/50 delivery-pt-2 delivery-space-y-2">
                            <div className="grid grid-cols-3 delivery-gap-sm">
                              <div>
                                <label className="block delivery-text-sm text-slate-700 dark:text-slate-300 font-semibold delivery-mb-1">
                                  Type
                                </label>
                                <input
                                  type="text"
                                  value={location.locationType || ""}
                                  onChange={(e) =>
                                    updateLocation(
                                      index,
                                      "locationType",
                                      e.target.value || null,
                                    )
                                  }
                                  disabled={!canEdit || isSaving}
                                  className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded delivery-text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                />
                              </div>
                              <div>
                                <label className="block delivery-text-sm text-slate-700 dark:text-slate-300 font-semibold delivery-mb-1">
                                  Row
                                </label>
                                <input
                                  type="text"
                                  value={location.row || ""}
                                  onChange={(e) =>
                                    updateLocation(
                                      index,
                                      "row",
                                      e.target.value || null,
                                    )
                                  }
                                  disabled={!canEdit || isSaving}
                                  className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded delivery-text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                />
                              </div>
                              <div>
                                <label className="block delivery-text-sm text-slate-700 dark:text-slate-300 font-semibold delivery-mb-1">
                                  Col
                                </label>
                                <input
                                  type="text"
                                  value={location.column || ""}
                                  onChange={(e) =>
                                    updateLocation(
                                      index,
                                      "column",
                                      e.target.value || null,
                                    )
                                  }
                                  disabled={!canEdit || isSaving}
                                  className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded delivery-text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Middle Columns - Parts, Pickup/Delivery, Personnel */}
            <div className="col-span-6 grid grid-cols-6 delivery-gap-sm overflow-hidden min-h-0 h-full min-w-0">
              {/* Parts Checklist */}
              <div className="col-span-3 bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl min-h-0 flex flex-col overflow-hidden">
                <h3 className="delivery-text-sm font-bold text-slate-900 dark:text-white delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50 flex-shrink-0">
                  Parts
                </h3>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <div className="grid grid-cols-2 delivery-gap-md delivery-text-sm">
                    {[
                      { key: "fabPipe", label: "FAB PIPE" },
                      { key: "loosePipe", label: "LOOSE PIPE" },
                      { key: "thdFittings", label: "THD FITTINGS" },
                      { key: "grvdFittings", label: "GRVD FITTINGS" },
                      { key: "nipples", label: "NIPPLES" },
                      { key: "valves", label: "VALVES" },
                      { key: "heads", label: "HEADS" },
                      { key: "hangers", label: "HANGERS" },
                      { key: "rodStrut", label: "ROD/STRUT" },
                      { key: "flexDrops", label: "FLEX DROPS" },
                      { key: "cpvcPipe", label: "CPVC PIPE" },
                      { key: "cpvcFittings", label: "CPVC FITTINGS" },
                      { key: "quickDrops", label: "QUICK DROPS" },
                      { key: "pipeStand", label: "PIPE STAND" },
                      { key: "compressor", label: "COMPRESSOR" },
                      { key: "backflow", label: "BACKFLOW" },
                      { key: "signs", label: "SIGNS" },
                      { key: "other", label: "OTHER" },
                    ].map(({ key, label }) => (
                      <label
                        key={key}
                        className="flex items-center delivery-gap-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/30 delivery-p-2 rounded delivery-rounded-sm transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={
                            formData[key as keyof typeof formData] as boolean
                          }
                          onChange={(e) => updateField(key, e.target.checked)}
                          disabled={!canEdit || isSaving}
                          className="delivery-checkbox flex-shrink-0 text-blue-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700/50 disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        <span className="delivery-text-sm font-medium text-slate-900 dark:text-slate-300">
                          {label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Pickup & Delivery & Personnel */}
              <div className="col-span-3 flex flex-col delivery-gap-sm min-h-0 h-full">
                {/* Pickup Locations */}
                <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl flex-shrink-0">
                  <h3 className="delivery-text-sm font-bold text-slate-900 dark:text-white delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50">
                    Pick Up
                  </h3>
                  <div className="flex flex-wrap delivery-gap-sm delivery-mb-2">
                    {[
                      { key: "pickupEtna", label: "ETNA" },
                      { key: "pickupGalloup", label: "GALLOUP" },
                      { key: "pickupViking", label: "VIKING" },
                    ].map(({ key, label }) => (
                      <label
                        key={key}
                        className="flex items-center delivery-gap-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/30 delivery-p-1 rounded delivery-rounded-sm transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={
                            formData[key as keyof typeof formData] as boolean
                          }
                          onChange={(e) => updateField(key, e.target.checked)}
                          className="delivery-checkbox text-blue-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700/50"
                        />
                        <span className="delivery-text-sm font-medium text-slate-900 dark:text-slate-300">
                          {label}
                        </span>
                      </label>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Other..."
                    value={formData.pickupOther}
                    onChange={(e) => updateField("pickupOther", e.target.value)}
                    className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                  />
                </div>

                {/* Personnel */}
                <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl flex-1 min-h-0 overflow-y-auto flex flex-col">
                  <h3 className="delivery-text-sm font-bold text-slate-900 dark:text-white delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50 flex-shrink-0">
                    Personnel
                  </h3>
                  <div className="delivery-space-y-2 delivery-text-sm flex-1">
                    <div className="grid grid-cols-2 delivery-gap-sm">
                      {/* Picker Section */}
                      <div className="delivery-space-y-2">
                        <div>
                          <label className="block delivery-text-sm text-slate-700 dark:text-slate-300 font-semibold delivery-mb-1 text-blue-600 dark:text-blue-400">
                            Picker
                          </label>
                          <input
                            type="text"
                            value={formData.picker}
                            onChange={(e) =>
                              updateField("picker", e.target.value)
                            }
                            className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                            placeholder="Name"
                          />
                        </div>
                        <div>
                          <label className="block delivery-text-xs text-slate-700 dark:text-slate-300 font-semibold delivery-mb-1">
                            Picker Date
                          </label>
                          <input
                            type="date"
                            value={formData.pickerDate}
                            onChange={(e) =>
                              updateField("pickerDate", e.target.value)
                            }
                            className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>

                      {/* Receiver Section */}
                      <div className="delivery-space-y-2">
                        <div>
                          <label className="block delivery-text-xs text-slate-700 dark:text-slate-300 font-semibold delivery-mb-1 text-green-600 dark:text-green-400">
                            Receiver
                          </label>
                          <input
                            type="text"
                            value={formData.receiver}
                            onChange={(e) =>
                              updateField("receiver", e.target.value)
                            }
                            className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                            placeholder="Name"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between delivery-mb-1">
                            <label className="block delivery-text-xs text-slate-700 dark:text-slate-300 font-semibold">
                              Receiver Date{formData.additionalReceiverDates.length > 0 ? "s" : ""}
                            </label>
                            <button
                              type="button"
                              disabled={!canEdit || isSaving}
                              onClick={() => {
                                if (!canEdit || isSaving) return;
                                setFormData((prev: any) => ({
                                  ...prev,
                                  additionalReceiverDates: [
                                    ...prev.additionalReceiverDates,
                                    "",
                                  ],
                                }));
                                markDirty();
                              }}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 delivery-text-xs font-semibold flex items-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Add another receiver date"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                              </svg>
                              Add Date
                            </button>
                          </div>
                          <input
                            type="date"
                            value={formData.receiverDate}
                            onChange={(e) =>
                              updateField("receiverDate", e.target.value)
                            }
                            className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          {formData.additionalReceiverDates.map(
                            (dateVal: string, idx: number) => (
                              <div key={idx} className="flex items-center gap-1 mt-1">
                                <input
                                  type="date"
                                  value={dateVal}
                                  disabled={!canEdit || isSaving}
                                  onChange={(e) => {
                                    if (!canEdit || isSaving) return;
                                    setFormData((prev: any) => {
                                      const updated = [...prev.additionalReceiverDates];
                                      updated[idx] = e.target.value;
                                      return { ...prev, additionalReceiverDates: updated };
                                    });
                                    markDirty();
                                  }}
                                  className="flex-1 delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                />
                                <button
                                  type="button"
                                  disabled={!canEdit || isSaving}
                                  onClick={() => {
                                    if (!canEdit || isSaving) return;
                                    setFormData((prev: any) => ({
                                      ...prev,
                                      additionalReceiverDates:
                                        prev.additionalReceiverDates.filter(
                                          (_: string, i: number) => i !== idx,
                                        ),
                                    }));
                                    markDirty();
                                  }}
                                  className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Remove this date"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 delivery-gap-md delivery-pt-2 border-t border-gray-200 dark:border-slate-700/30">
                      <div>
                        <label className="block delivery-text-xs text-slate-700 dark:text-slate-300 font-semibold delivery-mb-1">
                          Loader/Driver
                        </label>
                        <input
                          type="text"
                          value={formData.loaderDriver}
                          onChange={(e) =>
                            updateField("loaderDriver", e.target.value)
                          }
                          className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                          placeholder="Name"
                        />
                      </div>
                      <div>
                        <label className="block delivery-text-xs text-slate-700 dark:text-slate-300 font-semibold delivery-mb-1">
                          Fitter
                        </label>
                        <input
                          type="text"
                          value={formData.fitter}
                          onChange={(e) =>
                            updateField("fitter", e.target.value)
                          }
                          className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                          placeholder="Name"
                        />
                      </div>
                    </div>

                    <label className="flex items-center delivery-gap-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/30 delivery-p-1 rounded delivery-rounded-sm transition-colors delivery-mt-2">
                      <input
                        type="checkbox"
                        checked={formData.fitterPickingUpMaterial}
                        onChange={(e) =>
                          updateField(
                            "fitterPickingUpMaterial",
                            e.target.checked,
                          )
                        }
                        className="delivery-checkbox text-blue-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700/50"
                      />
                      <span className="delivery-text-sm font-medium text-slate-900 dark:text-slate-300">
                        FITTER PICKING UP
                      </span>
                    </label>
                  </div>
                </div>

                {/* Notes */}
                <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl flex-shrink-0">
                  <h3 className="delivery-text-sm font-bold text-slate-900 dark:text-white delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50">
                    Notes
                  </h3>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    disabled={!canEdit || isSaving}
                    rows={4}
                    className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500 resize-y disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder="Enter notes..."
                  />
                </div>
              </div>
            </div>

            {/* Right Column - Backorders, Material Status */}
            <div className="col-span-3 flex flex-col delivery-gap-sm min-h-0 min-w-0 h-full">
              {/* Supplier to job site */}
              <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl flex-shrink-0">
                <h3 className="delivery-text-sm font-bold text-slate-900 dark:text-white delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50">
                  Supplier to job site
                </h3>
                <div className="flex flex-wrap delivery-gap-sm delivery-mb-1">
                  {[
                    { key: "deliveryEtna", label: "ETNA" },
                    { key: "deliveryGalloup", label: "GALLOUP" },
                    { key: "deliveryViking", label: "VIKING" },
                  ].map(({ key, label }) => (
                      <label
                        key={key}
                        className="flex items-center delivery-gap-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/30 delivery-p-1 rounded delivery-rounded-sm transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={
                            formData[key as keyof typeof formData] as boolean
                          }
                          onChange={(e) => updateField(key, e.target.checked)}
                          className="delivery-checkbox text-blue-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700/50"
                        />
                        <span className="delivery-text-sm font-medium text-slate-900 dark:text-slate-300">
                          {label}
                        </span>
                      </label>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Other..."
                  value={formData.deliveryOther}
                  onChange={(e) => updateField("deliveryOther", e.target.value)}
                  className="w-full delivery-input bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500"
                />
              </div>

              {/* Backorders */}
              <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl flex-1 min-h-0 overflow-y-auto flex flex-col">
                <div className="flex items-center delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50 flex-shrink-0">
                  <h3 className="flex-1 delivery-text-sm font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                    Backorders
                  </h3>
                  <span className="w-12 text-center delivery-text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-tight">Ord</span>
                  <span className="w-12 text-center delivery-text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-tight">Par</span>
                  <span className="w-12 text-center delivery-text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-tight">Rec</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <table className="w-full delivery-text-sm">
                    <tbody>
                      {[
                        { name: "ETNA", prefix: "Etna" },
                        { name: "GALLOUP", prefix: "Galloup" },
                        { name: "VIKING", prefix: "Viking" },
                        { name: "CORE & MAIN", prefix: "CoreMain" },
                      ].map(({ name, prefix }) => (
                        <tr
                          key={prefix}
                          className="border-b border-gray-200 dark:border-slate-700/30 hover:bg-gray-50 dark:hover:bg-slate-700/20"
                        >
                          <td className="delivery-py-2 delivery-px-1 text-slate-700 dark:text-slate-300 font-medium delivery-text-sm">
                            {name}
                          </td>
                          <td className="delivery-py-2 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={
                              formData[
                                `backorders${prefix}Ordered` as keyof typeof formData
                              ] as boolean
                            }
                            onChange={(e) =>
                              updateField(
                                `backorders${prefix}Ordered`,
                                e.target.checked,
                              )
                            }
                            className="delivery-checkbox text-blue-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700/50"
                          />
                        </td>
                        <td className="delivery-py-2 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={
                              formData[
                                `backorders${prefix}Partial` as keyof typeof formData
                              ] as boolean
                            }
                            onChange={(e) =>
                              updateField(
                                `backorders${prefix}Partial`,
                                e.target.checked,
                              )
                            }
                            className="delivery-checkbox text-yellow-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-yellow-500 bg-white dark:bg-slate-700/50"
                          />
                        </td>
                        <td className="delivery-py-2 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={
                              formData[
                                `backorders${prefix}Received` as keyof typeof formData
                              ] as boolean
                            }
                            onChange={(e) =>
                              updateField(
                                `backorders${prefix}Received`,
                                e.target.checked,
                              )
                            }
                            className="delivery-checkbox text-green-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700/50"
                          />
                        </td>
                      </tr>
                    ))}
                      <tr className="border-b border-gray-200 dark:border-slate-700/30 hover:bg-gray-50 dark:hover:bg-slate-700/20">
                        <td className="delivery-py-2 delivery-px-1 text-slate-700 dark:text-slate-300 font-medium delivery-text-sm">
                          {TEST_GAUGE_VENDOR_NAME}
                        </td>
                        <td className="delivery-py-2 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={getTestGaugeVendor()?.ordered ?? false}
                            onChange={(e) =>
                              updateTestGaugeField("ordered", e.target.checked)
                            }
                            className="delivery-checkbox text-blue-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700/50"
                          />
                        </td>
                        <td className="delivery-py-2 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={getTestGaugeVendor()?.partial ?? false}
                            onChange={(e) =>
                              updateTestGaugeField("partial", e.target.checked)
                            }
                            className="delivery-checkbox text-yellow-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-yellow-500 bg-white dark:bg-slate-700/50"
                          />
                        </td>
                        <td className="delivery-py-2 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={getTestGaugeVendor()?.received ?? false}
                            onChange={(e) =>
                              updateTestGaugeField("received", e.target.checked)
                            }
                            className="delivery-checkbox text-green-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700/50"
                          />
                        </td>
                      </tr>
                      {formData.backordersOtherVendors.map((vendor, index) => (
                        vendor.name.trim().toUpperCase() === TEST_GAUGE_VENDOR_NAME ? null :
                        <tr
                          key={`other-vendor-${index}`}
                          className="border-b border-gray-200 dark:border-slate-700/30 hover:bg-gray-50 dark:hover:bg-slate-700/20"
                        >
                          <td className="delivery-py-2 delivery-px-1">
                            <div className="flex items-center delivery-gap-sm">
                              <input
                                type="text"
                                value={vendor.name}
                                onChange={(e) =>
                                  updateOtherVendor(index, "name", e.target.value)
                                }
                                disabled={!canEdit || isSaving}
                                placeholder="Other (enter name)"
                                className="w-full delivery-input px-2 py-1 delivery-text-sm bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-900 dark:text-white rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500 dark:placeholder:text-slate-500 disabled:opacity-60 disabled:cursor-not-allowed"
                              />
                              {canEdit && !isSaving && (
                                <button
                                  type="button"
                                  onClick={() => removeOtherVendor(index)}
                                  className="delivery-text-xs px-2 py-1 rounded border border-gray-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700/40"
                                  aria-label={`Remove other vendor ${index + 1}`}
                                >
                                  X
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="delivery-py-2 w-12 text-center">
                            <input
                              type="checkbox"
                              checked={vendor.ordered}
                              onChange={(e) =>
                                updateOtherVendor(index, "ordered", e.target.checked)
                              }
                              disabled={!canEdit || isSaving}
                              className="delivery-checkbox text-blue-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700/50 disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="delivery-py-2 w-12 text-center">
                            <input
                              type="checkbox"
                              checked={vendor.partial}
                              onChange={(e) =>
                                updateOtherVendor(index, "partial", e.target.checked)
                              }
                              disabled={!canEdit || isSaving}
                              className="delivery-checkbox text-yellow-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-yellow-500 bg-white dark:bg-slate-700/50 disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="delivery-py-2 w-12 text-center">
                            <input
                              type="checkbox"
                              checked={vendor.received}
                              onChange={(e) =>
                                updateOtherVendor(index, "received", e.target.checked)
                              }
                              disabled={!canEdit || isSaving}
                              className="delivery-checkbox text-green-500 border-2 border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700/50 disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {canEdit && (
                  <button
                    type="button"
                    onClick={addOtherVendor}
                    disabled={isSaving}
                    className="mt-2 w-full delivery-text-xs px-2 py-1 rounded border border-dashed border-gray-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700/40 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    + Add Other Vendor
                  </button>
                )}
                </div>
              </div>

              {/* Material Status */}
              <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 delivery-rounded-md delivery-p-2 backdrop-blur-sm shadow-xl flex-shrink-0">
                <div className="delivery-mb-2 delivery-pb-2 border-b border-gray-200 dark:border-slate-700/50">
                  <h3 className="delivery-text-sm font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                    Material Status
                  </h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 border-b border-gray-200 dark:border-slate-700/30 delivery-pb-2">
                    <span className="delivery-px-1 text-slate-700 dark:text-slate-300 font-medium delivery-text-sm">
                      FROM SHOP
                    </span>
                    <div className="inline-flex rounded-lg border border-gray-300 dark:border-slate-600/50 bg-gray-50 dark:bg-slate-700/40 p-1">
                      <button
                        type="button"
                        onClick={() => updateMaterialStatus("shop", "complete")}
                        disabled={!canEdit || isSaving}
                        className={`delivery-text-xs font-bold px-3 py-1.5 rounded-md transition ${
                          formData.fromShopComplete
                            ? "bg-emerald-500 text-white shadow"
                            : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        onClick={() => updateMaterialStatus("shop", "need")}
                        disabled={!canEdit || isSaving}
                        className={`delivery-text-xs font-bold px-3 py-1.5 rounded-md transition ${
                          formData.fromShopStillNeed
                            ? "bg-amber-500 text-white shadow"
                            : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        Need
                      </button>
                      <button
                        type="button"
                        onClick={() => updateMaterialStatus("shop", "na")}
                        disabled={!canEdit || isSaving}
                        className={`delivery-text-xs font-bold px-3 py-1.5 rounded-md transition ${
                          formData.fromShopNa
                            ? "bg-slate-500 text-white shadow"
                            : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        N/A
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="delivery-px-1 text-slate-700 dark:text-slate-300 font-medium delivery-text-sm">
                      FROM SUPPLIERS
                    </span>
                    <div className="inline-flex rounded-lg border border-gray-300 dark:border-slate-600/50 bg-gray-50 dark:bg-slate-700/40 p-1">
                      <button
                        type="button"
                        onClick={() => updateMaterialStatus("suppliers", "complete")}
                        disabled={!canEdit || isSaving}
                        className={`delivery-text-xs font-bold px-3 py-1.5 rounded-md transition ${
                          formData.fromSuppliersComplete
                            ? "bg-emerald-500 text-white shadow"
                            : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        onClick={() => updateMaterialStatus("suppliers", "need")}
                        disabled={!canEdit || isSaving}
                        className={`delivery-text-xs font-bold px-3 py-1.5 rounded-md transition ${
                          formData.fromSuppliersStillNeed
                            ? "bg-amber-500 text-white shadow"
                            : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        Need
                      </button>
                      <button
                        type="button"
                        onClick={() => updateMaterialStatus("suppliers", "na")}
                        disabled={!canEdit || isSaving}
                        className={`delivery-text-xs font-bold px-3 py-1.5 rounded-md transition ${
                          formData.fromSuppliersNa
                            ? "bg-slate-500 text-white shadow"
                            : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        N/A
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="flex-shrink-0 delivery-pt-2 border-t border-gray-200 dark:border-slate-700/50">
          <div className="w-full delivery-px-3 delivery-py-2 bg-gray-400 dark:bg-slate-600 text-white delivery-rounded-md delivery-text-base font-bold text-center">
            🔒 Read-Only Mode - Contact admin for edit access
          </div>
        </div>
      )}

      {/* Mark as Delivered Confirmation Modal */}
      {showMarkDeliveredModal && (() => {
        const warning = getWarningMessage();
        return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-start space-x-4">
              {warning.isWarning ? (
                <div className="flex-shrink-0 w-12 h-12 bg-yellow-100 dark:bg-yellow-500/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-yellow-600 dark:text-yellow-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              ) : (
                <div className="flex-shrink-0 w-12 h-12 bg-blue-100 dark:bg-blue-500/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-blue-600 dark:text-blue-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                  {warning.title}
                </h3>
                <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
                  {warning.message}
                </p>
                {warning.outstandingParts && warning.outstandingParts.length > 0 ? (
                  <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <ul className="space-y-2 text-sm text-amber-900 dark:text-amber-100">
                      {warning.outstandingParts.map((part) => (
                        <li key={part.partNumber} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="font-semibold">{part.partNumber}</span>
                            {part.description ? (
                              <span className="block truncate text-amber-800/80 dark:text-amber-200/80">
                                {part.description}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex-shrink-0 text-right">
                            {part.remaining > 0 ? (
                              <span className="font-semibold">{part.remaining} remaining</span>
                            ) : null}
                            {part.unreceivedOrder ? (
                              <span className="block text-xs font-medium text-amber-800 dark:text-amber-200">
                                Vendor order not received
                              </span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {markDeliveredError && (
                  <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/50 rounded-lg">
                    <p className="text-sm text-red-700 dark:text-red-300">{markDeliveredError}</p>
                  </div>
                )}
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setShowMarkDeliveredModal(false);
                      setMarkDeliveredError(null);
                    }}
                    disabled={isMarkingDelivered}
                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmMarkAsDelivered}
                    disabled={isMarkingDelivered}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      warning.isWarning
                        ? "bg-yellow-500 hover:bg-yellow-600 text-white"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {isMarkingDelivered
                      ? "Processing..."
                      : isAlreadyDelivered()
                        ? "Unmark"
                        : warning.isWarning
                          ? "Mark Delivered Anyway"
                          : "Mark as Delivered"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Pick Up from Supplier Confirmation Modal */}
      {showPickupModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden my-auto">
            <div className="relative p-6 pb-0 flex-shrink-0">
              <div className="absolute top-6 right-6 flex-shrink-0 w-12 h-12 bg-blue-100 dark:bg-blue-500/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-blue-600 dark:text-blue-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414A2 2 0 0011.414 4H16a1 1 0 011 1v2h-2V6H5v8h4v2H4a1 1 0 01-1-1V3zm13 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1v-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="pr-16">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                    Pick Up from Supplier
                  </h3>
                  <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
                    Select the parts that you are picking up now.
                  </p>
                </div>
                <div className="mb-4 max-h-[35vh] overflow-x-hidden overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg min-w-0">
                  <table className="w-full text-sm table-fixed">
                    <thead className="bg-gray-50 dark:bg-slate-800/80 sticky top-0 z-10">
                      <tr className="text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <th className="px-3 py-2 w-10 text-center flex-shrink-0">
                          <input
                            type="checkbox"
                            checked={
                              getPickupLinesNeedingReceive().length > 0 &&
                              getPickupLinesNeedingReceive().every((item) =>
                                pickupSelection.has(item.rowIndex),
                              )
                            }
                            onChange={(e) => {
                              const candidates = getPickupLinesNeedingReceive();
                              if (e.target.checked) {
                                setPickupSelection(
                                  new Set(
                                    candidates.map((item) => item.rowIndex),
                                  ),
                                );
                              } else {
                                setPickupSelection(new Set());
                              }
                            }}
                          />
                        </th>
                        <th className="px-3 py-2">Description</th>
                        <th className="px-3 py-2 w-16 text-center whitespace-nowrap">
                          Required
                        </th>
                        <th className="px-3 py-2 w-20 text-center whitespace-nowrap">
                          Received
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {getPickupLinesNeedingReceive().length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-3 text-center text-sm font-medium text-amber-600 dark:text-amber-400"
                          >
                            Everything is picked up.
                          </td>
                        </tr>
                      ) : (
                        getPickupLinesNeedingReceive().map((item) => (
                          <tr
                            key={item.rowIndex}
                            className="border-t border-gray-100 dark:border-slate-700/60"
                          >
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={pickupSelection.has(item.rowIndex)}
                                onChange={(e) => {
                                  setPickupSelection((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      next.add(item.rowIndex);
                                    } else {
                                      next.delete(item.rowIndex);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-xs truncate" title={item.description || undefined}>
                              {item.description || "—"}
                            </td>
                            <td className="px-3 py-2 text-xs w-16 text-center whitespace-nowrap">
                              {item.quantityOrdered ?? 0}
                            </td>
                            <td className="px-3 py-2 text-xs w-20 text-center whitespace-nowrap">
                              {item.quantityReceivedFromOrder ?? 0}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {pickupError && (
                  <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/50 rounded-lg flex-shrink-0">
                    <p className="text-sm text-red-700 dark:text-red-300 break-words">{pickupError}</p>
                  </div>
                )}
                <div className="flex space-x-3 flex-shrink-0 pb-6">
                  <button
                    onClick={() => {
                      setShowPickupModal(false);
                      setPickupError(null);
                    }}
                    disabled={isMarkingPickup}
                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmPickupFromSupplier}
                    disabled={
                      isMarkingPickup ||
                      getPickupLinesNeedingReceive().length === 0
                    }
                    title={
                      getPickupLinesNeedingReceive().length === 0
                        ? "Everything is picked up"
                        : undefined
                    }
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isMarkingPickup ? "Marking..." : "Confirm Pickup"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record partial delivery Modal */}
      {showPartialDeliveryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              Record partial delivery
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Record that only some parts were delivered. This does not mark the job as delivered.
            </p>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Date of partial delivery
            </label>
            <input
              type="date"
              value={partialDeliveryRecordedDate}
              onChange={(e) => setPartialDeliveryRecordedDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 mb-4 dark:[color-scheme:dark]"
            />
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Note (e.g. what was delivered or what&apos;s left)
            </label>
            <textarea
              value={partialDeliveryNote}
              onChange={(e) => setPartialDeliveryNote(e.target.value)}
              placeholder="e.g. Delivered 50% of parts; rest next week"
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 mb-4"
            />
            {partialDeliveryError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/50 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-300">{partialDeliveryError}</p>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowPartialDeliveryModal(false);
                    setPartialDeliveryError(null);
                    setPartialDeliveryRecordedDate("");
                  }}
                  disabled={isRecordingPartialDelivery}
                  className="flex-1 px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRecordPartialDelivery}
                  disabled={isRecordingPartialDelivery}
                  className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRecordingPartialDelivery ? "Saving..." : "Save"}
                </button>
              </div>
              {deliveryRecord?.partialDeliveryRecordedAt && (
                <button
                  type="button"
                  onClick={() => void clearPartialDeliveryRecord({ closeModal: true })}
                  disabled={isRecordingPartialDelivery}
                  className="w-full px-4 py-2 border border-red-300 dark:border-red-500/50 text-red-800 dark:text-red-200 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRecordingPartialDelivery ? "Please wait..." : "Clear partial delivery record"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Job Info Popup Modal */}
      {showJobInfoPopup && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowJobInfoPopup(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Job Information</h3>
              <button
                onClick={() => setShowJobInfoPopup(false)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-slate-600 dark:text-slate-400 font-semibold block mb-1">
                  Job Number:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">{jobNumber}</span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400 font-semibold block mb-1">
                  List Number:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {jobInfo.listNumber || "—"}
                </span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400 font-semibold block mb-1">
                  Job Name:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {deliveryRecord?.jobName || jobName || "—"}
                </span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400 font-semibold block mb-1">
                  Area:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {deliveryRecord?.jobArea || jobInfo.area || "—"}
                </span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400 font-semibold block mb-1">
                  Address:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {deliveryRecord?.address || jobInfo.location || "—"}
                </span>
              </div>
              {jobInfo.contractNumber && (
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-semibold block mb-1">
                    Contract Number:
                  </span>
                  <span className="text-slate-900 dark:text-white font-medium">
                    {jobInfo.contractNumber}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-slate-700/50">
              {onEditJob && canShowEditJobButton ? (
                <button
                  onClick={() => {
                    setShowJobInfoPopup(false);
                    onEditJob();
                  }}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-all"
                >
                  Edit Job
                </button>
              ) : (
                <button
                  onClick={() => setShowJobInfoPopup(false)}
                  className="w-full px-4 py-2 bg-gray-200 dark:bg-slate-700/50 hover:bg-gray-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-lg font-semibold transition-all"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
