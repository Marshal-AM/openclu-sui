export interface WalrusHttpStoreOptions {
  epochs?: number;
  deletable?: boolean;
  permanent?: boolean;
  sendObjectTo?: string;
  signal?: AbortSignal;
  contentType?: string;
}

export interface WalrusHttpRef {
  blobId: string;
  objectId?: string;
  endEpoch?: number;
  raw: unknown;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function storeJson(
  fetchImpl: FetchLike,
  publisherUrl: string,
  value: unknown,
  options: WalrusHttpStoreOptions = {},
): Promise<WalrusHttpRef> {
  const body = JSON.stringify(value);
  return storeBytes(fetchImpl, publisherUrl, new TextEncoder().encode(body), {
    ...options,
    contentType: "application/json",
  });
}

export async function storeBytes(
  fetchImpl: FetchLike,
  publisherUrl: string,
  bytes: Uint8Array,
  options: WalrusHttpStoreOptions = {},
): Promise<WalrusHttpRef> {
  if (options.deletable && options.permanent) {
    throw new Error("Walrus store options cannot be both deletable and permanent");
  }

  const url = new URL("/v1/blobs", withTrailingSlash(publisherUrl));
  if (options.epochs !== undefined) url.searchParams.set("epochs", String(options.epochs));
  if (options.deletable) url.searchParams.set("deletable", "true");
  if (options.permanent) url.searchParams.set("permanent", "true");
  if (options.sendObjectTo) url.searchParams.set("send_object_to", options.sendObjectTo);

  const init: RequestInit = {
    method: "PUT",
    headers: { "content-type": options.contentType ?? "application/octet-stream" },
    body: Uint8Array.from(bytes),
  };
  if (options.signal) init.signal = options.signal;

  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Walrus publisher failed: ${response.status} ${await safeText(response)}`);
  }

  return parseStoreResponse((await response.json()) as WalrusStoreResponse);
}

export async function readJson<T = unknown>(
  fetchImpl: FetchLike,
  aggregatorUrl: string,
  ref: { blobId?: string; objectId?: string },
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const bytes = await readBytes(fetchImpl, aggregatorUrl, ref, options);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function readBytes(
  fetchImpl: FetchLike,
  aggregatorUrl: string,
  ref: { blobId?: string; objectId?: string },
  options: { signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const path = ref.objectId
    ? `/v1/blobs/by-object-id/${encodeURIComponent(ref.objectId)}`
    : `/v1/blobs/${encodeURIComponent(requiredBlobId(ref))}`;
  const url = new URL(path, withTrailingSlash(aggregatorUrl));

  const init: RequestInit = { method: "GET" };
  if (options.signal) init.signal = options.signal;

  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Walrus aggregator failed: ${response.status} ${await safeText(response)}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function readJsonWithRetry<T = unknown>(
  fetchImpl: FetchLike,
  aggregatorUrl: string,
  ref: { blobId?: string; objectId?: string },
  options: { attempts?: number; delayMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const attempts = options.attempts ?? 6;
  const delayMs = options.delayMs ?? 1_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await readJson<T>(fetchImpl, aggregatorUrl, ref, options);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw lastError;
}

export function parseStoreResponse(response: WalrusStoreResponse): WalrusHttpRef {
  if (response.newlyCreated) {
    const blobObject = response.newlyCreated.blobObject;
    const ref: WalrusHttpRef = {
      blobId: blobObject.blobId,
      objectId: blobObject.id,
      raw: response,
    };
    if (blobObject.storage?.endEpoch !== undefined) ref.endEpoch = blobObject.storage.endEpoch;
    return ref;
  }

  if (response.alreadyCertified) {
    const ref: WalrusHttpRef = {
      blobId: response.alreadyCertified.blobId,
      raw: response,
    };
    if (response.alreadyCertified.endEpoch !== undefined) {
      ref.endEpoch = response.alreadyCertified.endEpoch;
    }
    return ref;
  }

  throw new Error("Unrecognized Walrus publisher response");
}

interface WalrusStoreResponse {
  newlyCreated?: {
    blobObject: {
      id: string;
      blobId: string;
      storage?: { endEpoch?: number };
    };
  };
  alreadyCertified?: {
    blobId: string;
    endEpoch?: number;
  };
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function requiredBlobId(ref: { blobId?: string }): string {
  if (!ref.blobId) throw new Error("A blobId is required when objectId is not provided");
  return ref.blobId;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
