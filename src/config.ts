function getEnvString(key: string, fallback: string): string {
  const value = import.meta.env[key] as string | undefined
  return value?.trim() ? value : fallback
}

function getEnvInt(key: string, fallback: number): number {
  const raw = (import.meta.env[key] as string | undefined)?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const appConfig = {
  appName: getEnvString('VITE_APP_NAME', "מפת ג׳ינקס"),
  apiPollSeconds: getEnvInt('VITE_API_POLL_SECONDS', 60),
  alarmsCsvUrl: getEnvString(
    'VITE_ALARMS_CSV_URL',
    'https://raw.githubusercontent.com/yuval-harpaz/alarms/master/data/alarms.csv',
  ),
} as const
