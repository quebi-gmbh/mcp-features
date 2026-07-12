export type ChunkSource = "markdown" | "jsonl" | "pdf";

export interface Chunk {
  path: string;
  heading?: string;
  text: string;
  source: ChunkSource;
}
