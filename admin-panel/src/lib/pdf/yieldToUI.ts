// PDF olusturma senkron/agir isler icerir (autoTable duzeni, font gomme).
// Bunlarin arasinda tarayiciya kisa bir mola vermezsek React ilerleme
// yuzdesini hic boyayamaz ve bar 0'dan 100'e direkt ziplar. Her bolum
// (ör. her calisan/tablo) arasinda bunu await etmek UI'in nefes almasini
// saglar.
export function yieldToUI() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}
