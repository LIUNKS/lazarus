'use server';

import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth/member';
import { countOwnedCorpses, findOwnedCorpseIdByHash, insertCorpse } from '@/lib/data/corpses';
import { sha256Hex } from '@/lib/import/hash';
import { IMPORT_LIMITS } from '@/lib/import/limits';
import { validateImport, type ImportFile } from '@/lib/import/validate';
import { createClient } from '@/lib/supabase/server';
import type { ImportFormState } from './import-state';

const SAVE_FAILED = 'The corpse could not be saved. Try again later.';

/** Reads the uploaded file on the server. The size is checked before the bytes are read into a string. */
async function readUpload(entry: FormDataEntryValue | null): Promise<ImportFile> {
  if (!(entry instanceof File) || entry.size === 0) return { kind: 'none' };
  if (entry.size > IMPORT_LIMITS.maxBytes) return { kind: 'too-large' };
  const bytes = await entry.arrayBuffer();
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { kind: 'invalid-utf8' };
  }
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Imports legacy JavaScript as an owned corpse. The code is only normalized and hashed: it is never
 * parsed, evaluated, or sent to a model. The write uses the Member's own session, so RLS applies.
 */
export async function importCorpse(_previous: ImportFormState, formData: FormData): Promise<ImportFormState> {
  const member = await requireMember('/import');

  const values = {
    title: text(formData, 'title'),
    language: text(formData, 'language'),
    pastedCode: text(formData, 'pastedCode'),
    repoUrl: text(formData, 'repoUrl'),
  };
  const validation = validateImport({ ...values, file: await readUpload(formData.get('file')) });
  if (!validation.ok) return { errors: validation.errors, message: null, values };

  const { value } = validation;
  const codeHash = await sha256Hex(value.code);

  let destination: string;
  try {
    const supabase = await createClient();

    const existing = await findOwnedCorpseIdByHash(supabase, member.id, codeHash);
    if (existing) {
      destination = `/corpses/${existing}?notice=already-imported`;
    } else {
      const owned = await countOwnedCorpses(supabase, member.id);
      if (owned >= IMPORT_LIMITS.maxCorpses) {
        return {
          errors: {},
          message: `You have reached the limit of ${IMPORT_LIMITS.maxCorpses} corpses. Delete one in The Crypt to import another.`,
          values,
        };
      }
      const id = await insertCorpse(supabase, {
        memberId: member.id,
        title: value.title,
        sourceLanguage: value.language,
        originalCode: value.code,
        codeHash,
        repoUrl: value.repoUrl,
      });
      destination = `/corpses/${id}`;
    }
  } catch {
    // The data layer already logged the cause. The browser only gets a generic message.
    return { errors: {}, message: SAVE_FAILED, values };
  }

  redirect(destination);
}