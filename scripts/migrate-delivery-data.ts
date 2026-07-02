/**
 * Legacy migration script — Google Sheets delivery import was removed.
 * Delivery data now lives in PostgreSQL only (deliveries table).
 */
console.error(
  'migrate-delivery-data.ts is retired: Google Sheets delivery sync was removed from this app.',
);
process.exit(1);
