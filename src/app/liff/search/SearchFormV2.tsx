'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Airport } from '@/config/airports';
import { isTaiwanAirport, isJapanAirport } from '@/config/airports';
import { useForm } from '@/hooks/useForm';
import { useLiff } from '@/hooks/useLiff';
import { useSessionStorage } from '@/hooks/useSessionStorage';
import { useSearchSession } from '@/hooks/useSearchSession';
import { Stepper } from '@/components/Stepper';
import TabNav from '../TabNav';

interface Props {
  liffId: string;
  twAirports: Airport[];
  jpAirports: Airport[];
}

interface FlightRow {
  airline: string | null;
  price: number | null;
  duration_minutes: number | null;
  stops: number;
  flight_type: 'best' | 'other';
}

interface SearchResponse {
  ok: boolean;
  outbound?: FlightRow[];
  return?: FlightRow[];
  analysis?: {
    cheapestRoundTripPrice: number | null;
    cheapestAirline: string | null;
    outboundCount: number;
    returnCount: number;
  };
  fromCache?: boolean;
  error?: string;
}

export default function SearchFormV2({ liffId, twAirports, jpAirports }: Props) {
  // LIFF 狀態管理
  const { liffReady, user, login: handleLineLogin } = useLiff(liffId);
  const sourceId = user?.userId ?? null;
  const profileName = user?.displayName ?? null;

  // 群組上下文
  const [groupCtxId, setGroupCtxId] = useSessionStorage<string | null>('liff_ctx', null);

  // 會話管理（3步流程）
  const session = useSearchSession();

  // 搜尋表單狀態
  const searchForm = useForm(
    { origin: session.state.origin, destination: session.state.destination, outboundDate: session.state.outboundDate, returnDate: session.state.returnDate }
  );

  // 訂閱表單狀態
  const subscribeForm = useForm(
    { customMaxPrice: session.state.customMaxPrice, subLabel: session.state.subLabel }
  );

  // API 狀態
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [subscribeAs, setSubscribeAs] = useState<'self' | 'group'>(session.state.subscribeAs);

  // 預設日期
  useEffect(() => {
    const now = new Date();
    const out = new Date(now.getTime() + 30 * 86400_000);
    const ret = new Date(out.getTime() + 4 * 86400_000);
    if (!searchForm.values.outboundDate) {
      searchForm.setValue('outboundDate', out.toISOString().slice(0, 10));
      searchForm.setValue('returnDate', ret.toISOString().slice(0, 10));
    }
  }, []);

  // 從 URL 讀 ctx
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get('ctx');
    if (ctx && (ctx.startsWith('C') || ctx.startsWith('R'))) {
      setGroupCtxId(ctx);
    }
  }, [setGroupCtxId]);

  // 日本機場分組
  const jpByRegion = useMemo(() => {
    const groups: Record<string, Airport[]> = {};
    for (const d of jpAirports) {
      const r = d.region ?? '其他';
      (groups[r] = groups[r] ?? []).push(d);
    }
    return groups;
  }, [jpAirports]);

  // 機場選項
  const renderAirportOptions = () => (
    <>
      <optgroup label="🇹🇼 台灣">
        {twAirports.map(a => (
          <option key={a.iata} value={a.iata}>
            {a.city} {a.iata}
          </option>
        ))}
      </optgroup>
      {Object.entries(jpByRegion).map(([region, list]) => (
        <optgroup key={region} label={`🇯🇵 ${region}`}>
          {list.map(a => (
            <option key={a.iata} value={a.iata}>
              {a.city} {a.iata}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );

  // Step 1: 驗證和提交搜尋
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { origin, destination, outboundDate, returnDate } = searchForm.values;

    // 方向驗證
    if (!((isTaiwanAirport(origin) && isJapanAirport(destination)) || (isJapanAirport(origin) && isTaiwanAirport(destination)))) {
      setError('出發地與目的地必須一個在台灣、一個在日本');
      return;
    }

    // 日期驗證
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out = new Date(outboundDate);
    const ret = new Date(returnDate);

    if (isNaN(out.getTime()) || isNaN(ret.getTime())) {
      setError('日期格式錯誤');
      return;
    }
    if (out < today) {
      setError('去程日期不能在過去');
      return;
    }
    if (ret <= out) {
      setError('回程日期必須晚於去程日期');
      return;
    }

    const tripDays = Math.round((ret.getTime() - out.getTime()) / 86400_000);
    if (tripDays > 60) {
      const ok = confirm(`旅程長度 ${tripDays} 天，超過 60 天可能查無資料。確定要查嗎？`);
      if (!ok) return;
    }

    const aheadDays = Math.round((out.getTime() - today.getTime()) / 86400_000);
    if (aheadDays > 330) {
      setError('出發日期太遠，通常還沒開放訂位');
      return;
    }

    // 搜尋
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin, destination, outboundDate, returnDate,
          sourceId: groupCtxId ? undefined : (sourceId ?? undefined)
        })
      });

      const data: SearchResponse = await res.json();
      if (!data.ok) throw new Error(data.error || '搜尋失敗');

      setResult(data);
      session.updateSession({
        origin, destination, outboundDate, returnDate,
        searchResult: data
      });

      // 預設訂閱價格
      if (data.analysis?.cheapestRoundTripPrice) {
        subscribeForm.setValue('customMaxPrice', String(data.analysis.cheapestRoundTripPrice));
      }

      // 進入 Step 2
      session.nextStep();
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜尋失敗');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: 訂閱
  const handleSubscribe = async () => {
    if (subscribeStatus === 'saving') return;
    if (!sourceId) {
      setError('需要在 LINE 內開啟才能訂閱');
      return;
    }

    const userInputPrice = parseFloat(subscribeForm.values.customMaxPrice);
    if (isNaN(userInputPrice) || userInputPrice <= 0) {
      setError('請輸入有效的金額');
      return;
    }

    setSubscribeStatus('saving');
    try {
      const { origin, destination, outboundDate, returnDate } = searchForm.values;
      const targetSourceId = subscribeAs === 'group' && groupCtxId ? groupCtxId : sourceId;

      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: targetSourceId,
          origin, destination,
          maxPrice: userInputPrice,
          outboundDate, returnDate,
          label: subscribeForm.values.subLabel.trim() || undefined
        })
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '訂閱失敗');

      setSubscribeStatus('saved');
      session.nextStep();
    } catch (err) {
      setSubscribeStatus('error');
      setError(err instanceof Error ? err.message : '訂閱失敗');
    }
  };

  const closeLiff = async () => {
    if (!liffId) return;
    try {
      const liff = (await import('@line/liff')).default;
      if (liff.isInClient()) liff.closeWindow();
    } catch (err) {
      console.warn('closeLiff failed:', err);
    }
  };

  const fmt = (n: number | null | undefined) =>
    n != null ? `NT$ ${n.toLocaleString()}` : '—';

  if (!liffReady) {
    return (
      <div className="liff-loading">
        <div className="spinner" />
        <p>載入中…</p>
        <style jsx>{`
          .liff-loading {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            color: #7e88a8;
          }
          .spinner {
            width: 40px; height: 40px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top-color: #ff7a45;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <>
      <TabNav active="search" liffId={liffId} />
      <div className="wrap">
        <header className="hero">
          <span className="logo">✈️</span>
          <div>
            <h1>機票查詢</h1>
            <p>{profileName ? `Hi, ${profileName} 👋` : '台灣 → 日本'}</p>
          </div>
        </header>

        {/* 進度指示器 */}
        <Stepper
          steps={['路線日期', '查詢結果', '確認訂閱']}
          currentStep={session.state.step}
          onStepClick={i => {
            if (i < session.state.step) session.goToStep(i);
          }}
        />

        {/* Step 1: 搜尋表單 */}
        {session.state.step === 0 && (
          <form onSubmit={handleSearchSubmit} className="card form">
            <div className="route-display">
              <div className="airport-pick">
                <span className="role">FROM</span>
                <select
                  value={searchForm.values.origin}
                  onChange={e => searchForm.setValue('origin', e.target.value)}
                  disabled={loading}
                  className="picker"
                >
                  {renderAirportOptions()}
                </select>
              </div>

              <button
                type="button"
                className="swap-btn"
                onClick={() => {
                  const temp = searchForm.values.origin;
                  searchForm.setValue('origin', searchForm.values.destination);
                  searchForm.setValue('destination', temp);
                }}
                disabled={loading}
              >
                ⇄
              </button>

              <div className="airport-pick">
                <span className="role">TO</span>
                <select
                  value={searchForm.values.destination}
                  onChange={e => searchForm.setValue('destination', e.target.value)}
                  disabled={loading}
                  className="picker"
                >
                  {renderAirportOptions()}
                </select>
              </div>
            </div>

            <div className="date-row">
              <label className="date-input">
                <span className="role">📅 去程</span>
                <input
                  type="date"
                  value={searchForm.values.outboundDate}
                  onChange={e => searchForm.setValue('outboundDate', e.target.value)}
                  required
                  disabled={loading}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </label>
              <label className="date-input">
                <span className="role">📅 回程</span>
                <input
                  type="date"
                  value={searchForm.values.returnDate}
                  onChange={e => searchForm.setValue('returnDate', e.target.value)}
                  required
                  disabled={loading}
                  min={searchForm.values.outboundDate || new Date().toISOString().slice(0, 10)}
                />
              </label>
            </div>

            {error && <div className="alert alert-error">⚠️ {error}</div>}

            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? <>⏳ 查詢中…</> : <>🔍 查詢航班</>}
            </button>
          </form>
        )}

        {/* Step 2: 搜尋結果 */}
        {session.state.step === 1 && result && result.ok && (
          <div className="card results-card">
            <h2>✈️ 搜尋結果</h2>

            {result.analysis?.outboundCount === 0 ? (
              <div className="empty-state">
                <p>找不到符合條件的航班</p>
                <button onClick={() => session.previousStep()} className="btn-secondary">
                  ← 修改條件
                </button>
              </div>
            ) : (
              <>
                <div className="summary-cards">
                  <div className="stat">
                    <div className="stat-label">最便宜往返</div>
                    <div className="stat-value accent">
                      {fmt(result.analysis?.cheapestRoundTripPrice)}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">主推航空</div>
                    <div className="stat-value">{result.analysis?.cheapestAirline ?? '—'}</div>
                  </div>
                </div>

                {sourceId ? (
                  <button onClick={() => session.nextStep()} className="btn-primary">
                    ✓ 確認價格，進入訂閱 →
                  </button>
                ) : (
                  <button onClick={handleLineLogin} className="btn-line-login">
                    <span>L</span>
                    <span>用 LINE 登入以訂閱</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 3: 確認訂閱 */}
        {session.state.step === 2 && result && sourceId && (
          <div className="card subscribe-card">
            <h2>🔔 確認訂閱</h2>

            <div className="sub-input-row">
              <span className="sub-prefix">NT$</span>
              <input
                type="number"
                value={subscribeForm.values.customMaxPrice}
                onChange={e => subscribeForm.setValue('customMaxPrice', e.target.value)}
                placeholder="金額"
                disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
              />
            </div>

            <input
              type="text"
              value={subscribeForm.values.subLabel}
              onChange={e => subscribeForm.setValue('subLabel', e.target.value)}
              placeholder="📝 備註（選填）"
              disabled={subscribeStatus === 'saving' || subscribeStatus === 'saved'}
              maxLength={50}
              className="sub-label-input"
            />

            {groupCtxId && (
              <div className="toggle-group">
                <button
                  type="button"
                  className={subscribeAs === 'self' ? 'tg active' : 'tg'}
                  onClick={() => setSubscribeAs('self')}
                >
                  👤 通知我
                </button>
                <button
                  type="button"
                  className={subscribeAs === 'group' ? 'tg active' : 'tg'}
                  onClick={() => setSubscribeAs('group')}
                >
                  👥 通知群組
                </button>
              </div>
            )}

            {error && <div className="alert alert-error">⚠️ {error}</div>}

            {subscribeStatus === 'saved' ? (
              <div className="success-state">
                <div className="big">🎉</div>
                <p>訂閱成功！跌破 NT$ {subscribeForm.values.customMaxPrice} 會自動通知。</p>
                <button onClick={closeLiff} className="btn-primary">
                  關閉
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleSubscribe}
                  disabled={subscribeStatus === 'saving' || !subscribeForm.values.customMaxPrice}
                  className="btn-primary"
                >
                  {subscribeStatus === 'saving' ? '⏳ 訂閱中…' : '✓ 確認訂閱'}
                </button>
                <button onClick={() => session.previousStep()} className="btn-secondary">
                  ← 回上一步
                </button>
              </>
            )}
          </div>
        )}

        <style jsx>{`
          .wrap {
            max-width: 640px;
            margin: 0 auto;
            padding: 16px;
            padding-bottom: 80px;
            font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Microsoft JhengHei', sans-serif;
            background: linear-gradient(180deg, #f8f9fa 0%, #ffffff 100%);
          }

          .hero {
            background: linear-gradient(135deg, #001a4d 0%, #1a3a66 100%);
            border-radius: 16px;
            padding: 28px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            gap: 16px;
            border: 1px solid rgba(0, 102, 255, 0.3);
            box-shadow: 0 8px 32px rgba(0, 102, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          }

          .logo {
            font-size: 40px;
            filter: drop-shadow(0 4px 12px rgba(255, 122, 69, 0.6));
            animation: float 3s ease-in-out infinite;
          }

          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
          }

          .hero h1 {
            font-size: 28px;
            font-weight: 800;
            margin-bottom: 4px;
            color: #ffffff;
            letter-spacing: -0.5px;
          }

          .hero p {
            font-size: 14px;
            color: #a0c4ff;
            font-weight: 500;
          }

          .card {
            background: white;
            border: 1px solid #e0e7ff;
            border-radius: 14px;
            padding: 24px;
            margin-bottom: 16px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 102, 255, 0.08);
            transition: all 0.3s ease;
          }

          .card:hover {
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06), 0 0 30px rgba(0, 102, 255, 0.12);
            transform: translateY(-2px);
          }

          .form {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .route-display {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 8px;
            align-items: end;
          }

          .airport-pick {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .role {
            font-size: 11px;
            font-weight: 700;
            color: #999;
            text-transform: uppercase;
          }

          .picker, .date-input input {
            width: 100%;
            padding: 12px 14px;
            border: 1.5px solid #e0e7ff;
            border-radius: 10px;
            font-size: 16px;
            background: #f8f9ff;
            transition: all 0.2s;
            font-family: inherit;
          }

          .picker:focus, .date-input input:focus {
            outline: none;
            border-color: #0066ff;
            background: white;
            box-shadow: 0 0 0 3px rgba(0, 102, 255, 0.1), 0 2px 8px rgba(0, 102, 255, 0.15);
          }

          .swap-btn {
            padding: 10px 12px;
            border: 1.5px solid #e0e7ff;
            background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%);
            border-radius: 10px;
            cursor: pointer;
            font-size: 20px;
            height: 48px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .swap-btn:hover {
            background: linear-gradient(135deg, #f0f4ff 0%, #e8f0ff 100%);
            border-color: #b3c9ff;
            transform: rotate(180deg);
            box-shadow: 0 2px 8px rgba(0, 102, 255, 0.1);
          }

          .date-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .date-input {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .btn-primary {
            padding: 14px;
            background: linear-gradient(135deg, #0066ff 0%, #0052cc 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0, 102, 255, 0.3), 0 0 20px rgba(0, 102, 255, 0.15);
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            position: relative;
            overflow: hidden;
          }

          .btn-primary::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
          }

          .btn-primary:hover:not(:disabled)::before {
            left: 100%;
          }

          .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 102, 255, 0.4), 0 0 30px rgba(0, 102, 255, 0.2);
          }

          .btn-primary:active:not(:disabled) {
            transform: translateY(0);
          }

          .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            box-shadow: none;
          }

          .btn-secondary {
            padding: 12px;
            background: #f8f9ff;
            border: 1.5px solid #d0d9ff;
            border-radius: 10px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            color: #333;
            transition: all 0.2s;
          }

          .btn-secondary:hover {
            background: #f0f4ff;
            border-color: #b3c9ff;
            box-shadow: 0 2px 8px rgba(0, 102, 255, 0.1);
          }

          .btn-line-login {
            padding: 14px;
            background: #06c755;
            color: white;
            border: none;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            cursor: pointer;
            font-weight: 600;
          }

          .btn-line-login span:first-child {
            background: white;
            color: #06c755;
            width: 22px;
            height: 22px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 900;
          }

          .alert {
            padding: 14px 16px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 500;
            border: 1px solid;
            animation: slideInDown 0.3s ease-out;
          }

          @keyframes slideInDown {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .alert-error {
            background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
            color: #991b1b;
            border-color: #fecaca;
            box-shadow: 0 2px 8px rgba(239, 68, 68, 0.1);
          }

          .summary-cards {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 16px;
          }

          .stat {
            background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%);
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #e0e7ff;
            text-align: center;
            transition: all 0.3s ease;
            box-shadow: 0 2px 8px rgba(0, 102, 255, 0.06);
          }

          .stat:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 20px rgba(0, 102, 255, 0.15);
            border-color: #b3c9ff;
          }

          .stat-label {
            font-size: 11px;
            color: #6b7280;
            margin-bottom: 8px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .stat-value {
            font-size: 22px;
            font-weight: 800;
            color: #1f2937;
            font-variant-numeric: tabular-nums;
          }

          .stat-value.accent {
            background: linear-gradient(135deg, #ff7a45 0%, #ff6b35 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: none;
          }

          .empty-state {
            text-align: center;
            padding: 32px 0;
          }

          .empty-state p {
            color: #666;
            margin-bottom: 16px;
          }

          .sub-input-row {
            display: flex;
            align-items: center;
            gap: 10px;
            background: #f9f9f9;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 8px 12px;
            margin-bottom: 12px;
          }

          .sub-prefix {
            color: #999;
            font-weight: 600;
          }

          .sub-input-row input {
            flex: 1;
            border: none;
            background: transparent;
            font-size: 18px;
            font-weight: 700;
            outline: none;
          }

          .sub-label-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            margin-bottom: 12px;
          }

          .toggle-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
          }

          .tg {
            padding: 10px;
            border: 1px solid #d1d5db;
            background: #f9f9f9;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s;
          }

          .tg.active {
            background: #0066ff;
            color: white;
            border-color: #0066ff;
          }

          .success-state {
            text-align: center;
            padding: 40px 20px;
            background: linear-gradient(135deg, #f0fdf4 0%, #f0f4ff 100%);
            border: 1px solid rgba(34, 197, 94, 0.2);
            border-radius: 12px;
            animation: fadeInScale 0.4s ease-out;
          }

          @keyframes fadeInScale {
            from {
              opacity: 0;
              transform: scale(0.95);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }

          .success-state .big {
            font-size: 64px;
            margin-bottom: 16px;
            animation: bounce 0.6s ease-out;
          }

          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
          }

          .success-state p {
            color: #1f2937;
            margin-bottom: 24px;
            line-height: 1.6;
            font-weight: 500;
          }

          .tg {
            padding: 12px 16px;
            border: 1.5px solid #e0e7ff;
            background: #f8f9ff;
            border-radius: 10px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            color: #666;
            transition: all 0.2s;
          }

          .tg:hover {
            background: #f0f4ff;
            border-color: #b3c9ff;
          }

          .tg.active {
            background: linear-gradient(135deg, #0066ff 0%, #0052cc 100%);
            color: white;
            border-color: #0052cc;
            box-shadow: 0 4px 12px rgba(0, 102, 255, 0.3);
          }

          @media (max-width: 640px) {
            .wrap {
              padding: 12px;
              padding-bottom: 60px;
            }

            .hero {
              padding: 20px;
              gap: 12px;
            }

            .hero h1 {
              font-size: 24px;
            }

            .card {
              padding: 16px;
              margin-bottom: 12px;
            }

            .btn-primary {
              padding: 12px;
              font-size: 15px;
            }

            .stat-value {
              font-size: 18px;
            }
          }
        `}</style>
      </div>
    </>
  );
}

