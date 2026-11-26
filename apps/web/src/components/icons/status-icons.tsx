import { Svg, type IconProps } from './base';

/** INFECTED: skull. Used inside status badges (strokeWidth 1.8 at 16px). */
export function InfectedIcon({ strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <Svg strokeWidth={strokeWidth} {...props}>
      <path d="M12 3a7 7 0 0 0-7 7c0 2.4 1.1 4 2.5 5v3.5h9V15c1.4-1 2.5-2.6 2.5-5a7 7 0 0 0-7-7z" />
      <circle cx="9.3" cy="10.5" r="1.4" />
      <circle cx="14.7" cy="10.5" r="1.4" />
      <path d="M10.5 18.5v2M13.5 18.5v2" />
    </Svg>
  );
}

/** FAILED: cracked tombstone. */
export function FailedIcon({ strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <Svg strokeWidth={strokeWidth} {...props}>
      <path d="M6 21V9a6 6 0 0 1 12 0v12" />
      <path d="M13 3.2l-1.8 4 2.2 2.3-1.8 3.3" />
      <path d="M4 21h16" />
    </Svg>
  );
}

/** IN_SEANCE: flame. */
export function InSeanceIcon({ strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <Svg strokeWidth={strokeWidth} {...props}>
      <path d="M12 3c3 3.5 5 6 5 9.5a5 5 0 0 1-10 0C7 10 8.5 8 10 6.5c0 2 1 3 2 3.5z" />
    </Svg>
  );
}

/** Heartbeat pulse. RESURRECTED badge and "verified" markers (strokeWidth 2). */
export function ResurrectedIcon({ strokeWidth = 2, ...props }: IconProps) {
  return (
    <Svg strokeWidth={strokeWidth} {...props}>
      <path d="M2.5 12.5h4.5l2-5 3.5 10 2.2-5h6.8" />
    </Svg>
  );
}
