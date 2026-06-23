/**
 * /api/subscriptions PATCH — schema 驗證 + payload builder 純邏輯測試。
 *
 * 為什麼測：
 *   - 每加一個新欄位（max_price_traditional、time filter）都動到這條 endpoint
 *   - HH:MM regex 寫錯會讓 user 改價失敗、且 LIFF 端錯誤訊息不清楚
 *   - undefined vs null 的語義不一致會誤把使用者已設的值清掉
 *
 * 涵蓋：
 *   - PatchBody zod schema 各欄位合法 / 非法
 *   - HH:MM regex 邊界（00:00 / 23:59 / 24:00 / -1:00 / abc）
 *   - buildPatchUpdatePayload 的 undefined vs null 行為
 *   - 空 body（只給 id+sourceId）→ payload 為空（API 會回 400 no fields）
 */

import { PatchBody, buildPatchUpdatePayload, mutationResult } from '../schema';

describe('PatchBody schema — 必填欄位', () => {
  it('id + sourceId 必填', () => {
    const result = PatchBody.safeParse({});
    expect(result.success).toBe(false);
  });

  it('只給 id + sourceId → 合法（其他欄位都 optional）', () => {
    const result = PatchBody.safeParse({ id: 1, sourceId: 'Uxxxxx' });
    expect(result.success).toBe(true);
  });

  it('id 必須是數字', () => {
    const result = PatchBody.safeParse({ id: 'not-a-number', sourceId: 'Uxxxxx' });
    expect(result.success).toBe(false);
  });
});

describe('PatchBody schema — 數字欄位', () => {
  it('maxPrice 必須是正數', () => {
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', maxPrice: 15000 }).success).toBe(true);
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', maxPrice: 0 }).success).toBe(false);
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', maxPrice: -100 }).success).toBe(false);
  });

  it('maxPriceTraditional 可為正數、null、undefined', () => {
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', maxPriceTraditional: 25000 }).success).toBe(true);
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', maxPriceTraditional: null }).success).toBe(true);
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U' }).success).toBe(true);  // 沒給 = undefined
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', maxPriceTraditional: 0 }).success).toBe(false);
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', maxPriceTraditional: -100 }).success).toBe(false);
  });
});

describe('PatchBody schema — HH:MM 時段格式', () => {
  const validTimes = ['00:00', '00:01', '09:30', '12:00', '15:45', '23:59'];
  const invalidTimes = [
    '24:00',  // 小時超過
    '23:60',  // 分鐘超過
    '9:30',   // 沒 zero-pad
    '12:5',   // 分鐘沒 zero-pad
    '12 00',  // 用空格
    '12-00',  // 用 dash
    '1200',   // 沒分隔
    'noon',   // 文字
    '',       // 空字串（要清空請用 null 不是空字串）
    '-1:00',  // 負數
    '24:60'
  ];

  for (const t of validTimes) {
    it(`合法：${t}`, () => {
      const r = PatchBody.safeParse({ id: 1, sourceId: 'U', outboundMinDepartureTime: t });
      expect(r.success).toBe(true);
    });
  }

  for (const t of invalidTimes) {
    it(`非法：${JSON.stringify(t)}`, () => {
      const r = PatchBody.safeParse({ id: 1, sourceId: 'U', outboundMinDepartureTime: t });
      expect(r.success).toBe(false);
    });
  }

  it('null 合法（清掉時段過濾）', () => {
    const r = PatchBody.safeParse({ id: 1, sourceId: 'U', outboundMinDepartureTime: null });
    expect(r.success).toBe(true);
  });

  it('4 個時段欄位都套用同一規則', () => {
    const ok = PatchBody.safeParse({
      id: 1, sourceId: 'U',
      outboundMinDepartureTime: '08:00',
      outboundMaxDepartureTime: '12:00',
      returnMinDepartureTime: '14:00',
      returnMaxDepartureTime: '18:00'
    });
    expect(ok.success).toBe(true);
  });
});

describe('buildPatchUpdatePayload — undefined vs null 語義', () => {
  it('全沒給 → 空 payload', () => {
    const payload = buildPatchUpdatePayload({ id: 1, sourceId: 'U' });
    expect(payload).toEqual({});
  });

  it('給 maxPrice → 只更新 max_price，不動其他欄位', () => {
    const payload = buildPatchUpdatePayload({ id: 1, sourceId: 'U', maxPrice: 18000 });
    expect(payload).toEqual({ max_price: 18000 });
  });

  it('給 maxPriceTraditional: null → 寫 null（清掉「傳統另設」）', () => {
    const payload = buildPatchUpdatePayload({ id: 1, sourceId: 'U', maxPriceTraditional: null });
    expect(payload).toEqual({ max_price_traditional: null });
  });

  it('給 maxPriceTraditional: 26000 → 寫 26000', () => {
    const payload = buildPatchUpdatePayload({ id: 1, sourceId: 'U', maxPriceTraditional: 26000 });
    expect(payload).toEqual({ max_price_traditional: 26000 });
  });

  it('時段 4 欄全給 → 4 個 DB 欄位都寫入', () => {
    const payload = buildPatchUpdatePayload({
      id: 1, sourceId: 'U',
      outboundMinDepartureTime: '08:00',
      outboundMaxDepartureTime: '12:00',
      returnMinDepartureTime: '14:00',
      returnMaxDepartureTime: '18:00'
    });
    expect(payload).toEqual({
      outbound_min_departure_time: '08:00',
      outbound_max_departure_time: '12:00',
      return_min_departure_time: '14:00',
      return_max_departure_time: '18:00'
    });
  });

  it('時段給 null → 寫 null（清掉該端過濾）', () => {
    const payload = buildPatchUpdatePayload({
      id: 1, sourceId: 'U',
      outboundMinDepartureTime: null,
      returnMaxDepartureTime: null
    });
    expect(payload).toEqual({
      outbound_min_departure_time: null,
      return_max_departure_time: null
    });
  });

  it('混合：給 maxPrice + 清空 traditional + 設一段時段窗口', () => {
    const payload = buildPatchUpdatePayload({
      id: 1, sourceId: 'U',
      maxPrice: 16000,
      maxPriceTraditional: null,
      outboundMaxDepartureTime: '12:00'
    });
    expect(payload).toEqual({
      max_price: 16000,
      max_price_traditional: null,
      outbound_max_departure_time: '12:00'
    });
  });

  it('paused / label 也走同一邏輯', () => {
    expect(buildPatchUpdatePayload({ id: 1, sourceId: 'U', paused: true }))
      .toEqual({ paused: true });
    expect(buildPatchUpdatePayload({ id: 1, sourceId: 'U', label: '農曆年' }))
      .toEqual({ label: '農曆年' });
    expect(buildPatchUpdatePayload({ id: 1, sourceId: 'U', label: null }))
      .toEqual({ label: null });
  });
});

