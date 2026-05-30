import ShareTrigger from './ShareTrigger';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '分享航線',
  description: '分享給朋友追蹤同條航線'
};

export default function LiffSharePage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';
  return <ShareTrigger liffId={liffId} />;
}
