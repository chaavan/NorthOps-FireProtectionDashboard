export const JOB_PREORDER_STATUSES = ["OPEN", "RECEIVED", "CANCELLED"] as const;
export type JobPreorderStatus = (typeof JOB_PREORDER_STATUSES)[number];

export function isJobPreorderStatus(value: string): value is JobPreorderStatus {
  return (JOB_PREORDER_STATUSES as readonly string[]).includes(value);
}
