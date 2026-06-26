/**
 * WatchCard — render coverage + graceful degradation + signal/click 行為
 *
 * 邊界：
 *   - quote=null → 顯示目標價當 fallback、無 sparkline、signal=watching
 *   - history.length < 2 → 不畫 sparkline 但其他 row 還在
 *   - deltaPct=null → 不顯示 delta chip
 *   - return_date=null → 顯示「單程」
 *   - paused=true → is-paused class
 *   - signal=hit → is-hit class
 *   - onOpen 點擊回傳同一份 watch object
 *
 * daysUntil 純函數也單獨測（時區邊界）。
 */
import '@testing-library/jest-dom';
import * as React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { WatchCard, daysUntil } from '../WatchCard';
import type { WatchItem } from '../../_hooks/useWatchlist';

const baseWatch: WatchItem = {
  id: 1,
  source_id: 'Uabc',
  source_type: 'user',
  origin: 'TPE',
  destination: 'NRT',
  outbound_date: '2026-08-14',
  return_date: '2026-08-18',
  max_price: 12800,
  max_price_traditional: null,
  active: true,
  paused: false,
  label: null,
  outbound_min_departure_time: null,
  outbound_max_departure_time: null,
  return_min_departure_time: null,
  return_max_departure_time: null,
  _source: 'personal',
  quote: {
    currentBest: 11480,
    currentType: 'lcc',
    lcc: { price: 11480, out: '酷航', ret: '捷星', estimate: true },
    trad: { price: 18650, airline: '星宇航空' },
    deltaPct: -6.2,
    history: Array.from({ length: 30 }, (_, i) => ({ d: `5/${i + 1}`, p: 15000 - i * 100 }))
  }
};

describe('daysUntil', () => {
  it('YYYY-MM-DD 解析（不靠時區）', () => {
    // 與當天比較 — 寬鬆斷言只看正負號 + magnitude
    const inFuture = daysUntil('2030-01-01');
    expect(inFuture).not.toBeNull();
    expect(inFuture).toBeGreaterThan(0);
  });
  it('壞日期 → null', () => {
    expect(daysUntil('garbage')).toBeNull();
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
  });
});

describe('WatchCard — happy path', () => {
  it('render route / dates / price / signal', () => {
    const { getByTestId, container } = render(<WatchCard watch={baseWatch} onOpen={() => {}} />);
    const card = getByTestId('watch-card');
    expect(card).toBeInTheDocument();
    // route codes 顯示
    expect(container.textContent).toContain('TPE→NRT');
    // 千分位價格
    expect(container.textContent).toContain('11,480');
    // delta 顯示
    expect(container.textContent).toContain('6.2%');
    // signal pill 存在
    expect(getByTestId('signal-pill')).toBeInTheDocument();
  });

  it('lcc currentType + 不同去/回航司 → "出 → 回"', () => {
    const { container } = render(<WatchCard watch={baseWatch} onOpen={() => {}} />);
    expect(container.textContent).toContain('酷航 → 捷星');
  });

  it('trad currentType → 顯示傳統 + airline', () => {
    const w: WatchItem = {
      ...baseWatch,
      quote: {
        currentBest: 18650,
        currentType: 'trad',
        lcc: null,
        trad: { price: 18650, airline: '星宇航空' },
        deltaPct: -2.5,
        history: []
      }
    };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(container.textContent).toContain('傳統');
    expect(container.textContent).toContain('星宇航空');
  });

  it('onOpen 點擊把 watch 傳回', () => {
    const onOpen = jest.fn();
    const { getByTestId } = render(<WatchCard watch={baseWatch} onOpen={onOpen} />);
    fireEvent.click(getByTestId('watch-card'));
    expect(onOpen).toHaveBeenCalledWith(baseWatch);
  });
});

