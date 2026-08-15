interface LineSeries {
  label: string
  color: string
  points: number[]
}

interface LineChartProps {
  series: LineSeries[]
  xLabels: string[]
  height?: number
}

const VIEW_WIDTH = 600
const PAD_X = 12
const PAD_TOP = 12
const PAD_BOTTOM = 8

export default function LineChart({ series, xLabels, height = 180 }: LineChartProps) {
  const allValues = series.flatMap((s) => s.points)
  const rawMax = allValues.length ? Math.max(...allValues) : 0
  const rawMin = allValues.length ? Math.min(...allValues) : 0
  const yMax = rawMax > 0 ? rawMax * 1.15 : 1
  const yMin = Math.min(0, rawMin)
  const yRange = yMax - yMin || 1

  const plotWidth = VIEW_WIDTH - PAD_X * 2
  const plotHeight = height - PAD_TOP - PAD_BOTTOM
  const count = xLabels.length

  function xAt(i: number) {
    if (count <= 1) return PAD_X + plotWidth / 2
    return PAD_X + (i / (count - 1)) * plotWidth
  }
  function yAt(v: number) {
    return PAD_TOP + plotHeight - ((v - yMin) / yRange) * plotHeight
  }

  const gridLines = [0, 0.5, 1]

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${VIEW_WIDTH} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {gridLines.map((f) => (
          <line
            key={f}
            x1={PAD_X}
            x2={VIEW_WIDTH - PAD_X}
            y1={PAD_TOP + plotHeight * f}
            y2={PAD_TOP + plotHeight * f}
            stroke="var(--line)"
            strokeWidth={1}
          />
        ))}
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={s.points.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')}
          />
        ))}
        {series.map((s) =>
          s.points.map((v, i) => <circle key={`${s.label}-${i}`} cx={xAt(i)} cy={yAt(v)} r={3} fill={s.color} />),
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {xLabels.map((label, i) => (
          <span key={i} style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
