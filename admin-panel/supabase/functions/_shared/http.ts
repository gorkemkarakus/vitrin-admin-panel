// Bu dosyayi ONLY curl/n8n gibi tarayici-disi cagiranlar kullaniyordu — CORS
// preflight hic devreye girmiyordu. Herkese acik randevu sayfasi ilk GERCEK
// taraycidan gelen cagiran; supabase-js'in functions.invoke() 'apikey' ve
// 'x-client-info' header'larini da gonderiyor, bunlar izin verilenler
// listesinde olmayinca taraycii preflight'ta istegi SESSIZCE engelliyordu
// (curl/n8n CORS uygulamadigi icin bu hic fark edilmemisti).
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, apikey, x-client-info, content-type',
}

export function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
