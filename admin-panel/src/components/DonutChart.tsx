interface DonutSegment {
  value: number
  color: string
}

interface DonutChartProps {
  segments: DonutSegment[]
  size?: number
  strokeWidth?: number
  centerLabel?: string
  centerSubLabel?: string
  centerLabelColor?: string
  centerSubLabelColor?: string
}

export default function DonutChart({
  segments,
  size = 160,
  strokeWidth = 20,
  centerLabel,
  centerSubLabel,
  centerLabelColor = 'var(--text)',
  centerSubLabelColor = 'var(--text-dim)',
}: DonutChartProps) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offsetAcc = 0

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={strokeWidth} />
        {segments.map((seg, i) => {
          const fraction = seg.value / total
          const dash = fraction * circumference
          const gap = circumference - dash
          const strokeDashoffset = -offsetAcc
          offsetAcc += dash
          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={strokeDashoffset}
            />
          )
        })}
      </svg>
      {(centerLabel || centerSubLabel) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {centerLabel && (
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 600, color: centerLabelColor }}>
              {centerLabel}
            </span>
          )}
          {centerSubLabel && (
            <span style={{ fontSize: 11, color: centerSubLabelColor }}>{centerSubLabel}</span>
          )}
        </div>
      )}
    </div>
  )
}
