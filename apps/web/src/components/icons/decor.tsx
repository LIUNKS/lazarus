import { Svg, type IconProps } from './base';

/** Spider web hanging in the top-right corner of a card or section (kit version, 84px). Position it absolutely. */
export function CobwebCorner({ viewBox = '0 0 84 84', strokeWidth = 1, ...props }: IconProps) {
  return (
    <Svg viewBox={viewBox} strokeWidth={strokeWidth} width={84} height={84} {...props}>
      <path d="M84 0L18 66M84 0V76M84 0H8M84 0L50 78M84 0L8 36" />
      <path d="M68 0c0 6 6 11 16 15M54 0c1 10 13 21 30 27M38 0c3 16 22 36 46 40M22 0c4 22 31 50 62 56" />
    </Svg>
  );
}

/** Larger web for the hero and page corners (Home mockup, 120px, with the dangling threads). */
export function CobwebLarge({ viewBox = '0 0 120 120', strokeWidth = 1.2, ...props }: IconProps) {
  return (
    <Svg viewBox={viewBox} strokeWidth={strokeWidth} width={120} height={120} {...props}>
      <path d="M120 0L40 80M120 0L120 110M120 0L10 0M120 0L70 110M120 0L10 50" />
      <path d="M98 0c0 8 8 16 22 22M78 0c2 14 18 30 42 38M56 0c4 22 30 50 64 56M34 0c6 32 44 72 86 80" />
      <path d="M110 24c-4 6-4 12 0 16M100 42c-8 6-10 16-6 24" />
    </Svg>
  );
}

/** Small web strand in a card top-left corner (Home mockup tag cards, 60x34). */
export function CobwebStrand({ viewBox = '0 0 60 34', strokeWidth = 1.3, ...props }: IconProps) {
  return (
    <Svg viewBox={viewBox} strokeWidth={strokeWidth} width={60} height={34} {...props}>
      <path d="M2 2c8 2 14 8 20 14s8 12 12 16" />
      <path d="M8 1c5 5 9 10 15 14" />
    </Svg>
  );
}

/** A single bat (kit "corner web and bat"). */
export function BatIcon({ viewBox = '0 0 32 32', strokeWidth = 1.3, ...props }: IconProps) {
  return (
    <Svg viewBox={viewBox} strokeWidth={strokeWidth} width={48} height={48} {...props}>
      <path d="M3 14c3-1.6 5.3-1 7 1.5.9-1.8 2.2-2.4 3-1.8.9-.6 2.1 0 3 1.8 1.6-2.5 3.9-3.1 7-1.5-2.8.6-4.6 2.4-5.2 5.2-1.5-1.2-3-1.2-4.8.6-1.8-1.8-3.3-1.8-4.8-.6C7.6 16.4 5.8 14.6 3 14z" />
    </Svg>
  );
}

/** Three bats of different sizes, the header flourish next to the sign-in button (64x22). */
export function BatsFlock({ viewBox = '0 0 64 22', strokeWidth = 1.2, ...props }: IconProps) {
  return (
    <Svg viewBox={viewBox} strokeWidth={strokeWidth} width={64} height={22} {...props}>
      <path d="M2 9c2-1 3.5-.6 4.5 1 .6-1.2 1.4-1.6 2-1.2.6-.4 1.4 0 2 1.2 1-1.6 2.5-2 4.5-1-1.8.4-3 1.6-3.4 3.4-1-.8-2-.8-3.1.4-1.1-1.2-2.1-1.2-3.1-.4C5 10.6 3.8 9.4 2 9z" />
      <path d="M40 4c1.5-.8 2.6-.4 3.4.8.4-.9 1-1.2 1.5-.9.5-.3 1.1 0 1.5.9.8-1.2 1.9-1.6 3.4-.8-1.4.3-2.3 1.2-2.6 2.6-.8-.6-1.5-.6-2.3.3-.8-.9-1.6-.9-2.3-.3C42.3 5.2 41.4 4.3 40 4z" />
      <path d="M54 15c1-.5 1.8-.3 2.3.5.3-.6.7-.8 1-.6.3-.2.7 0 1 .6.5-.8 1.3-1 2.3-.5-1 .2-1.6.8-1.8 1.8-.5-.4-1-.4-1.5.2-.5-.6-1-.6-1.5-.2-.2-1-.8-1.6-1.8-1.8z" />
    </Svg>
  );
}

