const PALETTE = ['#3d4632', '#8b6f47', '#2f5aa8', '#a1731f', '#b8483a', '#2f6d40']

export function colorForName(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

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
