import { colorForName } from '../lib/avatarColor'

export default function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: colorForName(name),
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 700,
        fontFamily: 'var(--font-heading)',
        flexShrink: 0,
      }}
    >
      {initials || '?'}
    </span>
  )
}
