import { corsHeaders, json } from '../_shared/http.ts'
import { requireOperator, requireBusiness, verifyProfileBelongsToBusiness } from '../_shared/operatorAuth.ts'

const SLOT_MINUTES = 30

// AppointmentsPage.tsx'in operatör karşılığı. Mevcut RLS'te bile
// employee_id/service_id/customer_id'nin appointments.business_id ile
// GERÇEKTEN eşleştiği FK seviyesinde doğrulanmıyor — operatör panelinde
// aynı oturumda birden fazla business_id dolaştığı için bu çok daha kolay
// yanlışlıkla tetiklenir, bu yüzden create burada HER üçünü de elle doğrular.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireOperator(req)
  if (!auth.ok) return auth.response
  const { admin } = auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const action = body.action as string | undefined
  const business_id = body.business_id as string | undefined
  if (!action || !business_id) return json({ error: 'action ve business_id zorunlu' }, 400)
  if (!(await requireBusiness(admin, business_id))) return json({ error: 'İşletme bulunamadı' }, 404)

  if (action === 'load') {
    const [{ data: appointments }, { data: customers }, { data: services }, { data: profiles }, { data: employeeCategories }, { data: schedules }, { data: timeBlocks }] =
      await Promise.all([
        admin
          .from('appointments')
          .select('id, customer_id, service_id, employee_id, created_by_user_id, scheduled_at, duration_minutes, status, source, source_note')
          .eq('business_id', business_id)
          .order('scheduled_at', { ascending: true }),
        admin.from('customers').select('id, full_name, phone').eq('business_id', business_id).order('full_name'),
        admin.from('services').select('id, name, duration_minutes, price, category_id').eq('business_id', business_id).eq('is_active', true).order('name'),
        admin.from('profiles').select('id, full_name').eq('business_id', business_id),
        admin.from('employee_categories').select('profile_id, category_id'),
        admin.from('employee_schedules').select('profile_id, day_of_week, starts_at, ends_at'),
        admin.from('employee_time_blocks').select('profile_id, day_of_week, block_date, starts_at, ends_at'),
      ])

    const profileIds = new Set((profiles ?? []).map((p) => p.id))
    return json(
      {
        appointments: appointments ?? [],
        customers: customers ?? [],
        services: services ?? [],
        profiles: profiles ?? [],
        employeeCategories: (employeeCategories ?? []).filter((ec) => profileIds.has(ec.profile_id)),
        schedules: (schedules ?? []).filter((s) => profileIds.has(s.profile_id)),
        timeBlocks: (timeBlocks ?? []).filter((b) => profileIds.has(b.profile_id)),
      },
      200,
    )
  }

  if (action === 'create') {
    const {
      customer_id,
      new_customer_name,
      new_customer_phone,
      service_id,
      employee_id,
      scheduled_at,
      duration_minutes,
      source,
      source_note,
    } = body as {
      customer_id?: string
      new_customer_name?: string
      new_customer_phone?: string
      service_id?: string
      employee_id?: string
      scheduled_at?: string
      duration_minutes?: number
      source?: string
      source_note?: string
    }

    if (!service_id || !scheduled_at) return json({ error: 'service_id ve scheduled_at zorunlu' }, 400)

    const { data: service } = await admin.from('services').select('business_id, duration_minutes').eq('id', service_id).maybeSingle()
    if (!service || service.business_id !== business_id) return json({ error: 'Bu hizmet bu işletmeye ait değil' }, 403)

    if (employee_id && !(await verifyProfileBelongsToBusiness(admin, employee_id, business_id))) {
      return json({ error: 'Bu çalışan bu işletmeye ait değil' }, 403)
    }

    let finalCustomerId = customer_id
    if (new_customer_name?.trim()) {
      const { data: newCustomer, error: custErr } = await admin
        .from('customers')
        .insert({ business_id, full_name: new_customer_name.trim(), phone: new_customer_phone?.trim() || null })
        .select('id')
        .single()
      if (custErr || !newCustomer) {
        console.error('operator-appointments customer insert error:', custErr?.message)
        return json({ error: 'Müşteri oluşturulamadı' }, 400)
      }
      finalCustomerId = newCustomer.id
    } else if (customer_id) {
      const { data: customer } = await admin.from('customers').select('business_id').eq('id', customer_id).maybeSingle()
      if (!customer || customer.business_id !== business_id) return json({ error: 'Bu müşteri bu işletmeye ait değil' }, 403)
    } else {
      return json({ error: 'customer_id veya new_customer_name zorunlu' }, 400)
    }

    const { error: apptErr } = await admin.from('appointments').insert({
      business_id,
      customer_id: finalCustomerId,
      service_id,
      employee_id: employee_id || null,
      // Operatör tenant'ın kendi profiles'ında yok — bunu operatörün kendi
      // auth.uid()'i ile doldurmak Dashboard'daki bot/personel ayrımını
      // bozar (public-book-appointment'taki gibi null bırakılır).
      created_by_user_id: null,
      scheduled_at,
      duration_minutes: duration_minutes ?? service.duration_minutes ?? SLOT_MINUTES,
      source: source || 'kullanici_uzerinden',
      source_note: source_note?.trim() || null,
    })

    if (apptErr) {
      const isOverlap = /exclusion|conflicting key|deadlock/i.test(apptErr.message)
      if (!isOverlap) console.error('operator-appointments insert error:', apptErr.message)
      return json(
        {
          error: isOverlap
            ? 'Seçilen çalışan bu saatte az önce başka bir randevuyla dolmuş. Lütfen farklı bir saat seçin.'
            : 'Randevu oluşturulamadı, lütfen tekrar deneyin.',
        },
        400,
      )
    }
    return json({ ok: true }, 200)
  }

  if (action === 'update_status') {
    const { appointment_id, status } = body as { appointment_id?: string; status?: string }
    if (!appointment_id || !status) return json({ error: 'appointment_id ve status zorunlu' }, 400)
    const { data: appt } = await admin.from('appointments').select('business_id').eq('id', appointment_id).maybeSingle()
    if (!appt || appt.business_id !== business_id) return json({ error: 'Bu randevu bu işletmeye ait değil' }, 403)
    await admin.from('appointments').update({ status }).eq('id', appointment_id)
    return json({ ok: true }, 200)
  }

  return json({ error: 'Bilinmeyen action' }, 400)
})
