// Form alanlarinin en fazla karakter sayilari. Veritabanindaki CHECK
// kisitlariyla (migration 20261017000001) ayni degerler; degisirse ikisi
// birlikte degismeli.
export const FIELD_LIMITS = {
  appointmentsNotes: 1000,
  appointmentsSourceNote: 300,
  businessExpensesCategory: 60,
  businessExpensesDescription: 200,
  businessHolidaysName: 100,
  businessesName: 120,
  campaignMessageTemplatesMessage: 1000,
  campaignMessageTemplatesTitle: 120,
  cashClosuresNote: 1000,
  customerGroupsDescription: 300,
  customerGroupsName: 80,
  customersContactPhone: 32,
  customersEmail: 254,
  customersFullName: 120,
  customersNotes: 2000,
  customersPhone: 64,
  employeeTimeBlocksLabel: 80,
  paymentsNote: 300,
  profilesFullName: 120,
  profilesWhatsappPhone: 32,
  serviceCategoriesName: 80,
  servicePackagesNote: 500,
  servicesDescription: 2000,
  servicesName: 80,
  // Veritabaninda karsiligi olmayan alanlar
  aiPrompt: 300,
  search: 100,
  email: 254,
  // bcrypt 72 bayttan sonrasini kullanmaz
  password: 72,
} as const
