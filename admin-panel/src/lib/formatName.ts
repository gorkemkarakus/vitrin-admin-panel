function capitalizeWord(word: string): string {
  if (!word) return word
  const first = word.slice(0, 1).toLocaleUpperCase('tr-TR')
  const rest = word.slice(1).toLocaleLowerCase('tr-TR')
  return first + rest
}

export function formatPersonName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => word.split('-').map(capitalizeWord).join('-'))
    .join(' ')
}
