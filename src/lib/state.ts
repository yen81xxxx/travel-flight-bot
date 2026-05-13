import { getSupabase } from './supabase';
import type { ConversationState } from '@/types';

/**
 * 建立 idle 狀態的預設值
 */
function createIdleState(sourceId: string): ConversationState {
  return {
    source_id: sourceId,
    state: 'idle',
    context: {}
  };
}

/**
 * 取得指定 sourceId 的對話狀態。沒紀錄時回傳 idle。
 */
export async function getState(sourceId: string): Promise<ConversationState> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('source_id', sourceId)
    .maybeSingle();

  if (error) {
    console.error('[state] read error:', error);
    return createIdleState(sourceId);
  }
  return data ? (data as ConversationState) : createIdleState(sourceId);
}

/**
 * 寫入/更新指定 sourceId 的對話狀態（upsert）。
 */
export async function setState(state: ConversationState): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('conversation_state')
    .upsert(
      {
        source_id: state.source_id,
        state: state.state,
        context: state.context,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'source_id' }
    );
  if (error) {
    console.error('[state] write error:', error);
    throw error;
  }
}

/**
 * 重置成 idle
 */
export async function resetState(sourceId: string): Promise<void> {
  await setState(createIdleState(sourceId));
}
