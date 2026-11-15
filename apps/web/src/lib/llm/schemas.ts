// zod schemas for the structured output of the two LLM stages. Pure module.
// They check types and the exact key set only. Length and content rules live in the pure validators
// (seance-validate.ts and static-gate.ts), so the strict JSON schema sent to the provider stays simple
// and every broken rule gets a name for the repair prompt.
import { z } from 'zod';

export const SeanceOutputSchema = z
  .object({
    requirementsMd: z.string(),
    designMd: z.string(),
    invariants: z
      .object({
        entry_function: z.string(),
        input: z.string(),
        output: z.string(),
        invariants: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type SeanceOutput = z.infer<typeof SeanceOutputSchema>;

export const ReincarnationOutputSchema = z
  .object({
    modernCode: z.string(),
    pbtTestCode: z.string(),
  })
  .strict();
export type ReincarnationOutput = z.infer<typeof ReincarnationOutputSchema>;
