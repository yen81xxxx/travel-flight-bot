import SettingsView from './SettingsView';

export const dynamic = 'force-dynamic';
export const metadata = { title: '通知設定' };

export default function LiffSettingsPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';
  return <SettingsView liffId={liffId} />;
}
