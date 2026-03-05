function getEnvString(key: string, fallback: string): string {
  const value = import.meta.env[key] as string | undefined;
  return value?.trim() ? value : fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const raw = (import.meta.env[key] as string | undefined)?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const raw = (import.meta.env[key] as string | undefined)?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

export const appConfig = {
  appName: getEnvString('VITE_APP_NAME', 'מפת ג׳ינקס'),
  apiPollSeconds: getEnvInt('VITE_API_POLL_SECONDS', 60),
  alarmsCsvUrl: getEnvString(
    'VITE_ALARMS_CSV_URL',
    'https://raw.githubusercontent.com/yuval-harpaz/alarms/master/data/alarms.csv',
  ),
  realtimeEnabled: getEnvBool('VITE_REALTIME_ENABLED', true),
  realtimeAlertsUrl: getEnvString(
    'VITE_REALTIME_ALERTS_URL',
    'https://www.oref.org.il/warningMessages/alert/Alerts.json',
  ),
  realtimePollSeconds: getEnvInt('VITE_REALTIME_POLL_SECONDS', 4),
  realtimeMaxFailures: getEnvInt('VITE_REALTIME_MAX_FAILURES', 4),
} as const;
