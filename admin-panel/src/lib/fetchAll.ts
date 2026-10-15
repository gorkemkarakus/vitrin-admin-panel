// Supabase (PostgREST) tek istekte en fazla 1000 satir dondurur (proje
// ayari "Max rows"). Tum randevulari/odemeleri/musterileri tek sorguda ceken
// ekranlar bu sinira ulasinca SESSIZCE kesiliyordu — ornegin Randevular
// ekrani tarih sirasindaki ilk 1000 randevuyu gosterip en yenilerini hic
// gostermiyor, musteri borclari eksik hesaplaniyordu. Bu yardimci ayni
// sorguyu 1000'erlik sayfalarla tekrar tekrar calistirip hepsini toplar.
//
// `build` her cagrida YENI bir sorgu dondurmeli (builder tekrar
// kullanilamaz) ve sayfalarin kaymamasi icin sorgu sabit bir siralamaya
// sahip olmali — siralama verilmediyse en azindan `.order('id')` eklenmeli.
const PAGE_SIZE = 1000

interface RangeQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

export async function fetchAll<T>(build: () => RangeQuery<T>): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) return { data: rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { data: rows, error: null }
  }
}
