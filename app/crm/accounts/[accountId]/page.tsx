import { redirect } from "next/navigation";
import { isCrmEnabled } from "@/lib/featureFlags";
import AccountDetail from "@/components/crm/AccountDetail";

export default async function CrmAccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  // Same gate as /crm — the detail routes are reachable by direct URL too.
  if (!isCrmEnabled()) {
    redirect("/");
  }
  const { accountId } = await params;
  return <AccountDetail accountId={accountId} />;
}
