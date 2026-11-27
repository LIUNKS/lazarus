import { Svg, type IconProps } from './base';

/** Empty crypt: a mausoleum with an ember cross (150x104). Colours come from tokens via Tailwind stroke/fill classes. */
export function MausoleumArt(props: IconProps) {
  return (
    <Svg viewBox="0 0 150 104" width={150} height={104} {...props}>
      <path d="M20 98V46L75 10l55 36v52" className="stroke-muted-foreground" />
      <path d="M8 98h134" className="stroke-muted-foreground" />
      <path d="M52 98V60a23 23 0 0 1 46 0v38" className="stroke-foreground fill-background" />
      <path d="M75 22v12M69 27h12" className="stroke-ember" />
      <path d="M30 98c4-6 8-6 12 0M108 98c4-6 8-6 12 0" className="stroke-border" />
    </Svg>
  );
}

/** 404 tombstone with "RIP" (140x170). The text is decorative; give the page its own heading. */
export function TombstoneArt(props: IconProps) {
  return (
    <Svg viewBox="0 0 140 170" width={140} height={170} strokeWidth={1.6} {...props}>
      <path d="M24 156V62a46 46 0 0 1 92 0v94" className="fill-muted stroke-muted-foreground" />
      <path d="M10 158c14-6 32-8 60-8s46 2 60 8" className="stroke-muted-foreground" />
      <text x="70" y="76" textAnchor="middle" fontFamily="var(--font-cinzel), Georgia, serif" fontSize="26" fontWeight="700" className="fill-foreground" stroke="none">
        RIP
      </text>
      <text x="70" y="112" textAnchor="middle" fontFamily="var(--font-jetbrains), monospace" fontSize="22" className="fill-ember" stroke="none">
        404
      </text>
      <path d="M44 130h52" className="stroke-border" />
    </Svg>
  );
}

/** Error state: a ghost with crossed eyes and a lightning crack (130x140). */
export function GhostArt(props: IconProps) {
  return (
    <Svg viewBox="0 0 130 140" width={130} height={140} strokeWidth={1.6} {...props}>
      <path d="M25 120V62a40 40 0 0 1 80 0v58l-10-8-10 10-10-10-10 10-10-10-10 10-10-10z" className="stroke-foreground fill-muted" />
      <path d="M68 22l-6 18 8 6-6 14" className="stroke-curse" strokeWidth={1.8} />
      <path d="M48 66l8 8M56 66l-8 8M76 66l8 8M84 66l-8 8" className="stroke-curse-text" strokeWidth={1.8} />
      <path d="M54 94c6-5 16-5 22 0" className="stroke-muted-foreground" />
    </Svg>
  );
}
