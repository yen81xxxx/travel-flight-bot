import { TW_ORIGINS, JP_DESTINATIONS } from '@/config/airports';
import SearchForm from './SearchForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '機票查詢',
  description: '台灣 ⇄ 日本 機票即時查詢 | LIFF'
};

export default function LiffSearchPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';

  return (
    <SearchForm
      liffId={liffId}
      twAirports={TW_ORIGINS}
      jpAirports={JP_DESTINATIONS}
    />
  );
}
