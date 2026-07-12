import { create, insert, remove, search, type AnyOrama } from "@orama/orama";
import type { Chunk, ChunkSource } from "./adapters/types";
import { EMBEDDING_DIM, Embedder } from "./embeddings";

export interface SearchFilter {
  path?: string;
  source?: ChunkSource;
}

export interface SearchHit {
  path: string;
  heading?: string;
  snippet: string;
  score: number;
  source: string;
}

export interface SourceInfo {
  path: string;
  chunks: number;
}

function snippetOf(text: string, maxLen = 320): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/** In-memory hybrid (BM25 + vector) index over Markdown/JSONL chunks. Tracks which
 * Orama document ids belong to which source file so a file change/removal can
 * cleanly replace/delete just its own chunks. */
export class KnowledgeEngine {
  private readonly db: AnyOrama;
  private readonly embedder: Embedder;
  private readonly idsByPath = new Map<string, string[]>();
  /** Reconstructed full text per file, so `get_document` can serve extracted
   * content for sources with no readable-on-disk text (e.g. binary PDFs). */
  private readonly textByPath = new Map<string, string>();

  constructor(cacheDir: string) {
    this.db = create({
      schema: {
        path: "enum",
        heading: "string",
        text: "string",
        source: "enum",
        embedding: `vector[${EMBEDDING_DIM}]`,
      },
    });
    this.embedder = new Embedder(cacheDir);
  }

  async indexFile(path: string, chunks: Chunk[]): Promise<void> {
    await this.removeFile(path);
    const ids: string[] = [];
    for (const chunk of chunks) {
      const embedding = await this.embedder.embed(chunk.text);
      const id = await insert(this.db, {
        path: chunk.path,
        heading: chunk.heading ?? "",
        text: chunk.text,
        source: chunk.source,
        embedding,
      });
      ids.push(id);
    }
    if (ids.length > 0) {
      this.idsByPath.set(path, ids);
      this.textByPath.set(path, chunks.map((c) => c.text).join("\n\n"));
    }
  }

  async removeFile(path: string): Promise<void> {
    const ids = this.idsByPath.get(path);
    if (!ids) return;
    for (const id of ids) {
      await remove(this.db, id);
    }
    this.idsByPath.delete(path);
    this.textByPath.delete(path);
  }

  hasSource(path: string): boolean {
    return this.idsByPath.has(path);
  }

  /** Full indexed text for a file (chunks rejoined), or undefined if not indexed. */
  documentText(path: string): string | undefined {
    return this.textByPath.get(path);
  }

  listSources(): SourceInfo[] {
    return [...this.idsByPath.entries()].map(([path, ids]) => ({ path, chunks: ids.length }));
  }

  async search(term: string, limit: number, filter?: SearchFilter): Promise<SearchHit[]> {
    const vector = await this.embedder.embed(term);
    const where: Record<string, { eq: string }> = {};
    if (filter?.path) where.path = { eq: filter.path };
    if (filter?.source) where.source = { eq: filter.source };

    const results = await search(this.db, {
      term,
      mode: "hybrid",
      vector: { value: vector, property: "embedding" },
      limit,
      ...(Object.keys(where).length > 0 ? { where } : {}),
    });

    return results.hits.map((hit) => {
      const doc = hit.document as unknown as { path: string; heading: string; text: string; source: string };
      return {
        path: doc.path,
        heading: doc.heading || undefined,
        snippet: snippetOf(doc.text),
        score: hit.score,
        source: doc.source,
      };
    });
  }
}
