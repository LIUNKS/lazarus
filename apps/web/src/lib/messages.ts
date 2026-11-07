/** Fixed messages selected by short codes in the URL. Unknown codes select nothing, so no URL text is ever echoed. */
const AUTH_ERRORS: Record<string, string> = {
  callback: 'Sign-in could not be completed. Please try again.',
};

const NOTICES: Record<string, string> = {
  'already-imported': 'You already imported this code. Showing the existing corpse.',
  deleted: 'The corpse was deleted.',
  'delete-failed': 'That corpse could not be deleted.',
};

export function authErrorMessage(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(AUTH_ERRORS, code) ? (AUTH_ERRORS[code] as string) : null;
}

export function noticeMessage(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(NOTICES, code) ? (NOTICES[code] as string) : null;
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}