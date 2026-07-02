'use client';

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer';
import { formatDateInAppTimeZone } from '@/lib/timezone';

interface LineItemWithCost {
  partNumber: string | null;
  description: string | null;
  uom: string | null;
  quantityPulled: number | null;
  quantityNeeded: number | null;
  unitCost: number | null;
  lineTotal: number | null;
  supplier: string | null;
  quantityForCost: number;  // The actual quantity used for cost calculation (shop pull quantity)
  source: 'vendor' | 'shop' | null;  // Track if from vendor order or shop pull
}

interface Totals {
  subtotal: number;
  salesTaxRate: number;
  salesTaxAmount: number;
  grandTotal: number;
  bySupplier: Record<string, { total: number; items: number }>;
}

interface PurchaseOrderPDFProps {
  jobNumber: string;
  jobName: string;
  listNumber?: string | null;
  area?: string | null;
  itemsWithCost: LineItemWithCost[];
  totals: Totals;
}

/** ~one line each in the Job Information column at 10pt; stack Area below when longer. */
function shouldStackAreaBelowJobName(
  jobName: string,
  area: string | null | undefined,
): boolean {
  const j = (jobName ?? '').trim();
  const a = (area ?? '—').trim();
  return (
    j.length > 34 ||
    a.length > 22 ||
    j.length + a.length > 48
  );
}

// Define styles
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 30,
    borderBottom: '2 solid #000',
    paddingBottom: 15,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  logo: {
    width: 60,
    height: 60,
  },
  companyInfo: {
    flexDirection: 'column',
  },
  companyName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  companySubtitle: {
    fontSize: 12,
    color: '#666',
  },
  poInfo: {
    textAlign: 'right',
    flexDirection: 'column',
  },
  poTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  poNumber: {
    fontSize: 12,
    marginBottom: 4,
  },
  poDate: {
    fontSize: 12,
    color: '#666',
  },
  infoSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 25,
  },
  infoBox: {
    width: '48%',
  },
  infoTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 8,
    textTransform: 'uppercase',
    borderBottom: '1 solid #000',
    paddingBottom: 4,
  },
  infoText: {
    fontSize: 10,
    marginBottom: 4,
    lineHeight: 1.5,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  infoRowCellLeft: {
    flexDirection: 'column',
    width: '52%',
    paddingRight: 8,
  },
  infoRowCellRight: {
    flexDirection: 'column',
    width: '48%',
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  infoJobNameAreaStacked: {
    width: '100%',
    marginBottom: 2,
  },
  /** Second line when stacked; same left edge as "Job Name:" row */
  infoAreaBelowJobName: {
    marginTop: 2,
  },
  table: {
    marginTop: 20,
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    padding: 8,
    borderBottom: '2 solid #000',
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 8,
    borderBottom: '1 solid #ccc',
  },
  tableCell: {
    fontSize: 9,
    paddingHorizontal: 4,
  },
  colPartNumber: {
    width: '15%',
  },
  colDescription: {
    width: '25%',
  },
  colUOM: {
    width: '8%',
    textAlign: 'center',
  },
  colQuantity: {
    width: '8%',
    textAlign: 'center',
  },
  colUnitCost: {
    width: '12%',
    textAlign: 'right',
  },
  colSupplier: {
    width: '12%',
  },
  colLineTotal: {
    width: '12%',
    textAlign: 'right',
    fontWeight: 'bold',
  },
  supplierBreakdown: {
    marginTop: 15,
    marginBottom: 20,
  },
  supplierTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  supplierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottom: '1 solid #eee',
  },
  supplierName: {
    fontSize: 9,
  },
  supplierTotal: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  totalsSection: {
    marginTop: 10,
    alignSelf: 'flex-end',
    width: '52%',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottom: '1 solid #eee',
  },
  totalLabel: {
    flex: 1,
    fontSize: 10,
    paddingRight: 16,
  },
  totalAmount: {
    width: 88,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  grandTotal: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: '#f0f0f0',
    borderTop: '2 solid #000',
    borderBottom: '2 solid #000',
  },
  grandTotalLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    paddingRight: 16,
  },
  grandTotalAmount: {
    width: 88,
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTop: '2 solid #000',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerColumn: {
    width: '48%',
  },
  footerTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  footerText: {
    fontSize: 9,
    marginBottom: 6,
    lineHeight: 1.4,
  },
  signatureLine: {
    marginTop: 30,
    borderTop: '1 solid #000',
    paddingTop: 4,
    fontSize: 9,
  },
});

