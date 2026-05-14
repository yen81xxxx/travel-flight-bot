import SettingsViewV2 from './SettingsViewV2';

export const dynamic = 'force-dynamic';
export const metadata = { title: '通知設定' };

export default function LiffSettingsPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';
  return <SettingsViewV2 liffId={liffId} />;
}
