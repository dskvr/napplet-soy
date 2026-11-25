import { Link, useLocation, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';

type BrowseOrigin = { href: string; index: number };
declare module '@tanstack/react-router' {
  interface HistoryState {
    browseFrom?: BrowseOrigin;
  }
}

const collection = (path: string) => path === '/' || path === '/gg' || path === '/saved';
const focusSlot = 'napplet.discovery.return-focus';

export function useDiscoveryLink() {
  const location = useLocation();
  if (!collection(location.pathname)) return {};
  const origin = { href: location.href, index: location.state.__TSR_index };
  return {
    state: { browseFrom: origin },
    onClickCapture(event: MouseEvent<HTMLAnchorElement>) {
      if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const link = event.currentTarget;
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href]'));
      const similar = links.filter(
        (other) => other.href === link.href && other.className === link.className,
      );
      // Only a tab-local return marker for the current browser history entry.
      try {
        sessionStorage.setItem(
          focusSlot,
          JSON.stringify({
            key: location.state.__TSR_key,
            href: link.href,
            className: link.className,
            match: similar.indexOf(link),
            scroll: window.scrollY,
            gridScroll: link.closest('[data-gamegrid-scroll]')?.scrollTop,
          }),
        );
      } catch {
        /* Browser history still restores scroll when storage is unavailable. */
      }
    },
  };
}

export function useRestoreDiscoveryFocus() {
  const location = useLocation();
  useEffect(() => {
    if (!collection(location.pathname)) return;
    let marker;
    try {
      marker = JSON.parse(sessionStorage.getItem(focusSlot) ?? 'null');
    } catch {
      return;
    }
    if (!marker || !marker.key || marker.key !== location.state.__TSR_key) return;
    const restore = () => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href]'));
      const link = links.filter(
        (other) => other.href === marker.href && other.className === marker.className,
      )[marker.match];
      if (!link) return false;
      link.focus({ preventScroll: true });
      const grid = link.closest('[data-gamegrid-scroll]');
      if (grid && typeof marker.gridScroll === 'number') grid.scrollTop = marker.gridScroll;
      window.scrollTo({ top: marker.scroll, behavior: 'instant' });
      return true;
    };
    // Saved items and relay-backed tiles can appear after the route has mounted.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (restore()) observer.disconnect();
    });
    const frame = requestAnimationFrame(() => {
      if (!restore()) {
        observer.observe(document.getElementById('main') ?? document.body, {
          childList: true,
          subtree: true,
        });
        timer = setTimeout(() => observer.disconnect(), 3500);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [location.state.__TSR_key, location.pathname]);
}

export function DiscoveryBackLink() {
  const router = useRouter();
  const location = useLocation();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // SSR and the first hydrated render must agree, including after reloading a detail page.
  const origin = ready ? location.state.browseFrom : undefined;
  const pathname = origin?.href.split(/[?#]/, 1)[0];
  const valid = origin && pathname !== undefined && collection(pathname);
  return valid ? (
    <a
      className="back-link"
      href={origin.href}
      onClick={(event) => {
        const distance = location.state.__TSR_index - origin.index;
        if (
          distance <= 0 ||
          event.button ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey
        )
          return;
        event.preventDefault();
        router.history.go(-distance);
      }}
    >
      <ArrowLeft size={14} />
      {pathname === '/gg'
        ? 'Back to Game Grid'
        : pathname === '/saved'
          ? 'Back to saved napplets'
          : 'Back to results'}
    </a>
  ) : (
    <Link to="/" className="back-link">
      <ArrowLeft size={14} />
      Back to the playground
    </Link>
  );
}
