/**
 * parseDeepLink — L3 Rich Menu deep link 解析
 *
 * 為什麼測：rich menu 6 格全指向這些參數 — 解析錯 = 整個選單按了沒反應。
 * 不認得的值必須回 null（舊版選單圖 / 使用者亂改 URL 不能炸、不能開錯 sheet）。
 */
import { parseDeepLink } from '../WatchlistView';

describe('parseDeepLink', () => {
  it('rich menu 6 格的參數全部解析正確', () => {
    expect(parseDeepLink('?action=add')).toEqual({ action: 'add', filter: null, src: null });
    expect(parseDeepLink('?action=settings')).toEqual({ action: 'settings', filter: null, src: null });
    expect(parseDeepLink('?filter=hit')).toEqual({ action: null, filter: 'hit', src: null });
    expect(parseDeepLink('?filter=group')).toEqual({ action: null, filter: 'group', src: null });
    expect(parseDeepLink('')).toEqual({ action: null, filter: null, src: null }); // 我的訂閱（無參數）
  });

  it('action + filter 可並存；與既有 ?ctx= 不互撞', () => {
    expect(parseDeepLink('?ctx=Cabc123&action=add&filter=hit'))
      .toEqual({ action: 'add', filter: 'hit', src: null });
  });

  it('不認得的值 → null（不開錯 sheet、不套錯 filter）', () => {
    expect(parseDeepLink('?action=delete-everything')).toEqual({ action: null, filter: null, src: null });
    expect(parseDeepLink('?filter=all')).toEqual({ action: null, filter: null, src: null }); // all 是預設、不需深連結
    expect(parseDeepLink('?action=&filter=')).toEqual({ action: null, filter: null, src: null });
  });

  // R4-C: 量測來源標記
  it('src=group-alert（群組卡「我也要追」）→ 解析；白名單外 → null', () => {
    expect(parseDeepLink('?ctx=Cabc&src=group-alert'))
      .toEqual({ action: null, filter: null, src: 'group-alert' });
    expect(parseDeepLink('?src=spam-injection'))
      .toEqual({ action: null, filter: null, src: null });
  });
});
