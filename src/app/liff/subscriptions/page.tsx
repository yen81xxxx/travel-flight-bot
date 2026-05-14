import SubscriptionsViewV2 from './SubscriptionsViewV2';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '我的訂閱',
  description: '管理降價提醒訂閱'
};

export default function LiffSubscriptionsPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';
  return <SubscriptionsViewV2 liffId={liffId} />;
}
