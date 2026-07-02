import StandaloneEstimateEditor from "@/components/estimate/StandaloneEstimateEditor";

export default async function StandaloneEstimateEditorPage({
  params,
}: {
  params: Promise<{ estimateId: string }>;
}) {
  const { estimateId } = await params;
  return <StandaloneEstimateEditor estimateId={estimateId} />;
}
