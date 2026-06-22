/**
 * group-flex — 純函數 + flex JSON structure
 *
 * 不測完整 snapshot（容易因為小調整壞掉）— 斷言關鍵欄位 + altText 寫得對。
 */
import { buildGroupAlertFlex, formatMemberPreview } from '../group-flex';

describe('formatMemberPreview — 邊界', () => {
  it('空 → 空字串', () => {
    expect(formatMemberPreview([])).toBe('');
  });

  it('1 個 → 該名字', () => {
    expect(formatMemberPreview(['Alice'])).toBe('Alice');
  });

  it('3 個（剛好等於 default n）→ 不加 "+N"', () => {
    expect(formatMemberPreview(['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob, Carol');
  });

  it('5 個 → 截斷成「3 個名字, +2」', () => {
    expect(formatMemberPreview(['Alice', 'Bob', 'Carol', 'Dave', 'Eve']))
      .toBe('Alice, Bob, Carol, +2');
  });

  it('n=2 → 2 個 + "+K"', () => {
    expect(formatMemberPreview(['A', 'B', 'C', 'D'], 2)).toBe('A, B, +2');
  });
});

describe('buildGroupAlertFlex', () => {
  const base = {
    origin: 'TPE',
    destination: 'NRT',
    outboundDate: '2026-08-14',
    returnDate: '2026-08-18' as string | null,
    cheapestPrice: 11000,
    threshold: 12000,
    airline: '酷航',
    groupId: 'Cabc',
    subscriptionId: 42,
    memberCount: 3,
    topMemberNames: ['Alice', 'Bob', 'Carol'],
    topVote: null as { out_date: string; ret_date: string | null; voteCount: number } | null
  };

  it('回傳 type=flex + altText 含路線跟價格', () => {
    const f = buildGroupAlertFlex(base);
    expect(f.type).toBe('flex');
    expect(f.altText).toContain('TPE');
    expect(f.altText).toContain('NRT');
    expect(f.altText).toContain('11,000');
  });

  it('降幅 >= 1% → title = "群組降價提醒"', () => {
    const f = buildGroupAlertFlex({ ...base, cheapestPrice: 10500, threshold: 12000 });
    const headerText = (f.contents.header.contents[0] as { text: string }).text;
    expect(headerText).toBe('群組降價提醒');
  });

  it('降幅 < 1% → title = "群組已達標"（避免 "降價 0%" 看起來像 bug）', () => {
    const f = buildGroupAlertFlex({ ...base, cheapestPrice: 11990, threshold: 12000 });
    const headerText = (f.contents.header.contents[0] as { text: string }).text;
    expect(headerText).toBe('群組已達標');
  });

  it('header 用紫色 (#bf5af2 — 跟 LIFF group block 同色)', () => {
    const f = buildGroupAlertFlex(base);
    expect(f.contents.header.backgroundColor).toBe('#bf5af2');
  });

  it('body 含「N 人在追（成員名）」', () => {
    const f = buildGroupAlertFlex(base);
    const bodyText = JSON.stringify(f.contents.body);
    expect(bodyText).toContain('3 人在追');
    expect(bodyText).toContain('Alice');
  });

  it('topAirlines → body 顯示前 3 家（取代單一「航司：X」）', () => {
    const f = buildGroupAlertFlex({
      ...base,
      topAirlines: [
        { airline: '捷星', price: 6077 },
        { airline: '酷航', price: 6540 },
        { airline: '星宇航空', price: 7880 }
      ]
    });
    const bodyText = JSON.stringify(f.contents.body);
    expect(bodyText).toContain('便宜航空');
    expect(bodyText).toContain('NT$6,077');
    expect(bodyText).toContain('星宇航空');
    expect(bodyText).not.toContain('航司：');  // 單一航司行被取代
  });

  it('topAirlines 不給 → 退回單一「航司：X」（舊行為）', () => {
    const f = buildGroupAlertFlex(base);
    const bodyText = JSON.stringify(f.contents.body);
    expect(bodyText).toContain('航司：酷航');
    expect(bodyText).not.toContain('便宜航空');
  });

  it('沒投票 → footer button = 「查看詳情」', () => {
    const f = buildGroupAlertFlex({ ...base, topVote: null });
    const footerJson = JSON.stringify(f.contents.footer);
    expect(footerJson).toContain('查看詳情');
    expect(footerJson).not.toContain('打開投票');
  });

  it('有投票領先 → footer button = 「打開投票」+ body 多一行', () => {
    const f = buildGroupAlertFlex({
      ...base,
      topVote: { out_date: '2026-08-14', ret_date: '2026-08-18', voteCount: 3 }
    });
    const footerJson = JSON.stringify(f.contents.footer);
    expect(footerJson).toContain('打開投票');
    const bodyJson = JSON.stringify(f.contents.body);
    expect(bodyJson).toContain('投票領先');
    expect(bodyJson).toContain('3 票');
  });

  it('永遠有「我也要追」viral 按鈕（病毒擴散面）', () => {
    const f = buildGroupAlertFlex(base);
    const footerJson = JSON.stringify(f.contents.footer);
    expect(footerJson).toContain('我也要追');
  });

  it('button URL 帶 ?ctx=group_id', () => {
    const f = buildGroupAlertFlex(base);
    const footerJson = JSON.stringify(f.contents.footer);
    expect(footerJson).toContain('ctx=Cabc');
  });

  // R4-C: 量測 — 我也要追的 URL 帶 src=group-alert（LIFF 端據此記點擊）；
  // 主按鈕不帶（只量 viral CTA，不混入一般開卡）
  it('「我也要追」URL 帶 src=group-alert；主按鈕不帶', () => {
    const f = buildGroupAlertFlex(base);
    const btns = (f.contents.footer as { contents: { action: { label: string; uri: string } }[] }).contents;
    const joinBtn = btns.find(b => b.action.label === '我也要追')!;
    const primaryBtn = btns.find(b => b.action.label !== '我也要追')!;
    expect(joinBtn.action.uri).toContain('src=group-alert');
    expect(joinBtn.action.uri).toContain('ctx=');
    expect(primaryBtn.action.uri).not.toContain('src=');
  });

  it('單程 (returnDate=null) → body 顯示「單程 YYYY-MM-DD」', () => {
    const f = buildGroupAlertFlex({ ...base, returnDate: null });
    const bodyJson = JSON.stringify(f.contents.body);
    expect(bodyJson).toContain('單程 2026-08-14');
  });

  it('_meta 帶 subscriptionId + groupId（給 sub-checker 做 quota / dedupe）', () => {
    const f = buildGroupAlertFlex(base);
    expect(f._meta).toEqual({ subscriptionId: 42, groupId: 'Cabc' });
  });
});
