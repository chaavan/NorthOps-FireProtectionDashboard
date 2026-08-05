import { redirect } from "next/navigation";
import { isCrmEnabled } from "@/lib/featureFlags";
import ContactDetail from "@/components/crm/ContactDetail";

export default async function CrmContactPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  // Same gate as /crm — the detail routes are reachable by direct URL too.
  if (!isCrmEnabled()) {
    redirect("/");
  }
  const { contactId } = await params;
  return <ContactDetail contactId={contactId} />;
}
