-- The vendors table is only a mail-routing directory covering a few suppliers, while
-- POs reference many more. The FK silently blocked lead-time samples for any supplier
-- without a directory row, which is most of them. vendorKey stays as a
-- plain indexed column; Vendor.avg_lead_time_days remains a best-effort cache.
ALTER TABLE "vendor_lead_time_samples" DROP CONSTRAINT IF EXISTS "vendor_lead_time_samples_vendor_key_fkey";
