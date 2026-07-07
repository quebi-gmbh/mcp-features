import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { hashText } from "./util/hash";

export const EMBEDDING_DIM = 384;
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** Wraps a local (no API key, no network at query time) embedding model, caching
 * each vector on disk keyed by content hash so a restart only re-embeds changed text. */
export class Embedder {
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly cacheDir: string) {}

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractorPromise) {
      this.extractorPromise = pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    }
    return this.extractorPromise;
  }

  async embed(text: string): Promise<number[]> {
    const hash = hashText(text);
    const cachePath = join(this.cacheDir, "embeddings", `${hash}.json`);
    if (existsSync(cachePath)) {
      return JSON.parse(readFileSync(cachePath, "utf8")) as number[];
    }

    const extractor = await this.getExtractor();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const vector = Array.from(output.data as Float32Array);

    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(vector));
    return vector;
  }
}
