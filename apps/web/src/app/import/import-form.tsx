'use client';

import { useActionState, useState } from 'react';
import { importCorpse } from '@/app/import/actions';
import { initialImportState } from '@/app/import/import-state';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SOURCE_LANGUAGES } from '@/lib/data/types';
import { languageLabel } from '@/lib/ui/status';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-foreground">
      <span aria-hidden="true">⚠ </span>
      {message}
    </p>
  );
}

export function ImportForm() {
  const [state, formAction, pending] = useActionState(importCorpse, initialImportState);
  const [language, setLanguage] = useState(state.values.language);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.message ? <Notice tone="curse">{state.message}</Notice> : null}

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={400}
          defaultValue={state.values.title}
          aria-invalid={state.errors.title ? true : undefined}
          aria-describedby={state.errors.title ? 'title-error' : undefined}
        />
        <FieldError id="title-error" message={state.errors.title} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="language">Language of the code</Label>
        <input type="hidden" name="language" value={language} />
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger
            id="language"
            className="w-full sm:w-64"
            aria-invalid={state.errors.language ? true : undefined}
            aria-describedby={state.errors.language ? 'language-error' : undefined}
          >
            <SelectValue placeholder="Choose a language" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_LANGUAGES.map((option) => (
              <SelectItem key={option} value={option}>
                {languageLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError id="language-error" message={state.errors.language} />
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">Source code (up to 100 KB)</legend>
        <div className="space-y-2">
          <Label htmlFor="file">Upload a .js or .txt file</Label>
          <Input id="file" name="file" type="file" accept=".js,.txt,text/plain,text/javascript,application/javascript" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pastedCode">Or paste the code</Label>
          <Textarea
            id="pastedCode"
            name="pastedCode"
            rows={12}
            spellCheck={false}
            className="font-mono"
            defaultValue={state.values.pastedCode}
            aria-invalid={state.errors.code ? true : undefined}
            aria-describedby={state.errors.code ? 'code-error' : undefined}
          />
        </div>
        <FieldError id="code-error" message={state.errors.code} />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="repoUrl">Repository URL (optional)</Label>
        <Input
          id="repoUrl"
          name="repoUrl"
          type="url"
          inputMode="url"
          placeholder="https://github.com/owner/repo"
          defaultValue={state.values.repoUrl}
          aria-invalid={state.errors.repoUrl ? true : undefined}
          aria-describedby={state.errors.repoUrl ? 'repoUrl-error' : undefined}
        />
        <FieldError id="repoUrl-error" message={state.errors.repoUrl} />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Importing…' : 'Import corpse'}
      </Button>
    </form>
  );
}