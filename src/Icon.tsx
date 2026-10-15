// Line icons (24-unit grid, drawn in currentColor), after Tabler's shapes.
const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  adjustments: <><circle cx="14" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="17" cy="18" r="2" /><path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h11M19 18h1" /></>,
  eye: <><circle cx="12" cy="12" r="2.5" /><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /></>,
  'eye-off': <><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 6.3A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.1M16.6 16.6A9.5 9.5 0 0 1 12 18c-6 0-9.5-6-9.5-6a17 17 0 0 1 4.4-4.6M3 3l18 18" /></>,
  volume: <path d="M4 9.5h3l5-4v13l-5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />,
  'volume-off': <path d="M4 9.5h3l5-4v13l-5-4H4zM16 10l4 4M20 10l-4 4" />,
  view: <><path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3.2-3.5 3.2H15a2 2 0 0 0-1.4 3.4A1.5 1.5 0 0 1 12 21z" /><circle cx="7.6" cy="11" r="1" /><circle cx="11" cy="7.4" r="1" /><circle cx="15.6" cy="8.6" r="1" /></>,
  cube: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />,
  square: <rect x="5" y="5" width="14" height="14" rx="2" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  play: <path d="M8 5.5v13l10-6.5z" />,
  pause: <path d="M9 6v12M15 6v12" />,
  'hand-stop': <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 5.5v-2a1.5 1.5 0 0 1 3 0V12M14 5.5a1.5 1.5 0 0 1 3 0V12M17 7.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L3.8 13.4a1.5 1.5 0 0 1 .5-2 1.9 1.9 0 0 1 2.3.3L8 13" />,
  'arrow-back-up': <path d="M9 14l-4-4 4-4M5 10h11a4 4 0 0 1 0 8h-1" />,
  'sun-low': <><circle cx="12" cy="13" r="3.5" /><path d="M3 20h18M4.5 13h1M18.5 13h1M12 5.5v1M6.7 7.7l.7.7M17.3 7.7l-.7.7" /></>,
  flag: <path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5" />,
  review: <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 3.5v5h5M12 8v4l2.5 2.5" />,
  book: <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0M3 6v13M12 6v13M21 6v13" />,
  calendar: <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 3v4M8 3v4M4 11h16M8 15h2v2H8z" />,
  library: <path d="M5 4h3v16H5zM10 4h3v16h-3zM15.2 4.8l2.9-.8 3.4 15.4-2.9.8z" />,
  share: <path d="M12 15V4M8 8l4-4 4 4M7 11H5v9h14v-9h-2" />,
  target: <><circle cx="12" cy="12" r="1" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="9" /></>,
}

export type IconName = keyof typeof ICONS
export const Icon = ({ name }: { name: IconName }) => <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>
