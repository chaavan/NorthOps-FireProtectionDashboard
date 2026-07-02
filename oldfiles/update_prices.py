#!/usr/bin/env python3
"""
Script to update prices in the Access database copy based on Excel files
"""

import pandas as pd
import pyodbc
import sys
from pathlib import Path

# File paths
WORKSPACE = Path("/Users/curranadvani/Desktop/MichiganClient")
DB_FILE = WORKSPACE / "PN.accdb copy"
EXCEL_FILES = [
    WORKSPACE / "116936_GalloupPriceBookfire_922025 copy.xls",
    WORKSPACE / "Book1 copy.xlsx",
    WORKSPACE / "future_pricing_report_3462 copy.xlsx"
]

def read_excel_files():
    """Read all Excel files and compile pricing data"""
    all_pricing_data = {}
    
    for excel_file in EXCEL_FILES:
        if not excel_file.exists(): # If the file does not exist, print a warning
            print(f"Warning: {excel_file.name} not found")
            continue
            
        print(f"\n{'='*60}") # Print a separator
        print(f"Reading: {excel_file.name}")
        print(f"{'='*60}")
        
        try:
            # Try reading with xlrd for .xls files, openpyxl for .xlsx
            if excel_file.suffix == '.xls':
                df = pd.read_excel(excel_file, engine='xlrd')
            else:
                df = pd.read_excel(excel_file, engine='openpyxl')
            
            print(f"Shape: {df.shape}")
            print(f"\nColumns: {list(df.columns)}")
            print(f"\nFirst few rows:")
            print(df.head())
            
            # Store the dataframe with the filename as key
            all_pricing_data[excel_file.name] = df
            
        except Exception as e:
            print(f"Error reading {excel_file.name}: {e}")
    
    return all_pricing_data

def read_database_tables():
    """Read the Access database and show its structure"""
    try:
        # Connect to Access database
        conn_str = (
            r'DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};'
            f'DBQ={DB_FILE};'
        )
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        # Get all tables
        tables = [table.table_name for table in cursor.tables(tableType='TABLE')]
        print(f"\n{'='*60}")
        print(f"Database Tables in PN.accdb copy:")
        print(f"{'='*60}")
        
        db_data = {}
        for table in tables:
            print(f"\nTable: {table}")
            try:
                # Get table structure
                cursor.execute(f"SELECT * FROM [{table}]")
                columns = [column[0] for column in cursor.description]
                print(f"Columns: {columns}")
                
                # Get row count
                cursor.execute(f"SELECT COUNT(*) FROM [{table}]")
                count = cursor.fetchone()[0]
                print(f"Row count: {count}")
                
                # Get sample data
                df = pd.read_sql(f"SELECT * FROM [{table}]", conn)
                print(f"\nFirst few rows:")
                print(df.head())
                
                db_data[table] = df
                
            except Exception as e:
                print(f"Error reading table {table}: {e}")
        
        conn.close()
        return db_data
        
    except Exception as e:
        print(f"Error connecting to database: {e}")
        print("\nNote: This requires Microsoft Access drivers to be installed.")
        print("On macOS, you might need to use mdbtools or convert the database.")
        return None

def main():
    print("Starting price update process...")
    print(f"Working directory: {WORKSPACE}")
    
    # Step 1: Read Excel files
    print("\n" + "="*60)
    print("STEP 1: Reading Excel pricing files")
    print("="*60)
    excel_data = read_excel_files()
    
    # Step 2: Read database
    print("\n" + "="*60)
    print("STEP 2: Reading Access database")
    print("="*60)
    db_data = read_database_tables()
    
    if db_data is None:
        print("\n⚠️  Unable to read database. Please check if Access drivers are installed.")
        return
    
    # Step 3: Analyze and prepare for matching
    print("\n" + "="*60)
    print("STEP 3: Analysis complete - ready for price updates")
    print("="*60)
    print("\nPlease review the data above and confirm:")
    print("1. Which columns contain the item names/identifiers?")
    print("2. Which columns contain the prices to update?")
    print("3. Which Excel file should be the source of truth?")

if __name__ == "__main__":
    main()

