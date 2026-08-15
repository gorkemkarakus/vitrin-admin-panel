-- 20260725000008 businesses tablosunu sutun-seviyesinde kilitlerken o an
-- gercekten kullanilan sutunlari (id, slug, reminder_hours_before,
-- max_users) GRANT etmisti — 'name' o zaman hicbir yerde okunmuyordu.
-- Sonradan Muhasebe/Performans Raporu PDF export'u eklenince
-- (accountingReportPdf.ts, performanceReportPdf.ts) businesses.name
-- okunmaya basladi ama GRANT listesine hic eklenmedi — PDF'ler 403 aliyor,
-- kodda sessizce yutulup 'İşletme' varsayilanina duselerek indiriliyor
-- (fonksiyonel kirilma yok, sadece PDF basligindaki isletme adi yanlis).
-- Ayni guvenlik prensibi korunuyor: sadece GERCEKTEN kullanilan sutun
-- eklendi, blanket bir SELECT acilmiyor.
GRANT SELECT (name) ON public.businesses TO authenticated;

NOTIFY pgrst, 'reload schema';
