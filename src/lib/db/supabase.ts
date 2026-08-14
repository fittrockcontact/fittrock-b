import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://afaudkttznoaqnbdcosi.supabase.co';

const keyCandidate =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

export const supabaseClient =
  keyCandidate && !keyCandidate.includes('placeholder')
    ? createClient(supabaseUrl, keyCandidate)
    : null;
