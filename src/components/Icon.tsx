const PATHS = {
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M9.5 4.5v15" /></>,
  panel: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M3.5 14.5h17" /></>,
  full: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  keys: <><rect x="2.5" y="6" width="19" height="12" rx="1.5" /><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14h8" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  play: <path d="M7 5v14l11-7z" fill="currentColor" />,
  pause: <path d="M8 5v14M16 5v14" strokeWidth="3" />,
  back: <path d="m14.5 6-6 6 6 6" />,
  down: <path d="m6 9.5 6 6 6-6" />,
  right: <path d="m9.5 6 6 6-6 6" />,
  replay: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></>,
  check: <path d="m6 12.5 4 4 8-9" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  layers: <path d="m12 4 8.5 4.5L12 13 3.5 8.5Zm-8.5 8L12 16.5l8.5-4.5M3.5 15.5 12 20l8.5-4.5" />,
  sequence: <path d="M6 3.5v17M18 3.5v17M6 8h10.5m-2-2 2 2-2 2M18 15H7.5m2-2-2 2 2 2" />,
  skip: <path d="m6 6 6 6-6 6M13 6l6 6-6 6" />,
  fast: <path d="M4 6.5v11l7.5-5.5zm8.5 0v11l7.5-5.5z" fill="currentColor" />,
  next: <path d="m8 6 6 6-6 6M17 6v12" />,
  prev: <path d="m16 6-6 6 6 6M7 6v12" />,
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />,
  events: <path d="M4 6.5h16M4 12h16M4 17.5h10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  recenter: <>
    <circle cx="12" cy="12" r="6.5" />
    <path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </>,
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`ico ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
