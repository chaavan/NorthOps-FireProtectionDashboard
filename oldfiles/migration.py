import pandas as pd
from sqlalchemy import create_engine
# Replace with your Railway connection string
db_url = "postgresql://postgres:cqeXsdxqNyZJUTeRupsPiNzDrCUBIsZq@shortline.proxy.rlwy.net:31216/railway"
engine = create_engine(db_url)
df = pd.read_csv('oldfiles/parts.csv')
# Define table name and schema if needed, or let pandas infer
df.to_sql('parts', engine, if_exists='append', index=False)