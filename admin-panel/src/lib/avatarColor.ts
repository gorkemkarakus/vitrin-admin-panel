const PALETTE = ['#3d4632', '#8b6f47', '#2f5aa8', '#a1731f', '#b8483a', '#2f6d40']

export function colorForName(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}
