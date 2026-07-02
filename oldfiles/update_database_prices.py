#!/usr/bin/env python3
"""
Script to update prices in Access database based on Book1.xlsx matches
"""

import pandas as pd
import subprocess
from pathlib import Path
from io import StringIO
from datetime import datetime

# File paths
WORKSPACE = Path("/Users/curranadvani/Desktop/MichiganClient")
BOOK1_FILE = WORKSPACE / "Book1.xlsx"
DB_FILE = WORKSPACE / "PN.accdb copy"
BACKUP_FILE = WORKSPACE / f"PN.accdb_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
UPDATED_EXCEL = WORKSPACE / "PN_database_UPDATED.xlsx"

def read_book1_pricing():
    """Read pricing data from Book1.xlsx"""
    print("=" * 60)
    print("Reading Book1.xlsx pricing data...")
    print("=" * 60)
    
    df = pd.read_excel(BOOK1_FILE)
    
    # Column C (index 2) = Vendor PartID
    # Column D (index 3) = New Price
    pricing_df = df[[df.columns[2], df.columns[3]]].copy()
    pricing_df.columns = ['Vendor_PartID', 'New_Price']
    
    # Clean data - remove NaN and convert to proper types
    pricing_df = pricing_df.dropna()
    # Convert float to int then to string to remove .0 (54350.0 -> '54350')
    pricing_df['Vendor_PartID'] = pricing_df['Vendor_PartID'].astype(int).astype(str).str.strip()
    pricing_df['New_Price'] = pd.to_numeric(pricing_df['New_Price'], errors='coerce')
    pricing_df = pricing_df.dropna()
    
    print(f"✅ Found {len(pricing_df)} pricing entries in Book1.xlsx")
    print(f"\nSample data:")
    print(pricing_df.head(10))
    
    return pricing_df

def read_database_main():
    """Read Main table from Access database"""
    print("\n" + "=" * 60)
    print("Reading database Main table...")
    print("=" * 60)
    
    try:
        result = subprocess.run(
            ['mdb-export', str(DB_FILE), 'Main'],
            capture_output=True,
            text=True,
            check=True
        )
        
        df = pd.read_csv(StringIO(result.stdout))
        
        print(f"✅ Found {len(df)} records in database")
        print(f"   Records with Vendor PartID: {df['Vendor PartID'].notna().sum()}")
        
        return df
        
    except Exception as e:
        print(f"❌ Error reading database: {e}")
        return None

def match_and_update(db_df, pricing_df):
    """Match pricing data with database and update costs"""
    print("\n" + "=" * 60)
    print("Matching and updating prices...")
    print("=" * 60)
    
    # Clean database Vendor PartID
    db_df['Vendor PartID'] = db_df['Vendor PartID'].astype(str).str.strip()
    
    # Create a copy for comparison
    original_costs = db_df['Cost'].copy()
    
    # Track changes
    matches = []
    updates = []
    
    for idx, row in pricing_df.iterrows():
        vendor_id = row['Vendor_PartID']
        new_price = row['New_Price']
        
        # Find matching records in database
        mask = db_df['Vendor PartID'] == vendor_id
        matching_count = mask.sum()
        
        if matching_count > 0:
            matches.append({
                'Vendor_PartID': vendor_id,
                'Matches': matching_count,
                'New_Price': new_price
            })
            
            # Update the cost
            for db_idx in db_df[mask].index:
                old_cost = db_df.loc[db_idx, 'Cost']
                db_df.loc[db_idx, 'Cost'] = new_price
                
                # Try to calculate difference, handle non-numeric old costs
                try:
                    old_cost_num = float(old_cost) if pd.notna(old_cost) else 0
                    difference = new_price - old_cost_num
                except (ValueError, TypeError):
                    old_cost_num = 0
                    difference = 0
                
                updates.append({
                    'PN': db_df.loc[db_idx, 'PN'],
                    'Nomenclature': db_df.loc[db_idx, 'Nomenclature'],
                    'Vendor_PartID': vendor_id,
                    'Old_Cost': old_cost,
                    'New_Cost': new_price,
                    'Difference': difference
                })
    
    # Summary
    print(f"\n📊 Matching Results:")
    print(f"   Total pricing entries in Book1: {len(pricing_df)}")
    print(f"   Entries with matches in database: {len(matches)}")
    print(f"   Total database records updated: {len(updates)}")
    print(f"   Pricing entries with no match: {len(pricing_df) - len(matches)}")
    
    if updates:
        updates_df = pd.DataFrame(updates)
        
        print(f"\n✅ Price Updates Applied:")
        print("=" * 100)
        print(updates_df.to_string(index=False, max_rows=20))
        
        if len(updates) > 20:
            print(f"\n... and {len(updates) - 20} more updates")
        
        # Show summary statistics
        print(f"\n📈 Price Change Statistics:")
        print(f"   Average price increase: ${updates_df['Difference'].mean():.2f}")
        print(f"   Largest price increase: ${updates_df['Difference'].max():.2f}")
        print(f"   Largest price decrease: ${updates_df['Difference'].min():.2f}")
    
    return db_df, updates

def save_updated_database(db_df, updates):
    """Save updated database to Excel"""
    print("\n" + "=" * 60)
    print("Saving updated database...")
    print("=" * 60)
    
    try:
        # Also read other tables
        tables_data = {'Main': db_df}
        
        for table_name in ['Code', 'Price']:
            try:
                result = subprocess.run(
                    ['mdb-export', str(DB_FILE), table_name],
                    capture_output=True,
                    text=True,
                    check=True
                )
                tables_data[table_name] = pd.read_csv(StringIO(result.stdout))
            except:
                pass
        
        # Write to Excel
        with pd.ExcelWriter(UPDATED_EXCEL, engine='openpyxl') as writer:
            for table_name, df in tables_data.items():
                df.to_excel(writer, sheet_name=table_name, index=False)
            
            # Add summary sheet
            if updates:
                updates_df = pd.DataFrame(updates)
                updates_df.to_excel(writer, sheet_name='Price_Changes_Summary', index=False)
        
        print(f"✅ Updated database saved to: {UPDATED_EXCEL.name}")
        print(f"   File size: {UPDATED_EXCEL.stat().st_size / 1024:.1f} KB")
        
        print("\n⚠️  IMPORTANT:")
        print(f"   • Original database unchanged: {DB_FILE.name}")
        print(f"   • Updated data saved to: {UPDATED_EXCEL.name}")
        print(f"   • Review the changes, then you can:")
        print(f"     1. Use the Excel file directly, OR")
        print(f"     2. Import it back into Access if needed")
        
        return True
        
    except Exception as e:
        print(f"❌ Error saving: {e}")
        return False

def main():
    print("🔄 DATABASE PRICE UPDATE PROCESS")
    print("=" * 60)
    print(f"Source: {BOOK1_FILE.name}")
    print(f"Target: {DB_FILE.name}")
    print("=" * 60)
    
    # Read data
    pricing_df = read_book1_pricing()
    db_df = read_database_main()
    
    if db_df is None:
        print("\n❌ Failed to read database")
        return
    
    # Match and update
    updated_db_df, updates = match_and_update(db_df, pricing_df)
    
    if not updates:
        print("\n⚠️  No matching records found to update")
        return
    
    # Save results
    save_updated_database(updated_db_df, updates)
    
    print("\n✅ Process completed successfully!")

if __name__ == "__main__":
    main()

