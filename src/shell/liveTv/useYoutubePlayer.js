// F348: React glue for the player bridge and the mute controller. Same hooks on every render.
import { useEffect, useRef } from 'react';
import { createYoutubePlayerBridge } from './youtubePlayerBridge.js';
import { createMuteController } from './muteController.js';

/**
 * active          run the bridge while true
 * onMutedChange   the player's own controls changed the mute (no command is sent back)
 * onFallback      the embed did not confirm a mute toggle: remount it with the wanted mute
 * Returns { iframeRef, requestMute(muted), getPositionS() }.
 */
export function useYoutubePlayer(active, { onMutedChange, onFallback }) {
  const iframeRef = useRef(null);
  const bridgeRef = useRef(null);
  const controllerRef = useRef(null);
  const handlers = useRef({ onMutedChange, onFallback });
  handlers.current = { onMutedChange, onFallback };

  useEffect(() => {
    if (!active) return undefined;
    const getIframe = () => iframeRef.current;
    let controller = null;
    const bridge = createYoutubePlayerBridge({ getIframe, onMutedChange: (m) => controller.notifyMuted(m) });
    controller = createMuteController({
      bridge, getIframe,
      onFallback: () => handlers.current.onFallback(),
      onMutedChange: (m) => handlers.current.onMutedChange(m),
    });
    bridgeRef.current = bridge;
    controllerRef.current = controller;
    bridge.start();
    return () => {
      controller.dispose();
      bridge.stop();
      bridgeRef.current = null;
      controllerRef.current = null;
    };
  }, [active]);

  const requestMute = (muted) => {
    if (controllerRef.current) controllerRef.current.request(muted);
    else handlers.current.onFallback();
  };
  const getPositionS = () => {
    const p = bridgeRef.current?.getSnapshot().positionS;
    return typeof p === 'number' ? Math.floor(p) : null;
  };
  return { iframeRef, requestMute, getPositionS };
}
