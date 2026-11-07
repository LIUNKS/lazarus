import type { ImportErrors } from '@/lib/import/validate';

export interface ImportFormState {
  errors: ImportErrors;
  /** A form-level message such as a limit or a save failure. */
  message: string | null;
  values: { title: string; language: string; pastedCode: string; repoUrl: string };
}

export const initialImportState: ImportFormState = {
  errors: {},
  message: null,
  values: { title: '', language: '', pastedCode: '', repoUrl: '' },
};