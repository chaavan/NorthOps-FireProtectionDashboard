#!/usr/bin/env python3
"""
Diagnose why the match rates are so low for the two new files
"""

import pandas as pd
from pathlib import Path

WORKSPACE = Path("/Users/curranadvani/Desktop/MichiganClient")

# Read database
db_df = pd.read_excel(WORKSPACE / "PN_database_FINAL.xlsx", sheet_name='Main')
db_vendor_ids = set(db_df['Vendor PartID'].dropna().astype(str).str.strip())

print("=" * 80)
print("DATABASE VENDOR PART IDs")
print("=" * 80)
print(f"Total unique Vendor PartIDs in database: {len(db_vendor_ids)}")
print(f"\nSample Vendor PartIDs from database (first 30):")
for i, vid in enumerate(sorted(list(db_vendor_ids))[:30]):
    print(f"  {i+1}. '{vid}'")

# Read future pricing
print("\n\n" + "=" * 80)
print("FILE 1: future_pricing_report_3462 - Column A (Item)")
print("=" * 80)

df1 = pd.read_excel(WORKSPACE / "future_pricing_report_3462 copy.xlsx")
items = df1[df1.columns[0]].dropna().astype(str).str.strip()
items = items[~items.isin(['Future Pricing', 'Item'])]

print(f"Total unique Items: {len(items)}")
print(f"\nSample Items (first 30):")
for i, item in enumerate(items.head(30)):
    print(f"  {i+1}. '{item}'")

# Check matches
matches = set(items) & db_vendor_ids
print(f"\n🔍 MATCHES FOUND: {len(matches)}")
if matches:
    print(f"Matching IDs: {list(matches)}")

# Read Galloup
print("\n\n" + "=" * 80)
print("FILE 2: 116936_GalloupPriceBookfire - Column C (ID)")
print("=" * 80)

df2 = pd.read_excel(WORKSPACE / "116936_GalloupPriceBookfire_922025 copy.xls", engine='xlrd')
ids = df2[df2.columns[2]].dropna().astype(str).str.strip()
ids = ids[ids != 'ID........']

print(f"Total unique IDs: {len(ids)}")
print(f"\nSample IDs (first 30):")
for i, id_val in enumerate(ids.head(30)):
    print(f"  {i+1}. '{id_val}'")

# Check matches
matches2 = set(ids) & db_vendor_ids
print(f"\n🔍 MATCHES FOUND: {len(matches2)}")
if len(matches2) > 0:
    print(f"Matching IDs (first 30): {list(matches2)[:30]}")

# Alternative: Check if we should use Column D (SxID) instead for Galloup
print("\n\n" + "=" * 80)
print("ALTERNATIVE CHECK: Column D (SxID) from Galloup file")
print("=" * 80)

sxids = df2[df2.columns[3]].dropna().astype(str).str.strip()
sxids = sxids[sxids != 'SxID........']

print(f"Total unique SxIDs: {len(sxids)}")
print(f"\nSample SxIDs (first 30):")
for i, sxid in enumerate(sxids.head(30)):
    print(f"  {i+1}. '{sxid}'")

# Check matches
matches3 = set(sxids) & db_vendor_ids
print(f"\n🔍 MATCHES FOUND with SxID: {len(matches3)}")
if len(matches3) > 0:
    print(f"Matching SxIDs (first 30): {list(matches3)[:30]}")

print("\n\n" + "=" * 80)
print("RECOMMENDATION:")
print("=" * 80)

if len(matches2) < len(matches3):
    print(f"⚠️  Column D (SxID) has {len(matches3)} matches vs Column C (ID) with {len(matches2)} matches")
    print(f"   Consider using Column D (SxID) instead of Column C (ID) for the Galloup file")

