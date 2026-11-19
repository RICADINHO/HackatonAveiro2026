import { createClient } from '@supabase/supabase-js'
import { config } from '../../src/config.ts'

const { supabaseUrl: url, supabasePublishableKey: key } = config

export const supabase = url && key ? createClient(url, key) : null
