'use client';

import { deleteCorpse } from '@/app/corpses/actions';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** Delete needs an explicit confirmation step. The Server Action checks the Member again. */
export function DeleteCorpseButton({ corpseId, title }: { corpseId: string; title: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this corpse?</AlertDialogTitle>
          <AlertDialogDescription>
            “{title}” and its stored curses, specs, and reincarnations will be removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <form action={deleteCorpse}>
            <input type="hidden" name="id" value={corpseId} />
            <Button type="submit" variant="destructive">
              Delete permanently
            </Button>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}