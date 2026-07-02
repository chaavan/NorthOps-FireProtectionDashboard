#!/usr/bin/env python3
"""
Apply pricing updates from future_pricing_report and Galloup files
"""

import pandas as pd
import subprocess
from pathlib import Path
from io import StringIO
from datetime import datetime

WORKSPACE = Path("/Users/curranadvani/Desktop/MichiganClient")

# Input files
FUTURE_PRICING_FILE = WORKSPACE / "future_pricing_report_3462 copy.xlsx"
GALLOUP_FILE = WORKSPACE / "116936_GalloupPriceBookfire_922025 copy.xls"
CURRENT_DB_FILE = WORKSPACE / "PN_database_UPDATED.xlsx"  # Already has Book1 updates

# Output file
FINAL_OUTPUT = WORKSPACE / "PN_database_FINAL.xlsx"

def read_current_database():
    """Read the currently updated database (with Book1 updates)"""
    print("=" * 80)
    print("Reading current database (with Book1.xlsx updates already applied)...")
    print("=" * 80)
    
    df = pd.read_excel(CURRENT_DB_FILE, sheet_name='Main')
    print(f"✅ Loaded {len(df)} records from database")
    print(f"   Records with Vendor PartID: {df['Vendor PartID'].notna().sum()}")
    
    return df

def read_future_pricing():
    """Read future pricing report - Column A = Item, Column H = Future Price"""
    print("\n" + "=" * 80)
    print("FILE 1: Reading future_pricing_report_3462 copy.xlsx")
    print("=" * 80)
    
    df = pd.read_excel(FUTURE_PRICING_FILE)
    
    # Column A (index 0) = Item (Vendor PartID)
    # Column H (index 7) = Future Price
    print(f"Total rows: {len(df)}")
    print(f"Using Column A: {df.columns[0]}")
    print(f"Using Column H: {df.columns[7]}")
    
    pricing_df = df[[df.columns[0], df.columns[7]]].copy()
    pricing_df.columns = ['Vendor_PartID', 'New_Price']
    
    # Clean data - skip header rows, remove NaN
    pricing_df = pricing_df.dropna()
    pricing_df['Vendor_PartID'] = pricing_df['Vendor_PartID'].astype(str).str.strip()
    pricing_df['New_Price'] = pd.to_numeric(pricing_df['New_Price'], errors='coerce')
    pricing_df = pricing_df.dropna()
    
    # Remove header row values
    pricing_df = pricing_df[pricing_df['Vendor_PartID'] != 'Item']
    pricing_df = pricing_df[pricing_df['Vendor_PartID'] != 'Future Pricing']
    
    print(f"✅ Found {len(pricing_df)} pricing entries")
    print(f"\nSample data:")
    print(pricing_df.head(10))
    
    return pricing_df

def read_galloup_pricing():
    """Read Galloup file - Column C = ID, Column I = Sell $"""
    print("\n" + "=" * 80)
    print("FILE 2: Reading 116936_GalloupPriceBookfire_922025 copy.xls")
    print("=" * 80)
    
    df = pd.read_excel(GALLOUP_FILE, engine='xlrd')
    
    # Column C (index 2) = ID (Vendor PartID)
    # Column I (index 8) = Sell $
    print(f"Total rows: {len(df)}")
    print(f"Using Column C: {df.columns[2]}")
    print(f"Using Column I: {df.columns[8]}")
    
    pricing_df = df[[df.columns[2], df.columns[8]]].copy()
    pricing_df.columns = ['Vendor_PartID', 'New_Price']
    
    # Clean data - skip header rows, remove NaN
    pricing_df = pricing_df.dropna()
    pricing_df['Vendor_PartID'] = pricing_df['Vendor_PartID'].astype(str).str.strip()
    pricing_df['New_Price'] = pd.to_numeric(pricing_df['New_Price'], errors='coerce')
    pricing_df = pricing_df.dropna()
    
    # Remove header row values
    pricing_df = pricing_df[pricing_df['Vendor_PartID'] != 'ID........']
    
    print(f"✅ Found {len(pricing_df)} pricing entries")
    print(f"\nSample data:")
    print(pricing_df.head(10))
    
    return pricing_df

