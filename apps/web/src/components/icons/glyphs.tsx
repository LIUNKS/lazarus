import { Svg, type IconProps } from './base';

/** FATAL severity: skull and crossbones. */
export function SkullCrossbonesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5a5.5 5.5 0 0 0-5.5 5.5c0 1.9.9 3.1 2 3.9V14h7v-2.1c1.1-.8 2-2 2-3.9A5.5 5.5 0 0 0 12 2.5z" />
      <circle cx="10" cy="8.3" r="1" />
      <circle cx="14" cy="8.3" r="1" />
      <path d="M4 16.5l16 5M20 16.5l-16 5" />
    </Svg>
  );
}

/** BLOOD CURSE severity: blood drop. */
export function BloodDropIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z" />
      <path d="M9.5 14.5a2.5 2.5 0 0 0 2 2.4" />
    </Svg>
  );
}

/** Compact blood drop (no highlight) for 12-14px chips. */
export function BloodDropSmallIcon({ strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <Svg strokeWidth={strokeWidth} {...props}>
      <path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z" />
    </Svg>
  );
}

/** HEX severity: hexagon sigil. Also used as the 12-14px chip glyph. */
export function HexSigilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z" />
      <path d="M12 7.5v9M8 10l8 4M16 10l-8 4" />
    </Svg>
  );
}