describe('防回歸：欄位數量檢查', () => {
  it('PatchBody 欄位數量 = 15（id + sourceId + 13 可選）', () => {
    // 新增欄位時請順便加測試（避免靜默落地未測的欄位）。
    // 目前：id, sourceId, paused, label, maxPrice, maxPriceTraditional,
    //       outboundMin/MaxDepartureTime, returnMin/MaxDepartureTime,
    //       outboundDate, returnDate（=null → 單程）, airlineFilter（0012）,
    //       pinnedFlightNumber/pinnedFlightLabel（0013 釘選航班）
    const allOptional = PatchBody.safeParse({ id: 1, sourceId: 'U' });
    expect(allOptional.success).toBe(true);
    const shape = (PatchBody as unknown as { _def: { shape: () => Record<string, unknown> } })._def.shape();
    expect(Object.keys(shape).sort()).toEqual([
      'id', 'sourceId',
      'paused', 'label',
      'maxPrice', 'maxPriceTraditional',
      'outboundMinDepartureTime', 'outboundMaxDepartureTime',
      'returnMinDepartureTime', 'returnMaxDepartureTime',
      'outboundDate', 'returnDate', 'airlineFilter',
      'pinnedFlightNumber', 'pinnedFlightLabel'
    ].sort());
  });

  it('returnDate: null → 變單程訂閱（payload 寫 null 進 DB）', () => {
    const result = PatchBody.safeParse({ id: 1, sourceId: 'U', returnDate: null });
    expect(result.success).toBe(true);
    const payload = buildPatchUpdatePayload({ id: 1, sourceId: 'U', returnDate: null });
    expect(payload).toEqual({ return_date: null });
  });

  it('returnDate: undefined → 不動 return_date（不變單程）', () => {
    const payload = buildPatchUpdatePayload({ id: 1, sourceId: 'U' });
    expect(payload).toEqual({});
  });

  it('returnDate: "YYYY-MM-DD" → 改回程日期', () => {
    const payload = buildPatchUpdatePayload({ id: 1, sourceId: 'U', returnDate: '2027-04-04' });
    expect(payload).toEqual({ return_date: '2027-04-04' });
  });

  it('returnDate 非法格式 → schema 拒絕', () => {
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', returnDate: '2027/04/04' }).success).toBe(false);
    expect(PatchBody.safeParse({ id: 1, sourceId: 'U', returnDate: 'tomorrow' }).success).toBe(false);
  });

  it('airlineFilter：有值 → 寫；空陣列/null → 寫 null（清掉過濾）；undefined → 不動', () => {
    expect(buildPatchUpdatePayload({ id: 1, sourceId: 'U', airlineFilter: ['捷星', '酷航'] }))
      .toEqual({ airline_filter: ['捷星', '酷航'] });
    expect(buildPatchUpdatePayload({ id: 1, sourceId: 'U', airlineFilter: [] }))
      .toEqual({ airline_filter: null });
    expect(buildPatchUpdatePayload({ id: 1, sourceId: 'U', airlineFilter: null }))
      .toEqual({ airline_filter: null });
    expect(buildPatchUpdatePayload({ id: 1, sourceId: 'U' })).toEqual({});
  });
});

describe('mutationResult — PATCH/DELETE 影響筆數判斷（回報 bug 的修正）', () => {
  it('有改到列（data 非空）→ ok', () => {
    expect(mutationResult([{ id: 9 }], null)).toEqual({ ok: true });
  });

  it('0 列符合（data=[]，Supabase 對沒 match 不報錯）→ 404，不再假成功', () => {
    // 這是 bug 的核心：取消顯示成功但 id/source_id 沒對上，實際沒刪到任何列
    const r = mutationResult([], null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.error).toContain('找不到這筆訂閱');
    }
  });

  it('data=null（沒 select 回任何東西）→ 也算 404', () => {
    expect(mutationResult(null, null)).toMatchObject({ ok: false, status: 404 });
  });

  it('真的 DB error → 500 + 帶原訊息', () => {
    expect(mutationResult(null, { message: 'connection lost' }))
      .toEqual({ ok: false, status: 500, error: 'connection lost' });
  });
});
