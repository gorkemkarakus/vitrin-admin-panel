-- Test sırasında bulundu: businesses.api_key_hash sutunu, o isletmenin
-- HERHANGI bir calisaninin (sadece admin degil, RLS sadece satir bazinda
-- kontrol ediyor) normal bir REST sorgusuyla (?select=api_key_hash)
-- gorebilecegi, hatta admin'in UPDATE edebilecegi sekilde acikti. Bu bir
-- SHA-256 hash oldugu icin dogrudan somurulebilir degil (orijinal anahtar
-- geri cikarilamaz) ama gereksiz bilgi sizintisi ve yanlislikla ustune
-- yazilma riski tasiyordu. Sutun seviyesinde kilitleniyor — service_role
-- (book-appointment/chatbot-* fonksiyonlarinin anahtar dogrulamasi) ve
-- postgres disinda kimse bu sutuna erisemez, RLS'in kendisi (diger tum
-- sutunlar icin) etkilenmez.
REVOKE SELECT (api_key_hash), INSERT (api_key_hash), UPDATE (api_key_hash), REFERENCES (api_key_hash)
  ON public.businesses FROM anon, authenticated;
