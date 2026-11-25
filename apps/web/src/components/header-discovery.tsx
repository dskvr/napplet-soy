import { useLocation, useNavigate, Link } from '@tanstack/react-router';
import { ChevronDown, Search, Sparkles, Terminal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { discoveryTarget } from '../../../../packages/protocol/src/discovery';
import { StudioLink } from './studio-link';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export function HeaderSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = location.pathname === '/' ? ((location.search as { q?: string }).q ?? '') : '';
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
    setError('');
  }, [location.href]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const preserve =
    location.pathname === '/'
      ? Object.entries(location.search).filter(
          ([key, value]) =>
            key !== 'q' && key !== 'page' && value && !(key === 'sort' && value === 'new'),
        )
      : [];
  return (
    <>
      <button
        type="button"
        ref={toggle}
        className="header-search-toggle"
        aria-label="Search the catalogue"
        aria-expanded={open}
        aria-controls="header-catalog-search"
        onClick={() => setOpen(!open)}
      >
        <Search size={19} />
      </button>
      <form
        id="header-catalog-search"
        role="search"
        action="/"
        method="get"
        className="header-catalog-search"
        data-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            setOpen(false);
            toggle.current?.focus();
          }
        }}
        onSubmit={(event) => {
          const field = input.current!;
          const value = field.value.trim();
          setError('');
          if (!/^(nostr:|naddr1|note1|nevent1|https?:\/\/|\/a\/|[0-9a-f]{64}$)/i.test(value)) {
            field.value = value.slice(0, 100);
            // A normal GET loads the full indexed catalogue even when arriving from a cold detail URL.
            return;
          }
          event.preventDefault();
          try {
            if (/^(?:https?:\/\/|\/a\/)/i.test(value)) {
              const url = new URL(value, window.location.origin);
              if (
                url.origin === window.location.origin &&
                /^\/a\/[a-z0-9-]+(?:\/play)?\/?$/.test(url.pathname)
              ) {
                void navigate({ to: url.pathname });
                return;
              }
            }
            void navigate({ to: discoveryTarget(value).path });
          } catch {
            setError('Enter a napplet name or paste a napplet link.');
          }
        }}
      >
        {preserve.map(([key, value]) => (
          <input type="hidden" name={key} value={String(value)} key={key} />
        ))}
        <button type="submit" aria-label="Submit search">
          <Search size={17} />
        </button>
        <input
          ref={input}
          name="q"
          type="search"
          aria-label="Search napplets"
          placeholder="Search napplets or paste a link"
          maxLength={4096}
          autoComplete="off"
          defaultValue={query}
          key={query}
          aria-invalid={!!error}
          aria-describedby={error ? 'header-search-error' : undefined}
        />
        {query && (
          <a
            className="header-search-clear"
            aria-label="Clear search"
            href={
              '/' +
              (preserve.length
                ? '?' +
                  new URLSearchParams(
                    preserve.map(([key, value]) => [key, String(value)]),
                  ).toString()
                : '')
            }
          >
            <X size={15} />
          </a>
        )}
        {error && (
          <p role="alert" id="header-search-error">
            {error}
          </p>
        )}
      </form>
      <noscript>
        <style>
          {
            '.site-header .header-search-toggle{display:none}.site-header .header-catalog-search{display:flex}'
          }
        </style>
      </noscript>
    </>
  );
}

export function CreateMenu() {
  const href = useLocation({ select: (location) => location.href });
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [href]);
  return (
    <div className="header-create-menu">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="header-create-button browser">
            <Sparkles size={16} /> Create <ChevronDown size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="create-destinations" aria-label="Create a napplet" align="end">
          <StudioLink path="/create">
            <Sparkles size={16} /> Create in browser
          </StudioLink>
          <Link to="/create" hash="local-soyli">
            <Terminal size={16} /> Use soyLI locally
          </Link>
        </PopoverContent>
      </Popover>
      <noscript>
        <style>{'.header-create-menu button{display:none}'}</style>
        <a href="/create">Create</a>
      </noscript>
    </div>
  );
}
