import { corsHeaders, json } from '../_shared/http.ts'
import { requireOperator, requireBusiness, verifyProfileBelongsToBusiness } from '../_shared/operatorAuth.ts'

// TeamPage.tsx'in TÜM okuma/yazmalarının operatör karşılığı. profiles hiç
// is_active filtresiyle çekilmiyor — tenant panel de uygulamıyor, burada da
// aynen bırakıyoruz (kasıtlı fark yaratmamak için).
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
    const [{ data: categories }, { data: services }, { data: employees }, { data: employeeCategories }, { data: schedules }, { data: timeBlocks }] =
      await Promise.all([
        admin.from('service_categories').select('id, name').eq('business_id', business_id).order('name'),
        admin.from('services').select('id, name, category_id, duration_minutes, price').eq('business_id', business_id).order('name'),
        admin.from('profiles').select('id, full_name').eq('business_id', business_id).order('full_name'),
        admin.from('employee_categories').select('profile_id, category_id'),
        admin.from('employee_schedules').select('id, profile_id, day_of_week, starts_at, ends_at'),
        admin.from('employee_time_blocks').select('id, profile_id, day_of_week, block_date, starts_at, ends_at, label'),
      ])

    // employee_categories/schedules/time_blocks dogrudan business_id
    // tasimiyor — bu isletmenin profillerine ait olanlarla client tarafinda
    // degil BURADA elemek gerekiyor (RLS'in dolayli-scope desenini taklit).
    const profileIds = new Set((employees ?? []).map((p) => p.id))
    return json(
      {
        categories: categories ?? [],
        services: services ?? [],
        employees: employees ?? [],
        employeeCategories: (employeeCategories ?? []).filter((ec) => profileIds.has(ec.profile_id)),
        schedules: (schedules ?? []).filter((s) => profileIds.has(s.profile_id)),
        timeBlocks: (timeBlocks ?? []).filter((b) => profileIds.has(b.profile_id)),
      },
      200,
    )
  }

  if (action === 'update_service_category') {
    const { service_id, category_id } = body as { service_id?: string; category_id?: string | null }
    if (!service_id) return json({ error: 'service_id zorunlu' }, 400)
    const { data: service } = await admin.from('services').select('business_id').eq('id', service_id).maybeSingle()
    if (!service || service.business_id !== business_id) return json({ error: 'Bu hizmet bu işletmeye ait değil' }, 403)
    await admin.from('services').update({ category_id: category_id || null }).eq('id', service_id)
    return json({ ok: true }, 200)
  }

  if (action === 'toggle_employee_category') {
    const { profile_id, category_id, checked } = body as { profile_id?: string; category_id?: string; checked?: boolean }
    if (!profile_id || !category_id) return json({ error: 'profile_id ve category_id zorunlu' }, 400)
    if (!(await verifyProfileBelongsToBusiness(admin, profile_id, business_id))) {
      return json({ error: 'Bu personel bu işletmeye ait değil' }, 403)
    }
    if (checked) {
      await admin.from('employee_categories').insert({ profile_id, category_id })
    } else {
      await admin.from('employee_categories').delete().eq('profile_id', profile_id).eq('category_id', category_id)
    }
    return json({ ok: true }, 200)
  }

  if (action === 'add_schedule') {
    const { profile_id, day_of_week, starts_at, ends_at } = body as {
      profile_id?: string
      day_of_week?: number
      starts_at?: string
      ends_at?: string
    }
    if (!profile_id || day_of_week === undefined || !starts_at || !ends_at) {
      return json({ error: 'profile_id, day_of_week, starts_at, ends_at zorunlu' }, 400)
    }
    if (!(await verifyProfileBelongsToBusiness(admin, profile_id, business_id))) {
      return json({ error: 'Bu personel bu işletmeye ait değil' }, 403)
    }
    const { data: existing } = await admin
      .from('employee_schedules')
      .select('id')
      .eq('profile_id', profile_id)
      .eq('day_of_week', day_of_week)
      .maybeSingle()
    if (existing) {
      await admin.from('employee_schedules').update({ starts_at, ends_at }).eq('id', existing.id)
    } else {
      await admin.from('employee_schedules').insert({ profile_id, day_of_week, starts_at, ends_at })
    }
    return json({ ok: true }, 200)
  }

  if (action === 'remove_schedule') {
    const { schedule_id } = body as { schedule_id?: string }
    if (!schedule_id) return json({ error: 'schedule_id zorunlu' }, 400)
    const { data: row } = await admin.from('employee_schedules').select('profile_id').eq('id', schedule_id).maybeSingle()
    if (!row || !(await verifyProfileBelongsToBusiness(admin, row.profile_id, business_id))) {
      return json({ error: 'Bu kayıt bu işletmeye ait değil' }, 403)
    }
    await admin.from('employee_schedules').delete().eq('id', schedule_id)
    return json({ ok: true }, 200)
  }

  if (action === 'add_block') {
    const { profile_id, day_of_week, block_date, starts_at, ends_at, label } = body as {
      profile_id?: string
      day_of_week?: number | null
      block_date?: string | null
      starts_at?: string
      ends_at?: string
      label?: string | null
    }
    if (!profile_id || !starts_at || !ends_at) return json({ error: 'profile_id, starts_at, ends_at zorunlu' }, 400)
    if (!(await verifyProfileBelongsToBusiness(admin, profile_id, business_id))) {
      return json({ error: 'Bu personel bu işletmeye ait değil' }, 403)
    }
    await admin.from('employee_time_blocks').insert({
      profile_id,
      day_of_week: day_of_week ?? null,
      block_date: block_date ?? null,
      starts_at,
      ends_at,
      label: label?.trim() || null,
    })
    return json({ ok: true }, 200)
  }

  if (action === 'remove_block') {
    const { block_id } = body as { block_id?: string }
    if (!block_id) return json({ error: 'block_id zorunlu' }, 400)
    const { data: row } = await admin.from('employee_time_blocks').select('profile_id').eq('id', block_id).maybeSingle()
    if (!row || !(await verifyProfileBelongsToBusiness(admin, row.profile_id, business_id))) {
      return json({ error: 'Bu kayıt bu işletmeye ait değil' }, 403)
    }
    await admin.from('employee_time_blocks').delete().eq('id', block_id)
    return json({ ok: true }, 200)
  }

  return json({ error: 'Bilinmeyen action' }, 400)
})
