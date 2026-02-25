export type RecipeStageName =
  | 'transcript'
  | 'research-prompt'
  | 'research'
  | 'script'
  | 'tts'
  | 'article'
  | 'translate'
  | 'video-script';

export interface RecipeStage {
  name: RecipeStageName;
  enabled: boolean;
  prompt?: string;
  [key: string]: unknown;
}

export interface Recipe {
  name: string;
  description?: string;
  version?: number;
  base?: string;
  stages: RecipeStage[];
  output?: {
    keep_intermediate?: boolean;
    naming_template?: string;
  };
}
