import type { ReactNode, SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Accessible name. Omit for decorative icons (the default): they are hidden from assistive technology. */
  title?: string;
};

/** Line-icon shell: currentColor stroke, round caps, hidden from screen readers unless a `title` is given. */
export function Svg({
  title,
  children,
  viewBox = '0 0 24 24',
  strokeWidth = 1.5,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
      {...props}
    >
      {children}
    </svg>
  );
}
