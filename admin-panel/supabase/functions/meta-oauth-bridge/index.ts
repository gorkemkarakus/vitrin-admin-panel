import { corsHeaders } from '../_shared/http.ts'

// SADECE mobil uygulama icin: Meta'nin "Valid OAuth Redirect URIs" ayari
// yalnizca https:// kabul ediyor, com.adapptiv.panel:// gibi bir custom
// scheme'i dogrudan kabul etmiyor. Bu fonksiyon HTTPS bir "sicrama" sayfasi
// - Meta buraya yonlendirir, sayfa custom scheme'e sicrar, isletim sistemi
// uygulamayi acar (@capacitor/app'in appUrlOpen dinleyicisi yakalar).
//
// GUVENLIK: query string (code/state/error) SUNUCU TARAFINDA HTML'e
// GOMULMUYOR — donen HTML/JS tamamen SABIT (statik), yonlendirme tarayicinin
// kendi window.location.search'unu OKUYUP OLDUGU GIBI ilettigi icin
// sunucu-tarafi string birlestirme/enjeksiyon riski yok.
const HTML = `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8" /><title>Adapptiv</title></head>
<body>
  <p>Adapptiv uygulamasına dönülüyor…</p>
  <script>
    window.location.href = 'com.adapptiv.panel://ai-ads-callback' + window.location.search;
  </script>
</body>
</html>`

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return new Response(HTML, { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
})
