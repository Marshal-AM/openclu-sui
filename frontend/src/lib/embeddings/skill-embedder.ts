import { pipeline, env } from "@xenova/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

if (typeof process !== "undefined") {
  env.cacheDir = process.env.TRANSFORMERS_CACHE?.trim() || "./.cache/transformers";
  env.allowLocalModels = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedPipeline: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedPipelinePromise: Promise<any> | null = null;

async function getEmbedPipeline() {
  if (embedPipeline) return embedPipeline;
  if (!embedPipelinePromise) {
    embedPipelinePromise = pipeline("feature-extraction", EMBEDDING_MODEL, {
      quantized: true,
    }).then((p) => {
      embedPipeline = p;
      return p;
    });
  }
  return embedPipelinePromise;
}

function tensorToVector(output: { data: Float32Array | number[]; dims?: number[] }): number[] {
  if (output.dims?.length === 1 && output.data.length === EMBEDDING_DIMENSIONS) {
    return Array.from(output.data as ArrayLike<number>);
  }

  const dims = output.dims ?? [1, output.data.length];
  const tokens = dims.length >= 2 ? dims[0] : 1;
  const dimSize = dims.length >= 2 ? dims[dims.length - 1] : dims[0];
  const data = output.data;
  const vec = new Array<number>(dimSize).fill(0);

  for (let t = 0; t < tokens; t++) {
    for (let d = 0; d < dimSize; d++) {
      vec[d] += Number(data[t * dimSize + d]);
    }
  }

  for (let d = 0; d < dimSize; d++) {
    vec[d] /= tokens;
  }

  let norm = 0;
  for (let d = 0; d < dimSize; d++) {
    norm += vec[d] * vec[d];
  }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dimSize; d++) {
    vec[d] /= norm;
  }

  return vec;
}

export function buildListingEmbedText(
  title: string,
  skillSlug: string,
  description: string,
): string {
  return `${title.trim()}\n${skillSlug.trim()}\n${description.trim()}`;
}

export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Cannot embed empty text.");
  }

  const pipe = await getEmbedPipeline();
  const output = await pipe(trimmed, { pooling: "mean", normalize: true });
  return tensorToVector(output as { data: Float32Array; dims: number[] });
}

export async function embedListing(
  title: string,
  skillSlug: string,
  description: string,
): Promise<number[]> {
  return embedText(buildListingEmbedText(title, skillSlug, description));
}
