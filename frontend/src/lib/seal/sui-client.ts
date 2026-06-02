import type { SuiClient } from "@mysten/sui/client";
import type { Experimental_SuiClientTypes } from "@mysten/sui/experimental";
import { ensureUint8Array } from "@/lib/seal/bytes";

type SealWrapped = SuiClient & { __opencluSealWrapped?: boolean };
type ObjectResponse = Experimental_SuiClientTypes.ObjectResponse;

async function normalizeCoreObject(obj: ObjectResponse): Promise<ObjectResponse> {
  if (!obj.content) return obj;
  const bytes = ensureUint8Array(await obj.content);
  // Seal parses `object.content` synchronously (no await) — must be Uint8Array, not a Promise.
  return {
    ...obj,
    content: bytes as unknown as ObjectResponse["content"],
  };
}

/**
 * Normalize BCS bytes from Sui core so Seal's parsers always see ArrayBuffer-backed data.
 */
export function wrapSuiClientForSeal<T extends SuiClient>(client: T): T {
  const marked = client as SealWrapped;
  if (marked.__opencluSealWrapped) return client;

  const core = client.core;
  if (!core) {
    marked.__opencluSealWrapped = true;
    return client;
  }

  if (core.getObject) {
    const origGetObject = core.getObject.bind(core);
    core.getObject = async (options) => {
      const result = await origGetObject(options);
      if (result?.object) {
        return {
          ...result,
          object: await normalizeCoreObject(result.object),
        };
      }
      return result;
    };
  }

  if (core.getObjects) {
    const origGetObjects = core.getObjects.bind(core);
    core.getObjects = async (options) => {
      const result = await origGetObjects(options);
      if (result?.objects) {
        const objects = await Promise.all(
          result.objects.map(async (entry) => {
            if (entry instanceof Error) return entry;
            return normalizeCoreObject(entry);
          }),
        );
        return { ...result, objects };
      }
      return result;
    };
  }

  if (core.getDynamicField) {
    const origGetDynamicField = core.getDynamicField.bind(core);
    core.getDynamicField = async (options) => {
      const nameBcs =
        options.name?.bcs instanceof Uint8Array
          ? ensureUint8Array(options.name.bcs)
          : options.name?.bcs;
      const normalizedOptions =
        nameBcs !== options.name?.bcs
          ? { ...options, name: { ...options.name, bcs: nameBcs } }
          : options;

      const result = await origGetDynamicField(normalizedOptions);
      const valueBcs = result.dynamicField?.value?.bcs;
      if (valueBcs instanceof Uint8Array) {
        return {
          ...result,
          dynamicField: {
            ...result.dynamicField,
            value: {
              ...result.dynamicField.value,
              bcs: ensureUint8Array(valueBcs),
            },
          },
        };
      }
      return result;
    };
  }

  marked.__opencluSealWrapped = true;
  return client;
}