const PurchaseOrderPDF: React.FC<PurchaseOrderPDFProps> = ({
  jobNumber,
  jobName,
  listNumber,
  area,
  itemsWithCost,
  totals,
}) => {
  const currentDate = formatDateInAppTimeZone(new Date(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Get absolute URL for logo image (react-pdf requires absolute URLs)
  const logoUrl = typeof window !== 'undefined' && window.location
    ? `${window.location.origin}/icon.png`
    : 'https://via.placeholder.com/60';

  const formatCurrency = (amount: number | null): string => {
    if (amount === null || isNaN(amount)) return '—';
    return `$${amount.toFixed(2)}`;
  };

  const salesTaxPercentLabel = `${(totals.salesTaxRate * 100).toFixed(0)}%`;

  const getQuantity = (item: LineItemWithCost): number => {
    // Use quantityForCost which represents the actual shop pull quantity
    return item.quantityForCost || 0;
  };

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.logoContainer}>
              <Image
                src={logoUrl}
                style={styles.logo}
                cache={false}
              />
              <View style={styles.companyInfo}>
                <Text style={styles.companyName}>Total Fire Protection</Text>
                <Text style={styles.companySubtitle}>Fire-Protection Materials Shop</Text>
              </View>
            </View>
            <View style={styles.poInfo}>
              <Text style={styles.poNumber}>PO #{jobNumber}</Text>
              <Text style={styles.poDate}>{currentDate}</Text>
            </View>
          </View>
        </View>

        {/* Job Information and Bill To */}
        <View style={styles.infoSection}>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Bill To:</Text>
            <Text style={styles.infoText}>Total Fire Protection</Text>
            <Text style={styles.infoText}>Fire-Protection Materials Shop</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Job Information:</Text>
            <View style={styles.infoRow}>
              <View style={styles.infoRowCellLeft}>
                <Text style={[styles.infoText, { marginBottom: 0 }]}>
                  <Text style={{ fontWeight: 'bold' }}>Job Number:</Text> {jobNumber}
                </Text>
              </View>
              <View style={styles.infoRowCellRight}>
                <Text style={[styles.infoText, { marginBottom: 0 }]}>
                  <Text style={{ fontWeight: 'bold' }}>List Number:</Text> {listNumber ?? '—'}
                </Text>
              </View>
            </View>
            {shouldStackAreaBelowJobName(jobName, area) ? (
              <View style={styles.infoJobNameAreaStacked}>
                <Text style={[styles.infoText, { marginBottom: 0 }]} wrap>
                  <Text style={{ fontWeight: 'bold' }}>Job Name:</Text> {jobName}
                </Text>
                <Text
                  style={[
                    styles.infoText,
                    styles.infoAreaBelowJobName,
                    { marginBottom: 0 },
                  ]}
                  wrap
                >
                  <Text style={{ fontWeight: 'bold' }}>Area:</Text> {area ?? '—'}
                </Text>
              </View>
            ) : (
              <View style={styles.infoRow}>
                <View style={styles.infoRowCellLeft}>
                  <Text style={[styles.infoText, { marginBottom: 0 }]} wrap>
                    <Text style={{ fontWeight: 'bold' }}>Job Name:</Text> {jobName}
                  </Text>
                </View>
                <View style={styles.infoRowCellRight}>
                  <Text style={[styles.infoText, { marginBottom: 0 }]} wrap>
                    <Text style={{ fontWeight: 'bold' }}>Area:</Text> {area ?? '—'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.colPartNumber]}>Part Number</Text>
            <Text style={[styles.tableCell, styles.colDescription]}>Description</Text>
            <Text style={[styles.tableCell, styles.colUOM]}>UOM</Text>
            <Text style={[styles.tableCell, styles.colQuantity]}>Qty</Text>
            <Text style={[styles.tableCell, styles.colUnitCost]}>Unit Cost</Text>
            <Text style={[styles.tableCell, styles.colSupplier]}>Supplier</Text>
            <Text style={[styles.tableCell, styles.colLineTotal]}>Line Total</Text>
          </View>
          {itemsWithCost.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.colPartNumber]}>
                {item.partNumber || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colDescription]}>
                {item.description || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colUOM]}>
                {item.uom || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colQuantity]}>
                {getQuantity(item)}
              </Text>
              <Text style={[styles.tableCell, styles.colUnitCost]}>
                {formatCurrency(item.unitCost)}
              </Text>
              <Text style={[styles.tableCell, styles.colSupplier]}>
                {item.supplier || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colLineTotal]}>
                {formatCurrency(item.lineTotal)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalAmount}>
              {formatCurrency(totals.subtotal)}
            </Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              Sales Tax ({salesTaxPercentLabel})
            </Text>
            <Text style={styles.totalAmount}>
              {formatCurrency(totals.salesTaxAmount)}
            </Text>
          </View>
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>Grand Total</Text>
            <Text style={styles.grandTotalAmount}>
              {formatCurrency(totals.grandTotal)}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerColumn}>
            <Text style={styles.footerTitle}>Terms & Conditions:</Text>
            <Text style={styles.footerText}>Payment Terms: Net 30</Text>
            <Text style={styles.footerText}>Delivery: As specified</Text>
            <Text style={styles.footerText}>
              All items subject to availability and price confirmation.
            </Text>
            <Text style={styles.footerText}>
              Total includes {salesTaxPercentLabel} sales tax.
            </Text>
          </View>
          <View style={styles.footerColumn}>
            <View style={styles.signatureLine}>
              <Text style={styles.footerText}>Authorized By: _________________</Text>
            </View>
            <Text style={[styles.footerText, { marginTop: 10 }]}>
              Date: {currentDate}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default PurchaseOrderPDF;