describe('WatchCard — graceful degradation', () => {
  it('quote=null → 顯示目標價當 fallback、signal=watching、無 sparkline / delta', () => {
    const w: WatchItem = { ...baseWatch, quote: null };
    const { getByTestId, container, queryByTestId } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(getByTestId('watch-card').getAttribute('data-signal')).toBe('watching');
    // 顯示目標價（12,800），不是 currentBest
    expect(container.textContent).toContain('12,800');
    expect(container.textContent).toContain('目標價');
    // 不畫 sparkline
    expect(queryByTestId('sparkline')).toBeNull();
  });

  it('history < 2 點 → 不畫 sparkline，其他還在', () => {
    const w: WatchItem = {
      ...baseWatch,
      quote: { ...baseWatch.quote!, history: [{ d: '6/8', p: 12000 }] }
    };
    const { queryByTestId, container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(queryByTestId('sparkline')).toBeNull();
    expect(container.textContent).toContain('11,480'); // price 仍在
  });

  it('deltaPct=null → 不顯示 delta chip', () => {
    const w: WatchItem = {
      ...baseWatch,
      quote: { ...baseWatch.quote!, deltaPct: null }
    };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(container.textContent).not.toMatch(/\d+\.\d%/);
  });
});

describe('WatchCard — 標記類別', () => {
  it('paused=true → data-paused=true', () => {
    const { getByTestId } = render(<WatchCard watch={{ ...baseWatch, paused: true }} onOpen={() => {}} />);
    expect(getByTestId('watch-card').getAttribute('data-paused')).toBe('true');
  });

  it('group source → data-source=group + 顯示「群組」pill', () => {
    const { getByTestId, container } = render(
      <WatchCard watch={{ ...baseWatch, _source: 'group' }} onOpen={() => {}} />
    );
    expect(getByTestId('watch-card').getAttribute('data-source')).toBe('group');
    expect(container.textContent).toContain('群組');
  });

  it('signal=hit (currentBest < max_price) → data-signal=hit', () => {
    const w: WatchItem = {
      ...baseWatch,
      max_price: 20000,
      quote: { ...baseWatch.quote!, currentBest: 11480 }
    };
    const { getByTestId } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(getByTestId('watch-card').getAttribute('data-signal')).toBe('hit');
  });
});

describe('WatchCard — 單程 / 不限日期', () => {
  it('return_date=null → 顯示「單程」', () => {
    const w: WatchItem = { ...baseWatch, return_date: null };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(container.textContent).toContain('單程');
  });
  it('outbound_date=null → 顯示「不限定日期」', () => {
    const w: WatchItem = { ...baseWatch, outbound_date: null };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(container.textContent).toContain('不限定日期');
  });
});

describe('WatchCard — PR #5 intel integration', () => {
  it('intel.status="building" → 顯示「情報建立中 · 再 N 天解鎖」', () => {
    const w: WatchItem = {
      ...baseWatch,
      quote: { ...baseWatch.quote!, intel: { status: 'building', tracked: 5, remaining: 9, target: 14, pct: 36, days: 60 } }
    };
    const { getByTestId, container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(getByTestId('building-state')).toBeInTheDocument();
    expect(container.textContent).toContain('情報建立中');
    expect(container.textContent).toContain('再 9 天');
    // 不應該顯示判斷字眼
    expect(container.textContent).not.toContain('建議入手');
    expect(container.textContent).not.toContain('建議再等');
  });

  it('intel.status="ready" → 顯示 VerdictBadge + 百分位文字 row（PR #20 §4.8 新版排法）', () => {
    const w: WatchItem = {
      ...baseWatch,
      quote: {
        ...baseWatch.quote!,
        intel: {
          status: 'ready', verdict: 'buy', headline: '現在就是好時機',
          percentile: 12, lo: 10000, hi: 14500, p25: 11200, p50: 12500, p75: 13800,
          confidence: '高', reasons: [], days: 65, hitTarget: true, tracked: 30
        }
      }
    };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    const badge = container.querySelector('[data-testid="verdict-badge"]');
    expect(badge).toBeInTheDocument();
    expect(badge?.getAttribute('data-verdict')).toBe('buy');
    // 卡片改用百分位文字 row（PercentileBar gradient 保留給 IntelPanel）
    expect(container.querySelector('[data-testid="percentile-text"]')).toBeInTheDocument();
    expect(container.textContent).toContain('第 12 百分位');
  });

  it('intel=null (graceful degrade) → 回退到 SignalPill（PR #3 行為）', () => {
    const w: WatchItem = {
      ...baseWatch,
      quote: { ...baseWatch.quote!, intel: null }
    };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(container.querySelector('[data-testid="signal-pill"]')).toBeInTheDocument();
  });
});

describe('WatchCard — G1 group members pill', () => {
  it('group source + memberCount >= 1 → 顯示「N 人在追」pill', () => {
    const w: WatchItem = { ...baseWatch, _source: 'group', memberCount: 3 };
    const { getByTestId, container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(getByTestId('members-pill')).toBeInTheDocument();
    expect(container.textContent).toContain('3 人在追');
  });

  it('personal source → 不顯示 members pill (個人訂閱不該有成員)', () => {
    const w: WatchItem = { ...baseWatch, _source: 'personal', memberCount: 5 };
    const { queryByTestId } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(queryByTestId('members-pill')).toBeNull();
  });

  it('group source 但 memberCount=0 → 不顯示 (沒人加入時藏起來)', () => {
    const w: WatchItem = { ...baseWatch, _source: 'group', memberCount: 0 };
    const { queryByTestId } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(queryByTestId('members-pill')).toBeNull();
  });

  it('group source 但 memberCount=undefined → 不顯示', () => {
    const w: WatchItem = { ...baseWatch, _source: 'group', memberCount: undefined };
    const { queryByTestId } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(queryByTestId('members-pill')).toBeNull();
  });
});

describe('WatchCard — PR #19 報價更新中 degraded panel', () => {
  it('quote=null → 顯示「報價更新中」panel + 目標價已生效文案', () => {
    const w: WatchItem = { ...baseWatch, quote: null };
    const { getByTestId, container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(getByTestId('quote-updating')).toBeInTheDocument();
    expect(container.textContent).toContain('報價更新中');
    expect(container.textContent).toContain('仍會在達標時通知你');
  });

  it('quote=null → 不顯示 signal row（無假「監控中」pill）', () => {
    const w: WatchItem = { ...baseWatch, quote: null };
    const { queryByTestId } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(queryByTestId('signal-pill')).toBeNull();
    expect(queryByTestId('percentile-bar')).toBeNull();
    expect(queryByTestId('building-state')).toBeNull();
  });

  it('quote=null → 不顯示 NaN / dash 數學', () => {
    const w: WatchItem = { ...baseWatch, quote: null };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('目前最低');
  });

  it('有 quote → 不顯示更新中 panel（正常價格區）', () => {
    const { queryByTestId, container } = render(<WatchCard watch={baseWatch} onOpen={() => {}} />);
    expect(queryByTestId('quote-updating')).toBeNull();
    expect(container.textContent).toContain('目前最低');
  });
});

describe('WatchCard — 開口式來回（0015）', () => {
  it('有 return_origin/destination → 顯示「開口式」pill + 回段路線', () => {
    const w = { ...baseWatch, destination: 'NRT', return_origin: 'HND', return_destination: 'TSA' };
    const { getByTestId, container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(getByTestId('oj-pill').textContent).toContain('開口式');
    expect(container.textContent).toContain('回 HND→TSA');
  });

  it('一般來回（無回段地點）→ 不顯示開口式 pill', () => {
    const { queryByTestId } = render(<WatchCard watch={baseWatch} onOpen={() => {}} />);
    expect(queryByTestId('oj-pill')).toBeNull();
  });

  it('quote.openJaw 有值 → 航司列顯示「多城市票・航司 起」而非廉/傳', () => {
    const w: WatchItem = {
      ...baseWatch,
      destination: 'NRT',
      return_origin: 'HND',
      return_destination: 'TSA',
      quote: {
        currentBest: 18683,
        currentType: 'lcc',  // placeholder — openJaw marker 才是判斷依據
        lcc: null,
        trad: null,
        deltaPct: null,
        history: [],
        openJaw: { airline: '中華航空' }
      }
    };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(container.textContent).toContain('多城市票');
    expect(container.textContent).toContain('中華航空');
    expect(container.textContent).toContain('18,683');
    // 不該誤標廉航 / 傳統
    expect(container.textContent).not.toContain('廉航');
    expect(container.textContent).not.toContain('傳統');
  });

  it('quote.openJaw.airline=null → 顯示 dash 不 crash', () => {
    const w: WatchItem = {
      ...baseWatch,
      return_origin: 'HND',
      return_destination: 'TSA',
      quote: {
        currentBest: 18683, currentType: 'lcc', lcc: null, trad: null,
        deltaPct: null, history: [], openJaw: { airline: null }
      }
    };
    const { container } = render(<WatchCard watch={w} onOpen={() => {}} />);
    expect(container.textContent).toContain('多城市票');
    expect(container.textContent).toContain('—');
  });
});
