#!/usr/bin/env python3
"""
Script to match Book1.xlsx prices with Access database by Vendor PartID
"""

import pandas as pd
import subprocess
from pathlib import Path
from io import StringIO

# File paths
WORKSPACE = Path("/Users/curranadvani/Desktop/MichiganClient")
BOOK1_FILE = WORKSPACE / "Book1.xlsx"
DB_FILE = WORKSPACE / "PN.accdb copy"

def read_book1():
    """Read Book1.xlsx and examine structure"""
    print("=" * 60)
    print("STEP 1: Reading Book1.xlsx")
    print("=" * 60)
    
    df = pd.read_excel(BOOK1_FILE)
    
    print(f"\nShape: {df.shape}")
    print(f"\nColumns: {list(df.columns)}")
    print(f"\nFirst 20 rows:")
    print(df.head(20).to_string())
    
    # Also print column letters to make it clear
    print("\n\nColumn mapping:")
    for idx, col in enumerate(df.columns):
        letter = chr(65 + idx)  # A=65, B=66, etc.
        print(f"  Column {letter}: {col}")
    
    return df

def read_database_main_table():
    """Read Main table from Access database"""
    print("\n" + "=" * 60)
    print("STEP 2: Reading Access database Main table")
    print("=" * 60)
    
    try:
        result = subprocess.run(
            ['mdb-export', str(DB_FILE), 'Main'],
            capture_output=True,
            text=True,
            check=True
        )
        
        df = pd.read_csv(StringIO(result.stdout))
        
        print(f"\nShape: {df.shape}")
        print(f"\nColumns: {list(df.columns)}")
        print(f"\nFirst 10 rows:")
        print(df.head(10).to_string())
        
        return df
        
    except Exception as e:
        print(f"Error reading database: {e}")
        return None

def main():
    print("Price Matching and Update Process")
    print("=" * 60)
    
    # Read both files
    book1_df = read_book1()
    db_df = read_database_main_table()
    
    if db_df is None:
        print("\n❌ Failed to read database")
        return
    
    # Now let's identify the columns
    print("\n" + "=" * 60)
    print("STEP 3: Analyzing data for matching")
    print("=" * 60)
    
    print("\n📋 Book1.xlsx structure:")
    print(f"   Total rows: {len(book1_df)}")
    print(f"   Column C (index 2): {book1_df.columns[2] if len(book1_df.columns) > 2 else 'N/A'}")
    
    print("\n📋 Database Main table structure:")
    print(f"   Total rows: {len(db_df)}")
    if 'Vendor PartID' in db_df.columns:
        print(f"   Vendor PartID column exists: ✅")
        print(f"   Non-null Vendor PartID entries: {db_df['Vendor PartID'].notna().sum()}")
    else:
        print(f"   Vendor PartID column exists: ❌")
    
    # Show sample data to verify matching
    print("\n" + "=" * 60)
    print("Sample data for verification:")
    print("=" * 60)
    
    if len(book1_df.columns) > 2:
        col_c_name = book1_df.columns[2]
        print(f"\nSample from Book1.xlsx Column C ({col_c_name}):")
        print(book1_df[col_c_name].dropna().head(10).to_string())
    
    if 'Vendor PartID' in db_df.columns:
        print(f"\nSample from Database Vendor PartID:")
        print(db_df['Vendor PartID'].dropna().head(10).to_string())

if __name__ == "__main__":
    main()

