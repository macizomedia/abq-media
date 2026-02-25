
import { z } from 'zod';

export const RecipeSchema = z.object({
  name: z.string(),
  source: z.object({
    engine: z.string(),
    url: z.string().url(),
  }),
  transcription: z.object({
    engine: z.string(),
  }),
  tts: z.object({
    engine: z.string(),
  }),
  video: z.object({
    engine: z.string(),
  }),
});

export type Recipe = z.infer<typeof RecipeSchema>;
