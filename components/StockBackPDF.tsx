'use client';

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import type { StockBackPdfDocument } from '@/lib/stockBackPdfShared';

interface StockBackPDFProps {
  document: StockBackPdfDocument;
}

function shouldStackAreaBelowJobName(
  jobName: string,
  area: string | null | undefined,
): boolean {
  const j = (jobName ?? '').trim();
  const a = (area ?? '—').trim();
  return j.length > 34 || a.length > 22 || j.length + a.length > 48;
}

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
  docInfo: {
    textAlign: 'right',
    flexDirection: 'column',
  },
  docTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  docNumber: {
    fontSize: 12,
    marginBottom: 4,
  },
  docDate: {
    fontSize: 12,
    color: '#666',
  },
  voidBanner: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#FEE2E2',
    border: '2 solid #DC2626',
    textAlign: 'center',
  },
  voidBannerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#991B1B',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  voidBannerText: {
    fontSize: 10,
    color: '#7F1D1D',
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
  infoAreaBelowJobName: {
    marginTop: 2,
  },
  noteBox: {
    marginBottom: 18,
    padding: 10,
    border: '1 solid #ccc',
    backgroundColor: '#fafafa',
  },
  noteTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  noteText: {
    fontSize: 10,
    lineHeight: 1.4,
  },
  table: {
    marginTop: 10,
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
    width: '10%',
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

const StockBackPDF: React.FC<StockBackPDFProps> = ({ document }) => {
  const currentDate = formatDateInAppTimeZone(document.createdAt, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const isVoided = document.status === 'REVERSED' || document.status === 'DELETED';
  const voidLabel = document.status === 'DELETED' ? 'Deleted' : 'Reversed';
  const voidedAtLabel = document.voidedAt
    ? formatDateInAppTimeZone(document.voidedAt, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const logoUrl =
    typeof window !== 'undefined' && window.location
      ? `${window.location.origin}/icon.png`
      : 'https://via.placeholder.com/60';

  const formatCurrency = (amount: number | null): string => {
    if (amount === null || Number.isNaN(amount)) return '—';
    return `$${amount.toFixed(2)}`;
  };

  const salesTaxPercentLabel = `${(document.salesTaxRate * 100).toFixed(0)}%`;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {isVoided ? (
          <View style={styles.voidBanner}>
            <Text style={styles.voidBannerTitle}>Voided — {voidLabel}</Text>
            {voidedAtLabel ? (
              <Text style={styles.voidBannerText}>Voided on {voidedAtLabel}</Text>
            ) : null}
            {document.voidReason ? (
              <Text style={styles.voidBannerText}>Reason: {document.voidReason}</Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.logoContainer}>
              <Image src={logoUrl} style={styles.logo} cache={false} />
              <View style={styles.companyInfo}>
                <Text style={styles.companyName}>Total Fire Protection</Text>
                <Text style={styles.companySubtitle}>
                  Fire-Protection Materials Shop
                </Text>
              </View>
            </View>
            <View style={styles.docInfo}>
              <Text style={styles.docTitle}>Stock In</Text>
              <Text style={styles.docNumber}>
                SB #{document.jobNumber}
              </Text>
              <Text style={styles.docDate}>{currentDate}</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoSection}>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Return To:</Text>
            <Text style={styles.infoText}>Total Fire Protection</Text>
            <Text style={styles.infoText}>Fire-Protection Materials Shop</Text>
            <Text style={styles.infoText}>Inventory / Stock In</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Job Information:</Text>
            <View style={styles.infoRow}>
              <View style={styles.infoRowCellLeft}>
                <Text style={[styles.infoText, { marginBottom: 0 }]}>
                  <Text style={{ fontWeight: 'bold' }}>Job Number:</Text>{' '}
                  {document.jobNumber}
                </Text>
              </View>
              <View style={styles.infoRowCellRight}>
                <Text style={[styles.infoText, { marginBottom: 0 }]}>
                  <Text style={{ fontWeight: 'bold' }}>Return ID:</Text>{' '}
                  {document.stockReturnId.slice(0, 8)}
                </Text>
              </View>
            </View>
            {shouldStackAreaBelowJobName(document.jobName, document.area) ? (
              <View style={styles.infoJobNameAreaStacked}>
                <Text style={[styles.infoText, { marginBottom: 0 }]} wrap>
                  <Text style={{ fontWeight: 'bold' }}>Job Name:</Text>{' '}
                  {document.jobName}
                </Text>
                <Text
                  style={[
                    styles.infoText,
                    styles.infoAreaBelowJobName,
                    { marginBottom: 0 },
                  ]}
                  wrap
                >
                  <Text style={{ fontWeight: 'bold' }}>Area:</Text>{' '}
                  {document.area ?? '—'}
                </Text>
              </View>
            ) : (
              <View style={styles.infoRow}>
                <View style={styles.infoRowCellLeft}>
                  <Text style={[styles.infoText, { marginBottom: 0 }]} wrap>
                    <Text style={{ fontWeight: 'bold' }}>Job Name:</Text>{' '}
                    {document.jobName}
                  </Text>
                </View>
                <View style={styles.infoRowCellRight}>
                  <Text style={[styles.infoText, { marginBottom: 0 }]} wrap>
                    <Text style={{ fontWeight: 'bold' }}>Area:</Text>{' '}
                    {document.area ?? '—'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {document.note ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteTitle}>Note</Text>
            <Text style={styles.noteText}>{document.note}</Text>
          </View>
        ) : null}

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.colPartNumber]}>
              Part Number
            </Text>
            <Text style={[styles.tableCell, styles.colDescription]}>
              Description
            </Text>
            <Text style={[styles.tableCell, styles.colUOM]}>UOM</Text>
            <Text style={[styles.tableCell, styles.colQuantity]}>Qty</Text>
            <Text style={[styles.tableCell, styles.colUnitCost]}>
              Unit Cost
            </Text>
            <Text style={[styles.tableCell, styles.colSupplier]}>Supplier</Text>
            <Text style={[styles.tableCell, styles.colLineTotal]}>
              Line Total
            </Text>
          </View>
          {document.lines.map((line, index) => (
            <View key={`${line.partNumber}-${index}`} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.colPartNumber]}>
                {line.partNumber}
              </Text>
              <Text style={[styles.tableCell, styles.colDescription]}>
                {line.description || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colUOM]}>
                {line.uom || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colQuantity]}>
                {line.quantity}
              </Text>
              <Text style={[styles.tableCell, styles.colUnitCost]}>
                {formatCurrency(line.unitCost)}
              </Text>
              <Text style={[styles.tableCell, styles.colSupplier]}>
                {line.supplier || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colLineTotal]}>
                {formatCurrency(line.lineTotal)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalAmount}>
              {formatCurrency(document.subtotal)}
            </Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              Sales Tax ({salesTaxPercentLabel})
            </Text>
            <Text style={styles.totalAmount}>
              {formatCurrency(document.salesTaxAmount)}
            </Text>
          </View>
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>Total Return Value</Text>
            <Text style={styles.grandTotalAmount}>
              {formatCurrency(document.grandTotal)}
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <View style={styles.footerColumn}>
            <Text style={styles.footerTitle}>Summary:</Text>
            <Text style={styles.footerText}>
              Materials returned from job {document.jobNumber} to shop inventory.
            </Text>
            <Text style={styles.footerText}>
              Total return value includes {salesTaxPercentLabel} sales tax.
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

export default StockBackPDF;
