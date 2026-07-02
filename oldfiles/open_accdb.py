#!/usr/bin/env python3
"""
Script to open and explore the Access database on macOS
"""

import subprocess
import sys
import pandas as pd
from pathlib import Path
from io import StringIO

DB_FILE = Path("/Users/curranadvani/Desktop/MichiganClient/PN.accdb copy")
OUTPUT_FILE = Path("/Users/curranadvani/Desktop/MichiganClient/PN_database_export.xlsx")

def check_mdbtools():
    """Check if mdb-tools is installed"""
    try:
        result = subprocess.run(['which', 'mdb-tables'], capture_output=True, text=True)
        return result.returncode == 0
    except:
        return False

def list_tables_mdbtools():
    """List tables using mdb-tools"""
    try:
        result = subprocess.run(
            ['mdb-tables', '-1', str(DB_FILE)],
            capture_output=True,
            text=True,
            check=True
        )
        tables = result.stdout.strip().split('\n')
        return [t for t in tables if t]
    except Exception as e:
        print(f"Error listing tables: {e}")
        return []

def export_table_mdbtools(table_name):
    """Export a table to CSV format using mdb-tools"""
    try:
        result = subprocess.run(
            ['mdb-export', str(DB_FILE), table_name],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout
    except Exception as e:
        print(f"Error exporting table {table_name}: {e}")
        return None

def export_to_excel(tables):
    """Export all tables to an Excel file"""
    print()
    print("=" * 60)
    print(f"Exporting to Excel: {OUTPUT_FILE.name}")
    print("=" * 60)
    
    try:
        # Create Excel writer
        with pd.ExcelWriter(OUTPUT_FILE, engine='openpyxl') as writer:
            for table in tables:
                print(f"Exporting table: {table}...", end=" ")
                csv_data = export_table_mdbtools(table)
                
                if csv_data:
                    # Convert CSV string to DataFrame
                    df = pd.read_csv(StringIO(csv_data))
                    
                    # Write to Excel sheet (sheet name limited to 31 chars)
                    sheet_name = table[:31]
                    df.to_excel(writer, sheet_name=sheet_name, index=False)
                    
                    print(f"✅ ({len(df)} rows)")
                else:
                    print("❌ Failed")
        
        print()
        print(f"✅ Successfully exported to: {OUTPUT_FILE}")
        print(f"   File size: {OUTPUT_FILE.stat().st_size / 1024:.1f} KB")
        return True
        
    except Exception as e:
        print(f"❌ Error exporting to Excel: {e}")
        return False

def main():
    print("Access Database Explorer for macOS")
    print("=" * 60)
    print(f"Database: {DB_FILE}")
    print()
    
    if not DB_FILE.exists():
        print(f"❌ Database file not found: {DB_FILE}")
        return
    
    # Check if mdb-tools is installed
    if check_mdbtools():
        print("✅ mdb-tools is installed")
        print()
        
        # List all tables
        print("Tables in database:")
        print("-" * 60)
        tables = list_tables_mdbtools()
        
        if not tables:
            print("No tables found or error reading database")
            return
        
        for i, table in enumerate(tables, 1):
            print(f"{i}. {table}")
        
        print()
        print("=" * 60)
        print("Preview: First 10 rows from each table:")
        print("=" * 60)
        
        # Preview each table
        for table in tables:
            print(f"\n📊 Table: {table}")
            print("-" * 60)
            csv_data = export_table_mdbtools(table)
            if csv_data:
                lines = csv_data.split('\n')
                # Print first 10 rows
                for line in lines[:11]:  # Header + 10 rows
                    print(line)
                if len(lines) > 11:
                    print(f"... ({len(lines) - 1} total rows)")
        
        # Export to Excel
        export_to_excel(tables)
    else:
        print("❌ mdb-tools is NOT installed")
        print()
        print("To read Access databases on macOS, you need to install mdb-tools:")
        print()
        print("1. First, install Homebrew (if not already installed):")
        print("   /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"")
        print()
        print("2. Then install mdb-tools:")
        print("   brew install mdbtools")
        print()
        print("3. Run this script again")
        print()
        print("⚠️  Note: Installing Homebrew requires admin/sudo access and will prompt for your password")

if __name__ == "__main__":
    main()