def apply_updates(db_df, pricing_df, source_name):
    """Apply pricing updates to database"""
    print("\n" + "=" * 80)
    print(f"Applying updates from: {source_name}")
    print("=" * 80)
    
    # Clean database Vendor PartID
    db_df['Vendor PartID'] = db_df['Vendor PartID'].astype(str).str.strip()
    
    updates = []
    matches = 0
    
    for idx, row in pricing_df.iterrows():
        vendor_id = row['Vendor_PartID']
        new_price = row['New_Price']
        
        # Find matching records in database
        mask = db_df['Vendor PartID'] == vendor_id
        matching_count = mask.sum()
        
        if matching_count > 0:
            matches += 1
            
            # Update the cost
            for db_idx in db_df[mask].index:
                old_cost = db_df.loc[db_idx, 'Cost']
                db_df.loc[db_idx, 'Cost'] = new_price
                
                # Try to calculate difference
                try:
                    old_cost_num = float(old_cost) if pd.notna(old_cost) else 0
                    difference = new_price - old_cost_num
                except (ValueError, TypeError):
                    old_cost_num = 0
                    difference = 0
                
                updates.append({
                    'Source': source_name,
                    'PN': db_df.loc[db_idx, 'PN'],
                    'Nomenclature': db_df.loc[db_idx, 'Nomenclature'],
                    'Vendor_PartID': vendor_id,
                    'Old_Cost': old_cost,
                    'New_Cost': new_price,
                    'Difference': difference
                })
    
    # Summary
    print(f"\n📊 Results:")
    print(f"   Total pricing entries: {len(pricing_df)}")
    print(f"   Entries with matches: {matches}")
    print(f"   Total records updated: {len(updates)}")
    print(f"   Pricing entries with no match: {len(pricing_df) - matches}")
    
    if updates:
        updates_df = pd.DataFrame(updates)
        
        print(f"\n✅ Sample Updates Applied:")
        print("=" * 100)
        print(updates_df.head(15).to_string(index=False))
        
        if len(updates) > 15:
            print(f"\n... and {len(updates) - 15} more updates")
        
        # Show summary statistics
        print(f"\n📈 Price Change Statistics:")
        print(f"   Average price change: ${updates_df['Difference'].mean():.2f}")
        print(f"   Largest price increase: ${updates_df['Difference'].max():.2f}")
        print(f"   Largest price decrease: ${updates_df['Difference'].min():.2f}")
    
    return db_df, updates

def save_final_database(db_df, all_updates):
    """Save final updated database to Excel"""
    print("\n" + "=" * 80)
    print("Saving final database with all updates...")
    print("=" * 80)
    
    try:
        # Read other tables from current database
        tables_data = {'Main': db_df}
        
        try:
            tables_data['Code'] = pd.read_excel(CURRENT_DB_FILE, sheet_name='Code')
            tables_data['Price'] = pd.read_excel(CURRENT_DB_FILE, sheet_name='Price')
        except:
            pass
        
        # Write to Excel
        with pd.ExcelWriter(FINAL_OUTPUT, engine='openpyxl') as writer:
            for table_name, df in tables_data.items():
                df.to_excel(writer, sheet_name=table_name, index=False)
            
            # Add summary sheets for each source
            if all_updates:
                all_updates_df = pd.DataFrame(all_updates)
                all_updates_df.to_excel(writer, sheet_name='All_Price_Updates', index=False)
                
                # Separate by source
                for source in all_updates_df['Source'].unique():
                    source_updates = all_updates_df[all_updates_df['Source'] == source]
                    sheet_name = f"Updates_{source[:20]}"  # Limit sheet name length
                    source_updates.to_excel(writer, sheet_name=sheet_name, index=False)
        
        print(f"✅ Final database saved to: {FINAL_OUTPUT.name}")
        print(f"   File size: {FINAL_OUTPUT.stat().st_size / 1024:.1f} KB")
        
        print("\n" + "=" * 80)
        print("📋 SUMMARY OF ALL UPDATES:")
        print("=" * 80)
        
        all_updates_df = pd.DataFrame(all_updates)
        print(f"\nTotal updates applied: {len(all_updates_df)}")
        print(f"\nBreakdown by source:")
        for source in all_updates_df['Source'].unique():
            count = len(all_updates_df[all_updates_df['Source'] == source])
            print(f"   • {source}: {count} updates")
        
        print("\n⚠️  IMPORTANT:")
        print(f"   • Original database unchanged: PN.accdb copy")
        print(f"   • All updates saved to: {FINAL_OUTPUT.name}")
        print(f"   • This includes updates from:")
        print(f"     1. Book1.xlsx (already applied)")
        print(f"     2. future_pricing_report_3462 copy.xlsx (just applied)")
        print(f"     3. 116936_GalloupPriceBookfire_922025 copy.xls (just applied)")
        
        return True
        
    except Exception as e:
        print(f"❌ Error saving: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    print("🔄 APPLYING REMAINING PRICE UPDATES")
    print("=" * 80)
    
    # Read current database (already has Book1 updates)
    db_df = read_current_database()
    
    # Read pricing files
    future_pricing_df = read_future_pricing()
    galloup_pricing_df = read_galloup_pricing()
    
    all_updates = []
    
    # Apply future pricing updates
    db_df, updates1 = apply_updates(db_df, future_pricing_df, "future_pricing_report_3462")
    all_updates.extend(updates1)
    
    # Apply Galloup pricing updates
    db_df, updates2 = apply_updates(db_df, galloup_pricing_df, "116936_GalloupPriceBookfire")
    all_updates.extend(updates2)
    
    # Save final result
    save_final_database(db_df, all_updates)
    
    print("\n✅ ALL UPDATES COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    main()

