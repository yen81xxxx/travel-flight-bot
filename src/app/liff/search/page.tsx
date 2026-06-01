import { TW_ORIGINS, JP_DESTINATIONS } from '@/config/airports';
import SearchFormV2 from './SearchFormV2';
import RedirectGate from './RedirectGate';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '機票查詢',
  description: '台灣 ⇄ 日本 機票即時查詢 | LIFF'
};

export default function LiffSearchPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';

  return (
    <RedirectGate>
      <SearchFormV2
        liffId={liffId}
        twAirports={TW_ORIGINS}
        jpAirports={JP_DESTINATIONS}
      />
    </RedirectGate>
  );
}