/** Graveyard fence section divider. Stretches to the container width (preserveAspectRatio none); 28px tall. */
const FENCE_POSTS = Array.from({ length: 22 }, (_, i) => {
  const x = 24 + i * 48;
  return `M${x} 26V6l-3-4M${x} 6l3-4`;
}).join('');

export function FenceDivider({ className, ...props }: IconProps) {
  return (
    <Svg
      viewBox="0 0 1072 28"
      preserveAspectRatio="none"
      width="100%"
      height={28}
      className={['block', className].filter(Boolean).join(' ')}
      {...props}
    >
      <path d="M0 22h1072M0 10h1072" />
      <path d={FENCE_POSTS} />
    </Svg>
  );
}

/** Candle loader. The flame has class `flame` (flickers unless reduced motion) and a translucent ember fill. */
export function CandleIcon({ strokeWidth = 1.4, ...props }: IconProps) {
  return (
    <Svg strokeWidth={strokeWidth} {...props}>
      <path
        className="flame stroke-ember"
        fill="rgb(242 131 43 / 0.18)"
        d="M12 2.5c1.8 2.2 2.6 3.7 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.3.8-2.8 2.6-5z"
      />
      <path d="M12 10.1v1.4M9.5 11.5h5v9h-5zM7 20.5h10" />
    </Svg>
  );
}

/** Morph pair 1: flat line and heartbeat. Exported as raw `d` strings for MorphSVGPlugin. */
export const HEARTBEAT_FLAT_D = 'M0 14h70';
export const HEARTBEAT_PULSE_D = 'M0 14h22l4-10 7 20 5-14 3 4h29';
export const HEARTBEAT_PULSE_LARGE_D = 'M0 24h34l6-14 10 28 7-20 5 6h58';

/** Heartbeat line (70x28). `pulse` false renders the flat line. Pair with text-verified for the pulse. */
export function HeartbeatLine({ pulse = true, strokeWidth = 1.6, ...props }: IconProps & { pulse?: boolean }) {
  return (
    <Svg viewBox="0 0 70 28" strokeWidth={strokeWidth} width={70} height={28} {...props}>
      <path d={pulse ? HEARTBEAT_PULSE_D : HEARTBEAT_FLAT_D} />
    </Svg>
  );
}

/** Large heartbeat line under the corpse detail verdict (120x44). */
export function HeartbeatLarge({ strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <Svg viewBox="0 0 120 44" strokeWidth={strokeWidth} width={120} height={44} {...props}>
      <path d={HEARTBEAT_PULSE_LARGE_D} />
    </Svg>
  );
}

/** Morph pair 2: skull outline (no features) and raised hand, for the verify morph. */
export const SKULL_OUTLINE_D = 'M12 3a7 7 0 0 0-7 7c0 2.4 1.1 4 2.5 5v3.5h9V15c1.4-1 2.5-2.6 2.5-5a7 7 0 0 0-7-7z';
export const RAISED_HAND_D =
  'M7.5 21v-6.5L5 11.5c-.6-.8 0-2 1-1.6l1.5 1.6V5.5a1 1 0 0 1 2 0V10V3.5a1 1 0 0 1 2 0V10V4.2a1 1 0 0 1 2 0V10V5.6a1 1 0 0 1 2 0v8.4L15 21z';

export function SkullOutlineIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d={SKULL_OUTLINE_D} />
    </Svg>
  );
}

export function RaisedHandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d={RAISED_HAND_D} />
    </Svg>
  );
}

/** Morph pair 3: closed eye and open eye (scan). */
export const EYE_CLOSED_D = 'M6.5 12c1.6 1.4 3.4 2 5.5 2s3.9-.6 5.5-2';
export const EYE_OPEN_D = 'M6.5 12c1.6-2.4 3.4-3.6 5.5-3.6s3.9 1.2 5.5 3.6c-1.6 2.4-3.4 3.6-5.5 3.6S8.1 14.4 6.5 12z';

export function EyeClosedIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d={EYE_CLOSED_D} />
    </Svg>
  );
}

export function EyeOpenIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d={EYE_OPEN_D} />
      <circle cx="12" cy="12" r="1.6" />
    </Svg>
  );
}
