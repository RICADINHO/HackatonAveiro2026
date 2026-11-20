const env = import.meta.env

const apiBase = typeof env.VITE_API_BASE_URL === 'string'
  && env.VITE_API_BASE_URL.length > 0
  && !env.VITE_API_BASE_URL.includes('example.com')
  ? env.VITE_API_BASE_URL
  : '/api'

export const config = {
  isProduction: env.PROD,
  apiBase,
  supabaseUrl: env.VITE_SUPABASE_URL || 'https://vvokqdzayayfzktkabqa.supabase.co',
  supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
    || 'sb_publishable_tLFd82qfB5miKQWpYATt0g_xQRck8hM',
  cartoApiKey: env.VITE_CARTO_API_KEY || '',
}
