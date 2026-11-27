import { Svg, type IconProps } from './base';

/** The raised hand rising from a grave mound. Header, wordmark and favicon (src/app/icon.svg) share these paths. */
export function LazarusMark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 21.5c2.4-2.6 5.6-3.6 9.5-3.6s7.1 1 9.5 3.6" />
      <path d="M9.6 18V12.6" />
      <path d="M14.4 18v-5.6" />
      <path d="M9.6 12.6 8.8 7.6" />
      <path d="M11.2 12.4V5.4" />
      <path d="M12.8 12.4V4.8" />
      <path d="M14.4 12.6l.9-4.4" />
      <path d="M8.8 12.8c-1.2-.4-2-1.1-2.6-2.2" />
      <path d="M5.2 4.5c-1 0-1.4.6-1.4 1.4v1c0 .6-.4 1-.9 1 .5 0 .9.4.9 1v1c0 .8.4 1.4 1.4 1.4" />
      <path d="M18.8 4.5c1 0 1.4.6 1.4 1.4v1c0 .6.4 1 .9 1-.5 0-.9.4-.9 1v1c0 .8-.4 1.4-1.4 1.4" />
    </Svg>
  );
}
