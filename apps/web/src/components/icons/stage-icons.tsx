import { Svg, type IconProps } from './base';

/** Stage 1, "Morgue": a specimen jar with a stitch. Colour it with text-foreground; the dot is ember. */
export function MorgueIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 2.5h6l3.2 4.8L16 21.5H8L5.8 7.3z" />
      <path d="M9.5 9.5h5" />
      <path d="M12 7.5v5" />
      <path d="M16.6 17.4l3.6 1.6-1 2.6-3.9-1" />
      <circle cx="19.3" cy="19.4" r=".5" className="stroke-ember" />
    </Svg>
  );
}

/** Stage 2, "Hex Scanner": a sun-ringed eye. Pair with text-curse-text. */
export function HexScannerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 2.5v1.6M12 19.9v1.6M2.5 12h1.6M19.9 12h1.6M5.3 5.3l1.1 1.1M17.6 17.6l1.1 1.1M18.7 5.3l-1.1 1.1M6.4 17.6l-1.1 1.1" />
      <path d="M6.5 12c1.6-2.4 3.4-3.6 5.5-3.6s3.9 1.2 5.5 3.6c-1.6 2.4-3.4 3.6-5.5 3.6S8.1 14.4 6.5 12z" />
      <circle cx="12" cy="12" r="1.6" />
    </Svg>
  );
}

/** Stage 3, "Séance": a candle on a holder. The flame has class `flame` (flickers unless reduced motion). Pair with text-spectral. */
export function SeanceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path className="flame" d="M12 2.5c1.6 2 2.2 3.3 2.2 4.4a2.2 2.2 0 0 1-4.4 0c0-1.1.6-2.4 2.2-4.4z" />
      <path d="M12 9.1v1.4" />
      <path d="M10 10.5h4v6h-4z" />
      <path d="M4.5 16.5c0-1.4 1.1-2.2 2.4-2l10.2 0c1.3-.2 2.4.6 2.4 2 0 2.6-3.4 5-7.5 5s-7.5-2.4-7.5-5z" />
      <circle cx="12" cy="18.6" r="1.1" />
    </Svg>
  );
}

/** Stage 4, "Laboratory": a flask with a bolt. Pair with text-verified. */
export function LaboratoryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 2.5h6" />
      <path d="M10 2.5v6.3L4.6 18.4a2 2 0 0 0 1.8 3.1h11.2a2 2 0 0 0 1.8-3.1L14 8.8V2.5" />
      <path d="M12.8 11.5l-2.4 3.6h3.2l-2.4 3.6" />
    </Svg>
  );
}
