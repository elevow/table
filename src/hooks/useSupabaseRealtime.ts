import { useEffect, useRef } from 'react';
import { getSupabaseBrowser } from '../lib/realtime/supabaseClient';

type Callbacks = {
  onSeatClaimed?: (p: { seatNumber: number; playerId: string; playerName: string; chips: number }) => void;
  onSeatVacated?: (p: { seatNumber: number; playerId: string }) => void;
  onSeatState?: (p: { seats: Record<number, { playerId: string; playerName: string; chips: number } | null> }) => void;
  onGameStateUpdate?: (p: { gameState: any; lastAction?: any }) => void;
  onAwaitingDealerChoice?: (p: any) => void;
  onRebuyPrompt?: (p: any) => void;
  onRebuyResult?: (p: any) => void;
};

// Track active channels to prevent conflicts when multiple components subscribe
// Store callback refs instead of callback objects so we always get the latest version
const activeChannels = new Map<string, { 
  channel: any; 
  refCount: number; 
  callbackRefs: Set<React.MutableRefObject<Callbacks | undefined>>;
}>();

export function useSupabaseRealtime(tableId?: string | string[], callbacks?: Callbacks) {
  const tbl = typeof tableId === 'string' ? tableId : Array.isArray(tableId) ? tableId[0] : undefined;
  const cbsRef = useRef<Callbacks | undefined>(callbacks);
  cbsRef.current = callbacks;

  useEffect(() => {
    if (!tbl) return;
    const supa = getSupabaseBrowser();
    if (!supa) return;
    
    const channelName = `table:${tbl}`;
    let channelEntry = activeChannels.get(channelName);
    
    // If no active channel for this table, create one
    if (!channelEntry) {
      const channel = supa.channel(channelName);
      channelEntry = { 
        channel, 
        refCount: 0, 
        callbackRefs: new Set() 
      };
      
      // Set up event handlers that dispatch to all registered callback refs
      // Using refs ensures we always call the latest callback version
      channel
        .on('broadcast', { event: 'seat_claimed' }, (p) => {
          channelEntry!.callbackRefs.forEach(ref => {
            try { ref.current?.onSeatClaimed?.(p.payload); } catch (e) { console.error('[realtime] seat_claimed error:', e); }
          });
        })
        .on('broadcast', { event: 'seat_vacated' }, (p) => {
          channelEntry!.callbackRefs.forEach(ref => {
            try { ref.current?.onSeatVacated?.(p.payload); } catch (e) { console.error('[realtime] seat_vacated error:', e); }
          });
        })
        .on('broadcast', { event: 'seat_state' }, (p) => {
          channelEntry!.callbackRefs.forEach(ref => {
            try { ref.current?.onSeatState?.(p.payload); } catch (e) { console.error('[realtime] seat_state error:', e); }
          });
        })
        .on('broadcast', { event: 'game_state_update' }, (p) => {
          console.log('[realtime] game_state_update broadcast received, seq:', p?.payload?.seq, 'refs:', channelEntry!.callbackRefs.size);
          channelEntry!.callbackRefs.forEach(ref => {
            try { ref.current?.onGameStateUpdate?.(p.payload); } catch (e) { console.error('[realtime] game_state_update error:', e); }
          });
        })
        .on('broadcast', { event: 'awaiting_dealer_choice' }, (p) => {
          channelEntry!.callbackRefs.forEach(ref => {
            try { ref.current?.onAwaitingDealerChoice?.(p.payload); } catch (e) { console.error('[realtime] awaiting_dealer_choice error:', e); }
          });
        })
        .on('broadcast', { event: 'rebuy_prompt' }, (p) => {
          channelEntry!.callbackRefs.forEach(ref => {
            try { ref.current?.onRebuyPrompt?.(p.payload); } catch (e) { console.error('[realtime] rebuy_prompt error:', e); }
          });
        })
        .on('broadcast', { event: 'rebuy_result' }, (p) => {
          channelEntry!.callbackRefs.forEach(ref => {
            try { ref.current?.onRebuyResult?.(p.payload); } catch (e) { console.error('[realtime] rebuy_result error:', e); }
          });
        })
        .subscribe();
      
      activeChannels.set(channelName, channelEntry);
    }
    
    // Register this hook's callback ref
    channelEntry.refCount++;
    channelEntry.callbackRefs.add(cbsRef);

    return () => {
      if (channelEntry) {
        // Remove our callback ref
        channelEntry.callbackRefs.delete(cbsRef);
        channelEntry.refCount--;
        
        // If no more subscribers, clean up the channel
        if (channelEntry.refCount <= 0) {
          try { channelEntry.channel.unsubscribe(); } catch {}
          activeChannels.delete(channelName);
        }
      }
    };
  }, [tbl]);
}
