/** Mirrors Prisma `JobStockReturnStatus` — use these constants instead of `@prisma/client` enum at runtime. */
export const JOB_STOCK_RETURN_STATUS = {
  ACTIVE: 'ACTIVE',
  REVERSED: 'REVERSED',
  DELETED: 'DELETED',
} as const;

export type JobStockReturnStatusValue =
  (typeof JOB_STOCK_RETURN_STATUS)[keyof typeof JOB_STOCK_RETURN_STATUS];
