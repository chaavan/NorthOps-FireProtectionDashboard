#!/usr/bin/env python3
"""
Examine the two remaining pricing files to understand their structure
"""

import pandas as pd
from pathlib import Path

WORKSPACE = Path("/Users/curranadvani/Desktop/MichiganClient")

print("=" * 80)
print("FILE 1: future_pricing_report_3462 copy.xlsx")
print("=" * 80)

try:
    df1 = pd.read_excel(WORKSPACE / "future_pricing_report_3462 copy.xlsx")
    
    print(f"\nShape: {df1.shape} (rows, columns)")
    print(f"\nColumns: {list(df1.columns)}")
    
    print("\n" + "=" * 80)
    print("Column mapping for future_pricing_report_3462:")
    print("=" * 80)
    for idx, col in enumerate(df1.columns):
        letter = chr(65 + idx)  # A=65, B=66, etc.
        print(f"  Column {letter}: {col}")
    
    print("\n" + "=" * 80)
    print("First 25 rows:")
    print("=" * 80)
    pd.set_option('display.max_columns', None)
    pd.set_option('display.width', None)
    pd.set_option('display.max_colwidth', 50)
    print(df1.head(25).to_string())
    
    print("\n" + "=" * 80)
    print("Sample of non-null data from each column:")
    print("=" * 80)
    for col in df1.columns:
        non_null = df1[col].dropna().head(5)
        if len(non_null) > 0:
            print(f"\n{col}:")
            for val in non_null:
                print(f"  - {val}")
    
except Exception as e:
    print(f"Error reading file: {e}")

print("\n\n")
print("=" * 80)
print("FILE 2: 116936_GalloupPriceBookfire_922025 copy.xls")
print("=" * 80)

try:
    df2 = pd.read_excel(WORKSPACE / "116936_GalloupPriceBookfire_922025 copy.xls", engine='xlrd')
    
    print(f"\nShape: {df2.shape} (rows, columns)")
    print(f"\nColumns: {list(df2.columns)}")
    
    print("\n" + "=" * 80)
    print("Column mapping for 116936_GalloupPriceBookfire_922025:")
    print("=" * 80)
    for idx, col in enumerate(df2.columns):
        letter = chr(65 + idx)  # A=65, B=66, etc.
        print(f"  Column {letter}: {col}")
    
    print("\n" + "=" * 80)
    print("First 25 rows:")
    print("=" * 80)
    print(df2.head(25).to_string())
    
    print("\n" + "=" * 80)
    print("Sample of non-null data from each column:")
    print("=" * 80)
    for col in df2.columns:
        non_null = df2[col].dropna().head(5)
        if len(non_null) > 0:
            print(f"\n{col}:")
            for val in non_null:
                print(f"  - {val}")
    
except Exception as e:
    print(f"Error reading file: {e}")

