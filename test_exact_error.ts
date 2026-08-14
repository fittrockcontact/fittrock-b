import dotenv from 'dotenv';
dotenv.config({ path: './backend/.env' });
import postgres from 'postgres';

async function testConnection() {
  const url = process.env.DATABASE_URL;
  console.log('DATABASE_URL from backend/.env:', url?.replace(/:[^:@]+@/, ':****@'));

  if (!url || url.includes('YOUR_SUPABASE_DB_PASSWORD')) {
    console.error('❌ ERROR: DATABASE_URL still contains placeholder YOUR_SUPABASE_DB_PASSWORD!');
    process.exit(1);
  }

  try {
    const isSupabase = url.includes('supabase');
    const client = postgres(url, { max: 1, prepare: false, ssl: isSupabase ? 'require' : false });
    const res = await client`SELECT * FROM public.products LIMIT 1;`;
    console.log('✅ SUCCESS! Connected to Supabase DB and retrieved products:', res);
    await client.end();
    process.exit(0);
  } catch (err: any) {
    console.error('❌ DIRECT DB ERROR:', err);
    process.exit(1);
  }
}

testConnection();
