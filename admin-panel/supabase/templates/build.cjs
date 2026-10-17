const fs = require('fs')
// E-posta sablonlarini uretir: node supabase/templates/build.cjs
// Ciktilar Supabase Dashboard > Authentication > Emails > Templates'e yapistirilir.
const OUT = __dirname + '/'
const LOGO = 'https://www.adapptivdigital.com/assets/logo.png'
const NAVY = '#13284f'
const ORANGE = '#ff6a13'
const FONT = "'Segoe UI', Helvetica, Arial, sans-serif"

function steps(items) {
  return `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;background:#f5f6f8;border-radius:16px;">
                  <tr><td style="padding:18px 20px 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Doğruladıktan sonra</td></tr>
${items
  .map(
    (t, i) => `                  <tr>
                    <td style="padding:6px 20px ${i === items.length - 1 ? '18px' : '6px'};">
                      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                        <td width="26" valign="top" style="width:26px;"><div style="width:26px;height:26px;line-height:26px;border-radius:13px;background:${NAVY};color:#ffffff;text-align:center;font-family:${FONT};font-size:12px;font-weight:700;">${i + 1}</div></td>
                        <td valign="middle" style="padding-left:12px;font-family:${FONT};font-size:14px;line-height:1.5;color:#374151;">${t}</td>
                      </tr></table>
                    </td>
                  </tr>`,
  )
  .join('\n')}
                </table>`
}

function layout({ dashboard, subject, preheader, eyebrow, title, body, button, extra = '', footnote }) {
  return `<!--
  Supabase Dashboard > Authentication > Emails > Templates > "${dashboard}"
  Konu: ${subject}
  Bu dosyanin TAMAMINI sablon alanina yapistirin. Logo tanitim sitesinden
  yuklenir (${LOGO}); dosya tasinirsa burayi da guncelleyin.
-->
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef1f6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef1f6;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;">
      <tr>
        <td align="center" style="padding:36px 16px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
            <tr>
              <td align="center" style="padding:0 0 24px;">
                <img src="${LOGO}" width="150" height="42" alt="Adapptiv" style="display:block;width:150px;height:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border-radius:24px;border:1px solid #e3e7ee;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:32px 32px 34px;">
                      <span style="display:inline-block;background:#fff4ec;color:#b4470a;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:6px 12px;border-radius:999px;">${eyebrow}</span>
                      <h1 style="margin:18px 0 12px;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:700;color:#111827;">${title}</h1>
                      <p style="margin:0 0 28px;font-family:${FONT};font-size:15px;line-height:1.65;color:#4b5563;">${body}</p>
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center" bgcolor="${NAVY}" style="border-radius:14px;background:${NAVY};">
                            <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;">${button}&nbsp;&nbsp;<span style="color:${ORANGE};">&rarr;</span></a>
                          </td>
                        </tr>
                      </table>${extra}
                      <p style="margin:26px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#9ca3af;">
                        Düğme çalışmazsa bu bağlantıyı tarayıcınıza yapıştırın:<br />
                        <a href="{{ .ConfirmationURL }}" style="color:#6b7280;word-break:break-all;">{{ .ConfirmationURL }}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 24px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:#8a93a3;">
                ${footnote}<br />
                <a href="https://www.adapptivdigital.com" style="color:#13284f;font-weight:700;text-decoration:none;">Adapptiv</a> &middot; Randevuyla çalışan işletmeler için yönetim uygulaması
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`
}

const files = {
  'confirmation.html': layout({
    dashboard: 'Confirm signup',
    subject: 'Adapptiv hesabınızı doğrulayın',
    preheader: 'Tek dokunuşla e-postanızı doğrulayın, salonunuz hazır.',
    eyebrow: 'Hesap doğrulama',
    title: 'Salonunuz neredeyse hazır',
    body: 'Adapptiv’e hoş geldiniz. Giriş yapabilmek için e-posta adresinizi doğrulamanız yeterli.',
    button: 'E-postamı doğrula',
    extra: steps([
      'Hizmetlerinizi süre ve fiyatıyla ekleyin',
      'Çalışma saatlerinizi girin',
      'Online randevu linkinizi müşterilerinizle paylaşın',
    ]),
    footnote: 'Bu hesabı siz açmadıysanız bu e-postayı yok sayabilirsiniz; doğrulanmayan hesaplar 7 gün içinde silinir.',
  }),
  'recovery.html': layout({
    dashboard: 'Reset password',
    subject: 'Adapptiv şifre sıfırlama',
    preheader: 'Yeni şifrenizi belirlemek için bağlantı içeride.',
    eyebrow: 'Şifre sıfırlama',
    title: 'Yeni şifrenizi belirleyin',
    body: 'Adapptiv hesabınız için şifre sıfırlama istendi. Aşağıdaki düğmeyle yeni şifrenizi belirleyebilirsiniz; bağlantı kısa bir süre geçerlidir.',
    button: 'Yeni şifre belirle',
    footnote: 'Bu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.',
  }),
  'email_change.html': layout({
    dashboard: 'Change email address',
    subject: 'Adapptiv e-posta adresi değişikliği',
    preheader: 'Hesabınızın e-posta adresini değiştirmeyi onaylayın.',
    eyebrow: 'E-posta değişikliği',
    title: 'Yeni adresinizi onaylayın',
    body: 'Adapptiv hesabınızın e-posta adresi <b style="color:#111827;">{{ .Email }}</b> yerine <b style="color:#111827;">{{ .NewEmail }}</b> olarak değiştirilmek isteniyor.',
    button: 'Değişikliği onayla',
    footnote: 'Bu değişikliği siz istemediyseniz bu e-postayı yok sayın ve şifrenizi değiştirin.',
  }),
}
for (const [name, html] of Object.entries(files)) {
  fs.writeFileSync(OUT + name, html)
  console.log('yazildi', name)
}
