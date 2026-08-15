function buildTimeOptions(stepMinutes = 30, startHour = 6, endHour = 23) {
  const options: string[] = []
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += stepMinutes) {
      options.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return options
}

export const TIME_OPTIONS = buildTimeOptions()
