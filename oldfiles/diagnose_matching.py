#!/usr/bin/env python3
"""
Diagnostic script to see why matching isn't working
"""

import pandas as pd
import subprocess
from pathlib import Path
from io import StringIO

WORKSPACE = Path("/Users/curranadvani/Desktop/MichiganClient")
BOOK1_FILE = WORKSPACE / "Book1.xlsx"
DB_FILE = WORKSPACE / "PN.accdb copy"

# Read Book1
book1_df = pd.read_excel(BOOK1_FILE)

print("=" * 80)
print("BOOK1.XLSX - Column C Values (first 30 rows)")
print("=" * 80)
print("\nRaw data with all columns:")
for i in range(min(30, len(book1_df))):
    print(f"Row {i}: {list(book1_df.iloc[i])}")

print("\n" + "=" * 80)
print("BOOK1.XLSX - Column C (Unnamed: 2) specifically:")
print("=" * 80)
col_c = book1_df[book1_df.columns[2]]
print(f"Data type: {col_c.dtype}")
print(f"Non-null values: {col_c.notna().sum()}")
print("\nFirst 30 values:")
for i in range(min(30, len(col_c))):
    val = col_c.iloc[i]
    print(f"  {i}: {val} (type: {type(val).__name__})")

# Read database
result = subprocess.run(
    ['mdb-export', str(DB_FILE), 'Main'],
    capture_output=True,
    text=True,
    check=True
)
db_df = pd.read_csv(StringIO(result.stdout))

print("\n" + "=" * 80)
print("DATABASE - Vendor PartID column:")
print("=" * 80)
vendor_col = db_df['Vendor PartID']
print(f"Data type: {vendor_col.dtype}")
print(f"Non-null values: {vendor_col.notna().sum()}")
print("\nFirst 30 non-null values:")
for i, (idx, val) in enumerate(vendor_col.dropna().items()):
    if i >= 30:
        break
    print(f"  {idx}: '{val}' (type: {type(val).__name__}, len: {len(str(val))})")

print("\n" + "=" * 80)
print("MATCHING TEST:")
print("=" * 80)

# Convert both to strings and try to find matches
book1_ids = set(col_c.dropna().astype(str).str.strip())
db_ids = set(vendor_col.dropna().astype(str).str.strip())

# Try different conversions
book1_ids_int = set(col_c.dropna().astype(int).astype(str))
book1_ids_float = set(col_c.dropna().astype(str).str.replace('.0', ''))

print(f"\nBook1 IDs (first 20): {list(book1_ids)[:20]}")
print(f"\nDatabase IDs (first 20): {list(db_ids)[:20]}")

common = book1_ids.intersection(db_ids)
print(f"\n✅ Direct string match: {len(common)} matches")
if common:
    print(f"   Sample matches: {list(common)[:10]}")

common_int = book1_ids_int.intersection(db_ids)
print(f"\n✅ Integer conversion match: {len(common_int)} matches")
if common_int:
    print(f"   Sample matches: {list(common_int)[:10]}")

common_float = book1_ids_float.intersection(db_ids)
print(f"\n✅ Float stripped match: {len(common_float)} matches")
if common_float:
    print(f"   Sample matches: {list(common_float)[:10]}")

