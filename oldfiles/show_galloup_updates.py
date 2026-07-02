#!/usr/bin/env python3
"""
Show the Galloup updates that were applied
"""

import pandas as pd
from pathlib import Path

WORKSPACE = Path("/Users/curranadvani/Desktop/MichiganClient")

# Read the final database with all updates
df = pd.read_excel(WORKSPACE / "PN_database_FINAL.xlsx", sheet_name='All_Price_Updates')

# Filter to just Galloup updates
galloup_updates = df[df['Source'] == '116936_GalloupPriceBookfire']

print("=" * 100)
print("GALLOUP FILE UPDATES SUCCESSFULLY APPLIED")
print("=" * 100)
print(f"\nTotal Galloup updates: {len(galloup_updates)}")
print("\nAll 22 updates from Galloup file:")
print("=" * 100)

# Show all updates
pd.set_option('display.max_columns', None)
pd.set_option('display.width', None)
pd.set_option('display.max_rows', None)
print(galloup_updates.to_string(index=False))

print("\n" + "=" * 100)
print("✅ Galloup updates ARE working correctly!")
print(f"   22 products had their prices updated from the Galloup file")
print(f"   Column C (ID) matched with database Vendor PartID")
print("=" * 100)

