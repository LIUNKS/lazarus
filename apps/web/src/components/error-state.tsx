import { Notice } from '@/components/notice';

/** Generic failure message. It never shows database or Supabase error text. */
export function ErrorState({ what = 'this page' }: { what?: string }) {
  return (
    <Notice tone="curse" title="Something went wrong">
      We could not load {what}. Try again in a moment.
    </Notice>
  );
}