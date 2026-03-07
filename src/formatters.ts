export function formatFadeMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}דק`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return hours === 1 ? `1שעה` : `${hours}שעות`;
  }
  return `${hours}שעה ${mins}דק`;
}

export function formatMinutesSince(minutes: number): string {
  const totalMinutes = Math.max(0, Math.round(minutes));

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  if (totalMinutes < 24 * 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (mins === 0) return `${hours}h`;
    return `${hours}h${mins}m`;
  }

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  if (hours === 0) return `${days}d`;
  return `${days}d${hours}h`;
}
