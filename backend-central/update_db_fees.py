import sqlite3
import os

db_path = "data/central.db"

if not os.path.exists(db_path):
    print(f"Database file not found at {db_path}")
    exit(1)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if 'fee' column exists before trying to update
    # Although we know it exists, it's safer.
    # Actually, we just removed the 'fee' column from the CREATE TABLE statement in database.py
    # but the existing file still has it.
    
    print("Updating 'fee' to 0 for all records in 'history' table...")
    cursor.execute("UPDATE history SET fee = 0")
    rows = cursor.rowcount
    
    conn.commit()
    conn.close()
    
    print(f"Successfully updated {rows} records.")
    
except Exception as e:
    print(f"Error updating database: {e}")
