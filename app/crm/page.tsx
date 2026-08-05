import { redirect } from "next/navigation";
import { isCrmEnabled } from "@/lib/featureFlags";
import CrmDashboard from "@/components/crm/CrmDashboard";

export default function CrmPage() {
  // Hidden per-deployment via NEXT_PUBLIC_ENABLE_CRM=false. Block the direct
  // URL too, not just the sidebar link.
  if (!isCrmEnabled()) {
    redirect("/");
  }
  return <CrmDashboard />;
}
