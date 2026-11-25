import { useCallback } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';

/** Presentation of the current identity, never a different player or publication. */
export function usePlayRoute() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const state = useLocation({ select: (location) => ({ browseFrom: location.state.browseFrom }) });
  const navigate = useNavigate();
  const path = pathname.replace(/\/$/, '');
  const immersive = path.endsWith('/play');
  const detailPath = immersive ? path.slice(0, -5) : path;
  const playPath = `${detailPath}/play`;
  const enter = useCallback(() => {
    void navigate({ to: playPath, state, resetScroll: false });
  }, [navigate, playPath, state]);
  const exit = useCallback(() => {
    // A fresh play link may have an unrelated previous page. Never blindly go Back.
    void navigate({ to: detailPath, state, replace: true, resetScroll: false });
  }, [navigate, detailPath, state]);
  return { state, immersive, detailPath, playPath, enter, exit };
}
