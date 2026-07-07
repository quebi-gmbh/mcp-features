export interface Chunk {
  path: string;
  heading?: string;
  text: string;
  source: "markdown" | "jsonl";
}
