// Senaryolar hafta ici icin yazildi ("yarın" acik gun). Hafta sonu
// calistirilinca saat bir onceki cumaya kaydirilir (pazartesi/persembe
// denendi: "pazartesi" bugune, "bir hafta sonra" tatile denk geliyordu); bot,
// sahte salon ve senaryolar ayni kaydirilmis saati gorur. run.ts'te ILK import olmali.
const RealDate = Date
const istDay = new RealDate(RealDate.now() + 3 * 3600000).getUTCDay()
const SHIFT_DAYS = istDay === 6 ? 1 : istDay === 0 ? 2 : 0
const SHIFT = SHIFT_DAYS * 86400000

if (SHIFT) {
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() - SHIFT)
      else super(...(args as [string]))
    }
    static override now() {
      return RealDate.now() - SHIFT
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor
  console.log(`hafta sonu: saat ${SHIFT_DAYS} gun geri (cuma) kaydirildi`)
}
