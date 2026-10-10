import type { ReactNode } from "react";

const PATHS = {
  camera: (
    <>
      <path d="M4 8.5h3l1.8-2.8h6.4L17 8.5h3V19H4z" />
      <circle cx="12" cy="13.3" r="3.3" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.7" />
      <path d="m20 16-4.8-4.8L6.5 19.5" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="9.5" cy="7" rx="5.5" ry="2.6" />
      <path d="M4 7v4.2c0 1.4 2.5 2.6 5.5 2.6" />
      <ellipse cx="14.5" cy="13" rx="5.5" ry="2.6" />
      <path d="M9 13v4.2c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6V13" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18.5V6M3 14.5h18v4M21 14.5v-2.8A3.2 3.2 0 0 0 17.8 8.5H11v6" />
      <circle cx="7" cy="11" r="1.9" />
    </>
  ),
  car: (
    <>
      <path d="M5 16.5H4v-4l1.8-4.6A2 2 0 0 1 7.7 6.5h8.6a2 2 0 0 1 1.9 1.4l1.8 4.6v4h-1" />
      <path d="M4 12.5h16M9 16.5h6" />
      <circle cx="7" cy="16.5" r="1.8" />
      <circle cx="17" cy="16.5" r="1.8" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M7.5 20h9M5 7.5h14M12 4.5 5 7.5M12 4.5l7 3" />
      <path d="m5 7.5-2.5 6a2.5 2.5 0 0 0 5 0zM19 7.5l-2.5 6a2.5 2.5 0 0 0 5 0z" />
    </>
  ),
  share: (
    <>
      <path d="M12 14.5V4M8 8l4-4 4 4" />
      <path d="M5.5 12v7.5h13V12" />
    </>
  ),
  home: <path d="M4 11 12 4.5l8 6.5v8a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9V20H5.5A1.5 1.5 0 0 1 4 18.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  arrowRight: <path d="M5 12h14m-5-5 5 5-5 5" />,
  arrowLeft: <path d="M19 12H5m5-5-5 5 5 5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  sparkle: <path d="M12 3.5 13.9 10l6.6 2-6.6 2L12 20.5 10.1 14l-6.6-2 6.6-2zM19 3v3.5M17.2 4.8h3.6" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" />
      <path d="M10 8 6 12l4 4M6 12h9.5" />
    </>
  ),
  edit: <path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10zM13.5 7l3.5 3.5" />,
  trash: <path d="M4.5 7h15M10 4h4M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12M10 10.5v6M14 10.5v6" />,
  download: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 13.8a5.5 5.5 0 0 1 3.5 5.2" />
    </>
  ),
  bolt: <path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
