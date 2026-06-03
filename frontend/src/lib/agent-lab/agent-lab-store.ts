"use client";

import { create } from "zustand";
import type { AttachedSkillPayload } from "@/lib/agent-lab/groq-agent";
import {
  defaultAgentCenter,
  resolveSkillAttachPosition,
} from "@/lib/agent-lab/canvas-layout";
import type { SkillCatalogCard } from "@/lib/supabase/catalog-types";
import { getCachedDecryptedSkill } from "@/lib/decrypted-skill-cache";
import type { DecodedSkillListing, DecodedSkillPurchase } from "@/lib/sui/queries";

export type AttachedCanvasSkill = AttachedSkillPayload & {
  purchaseObjectId: string;
  x: number;
  y: number;
};

type AgentLabState = {
  attachedSkills: AttachedCanvasSkill[];
  skillsRefreshKey: number;
  agentWorld: { x: number; y: number };
  decryptDialogOpen: boolean;
  decryptListing: DecodedSkillListing | null;
  decryptPurchase: DecodedSkillPurchase | null;
  autoAttachCatalog: SkillCatalogCard | null;
  attachSkill: (skill: AttachedCanvasSkill) => void;
  detachSkill: (purchaseObjectId: string) => void;
  bumpSkillsRefresh: () => void;
  setAgentWorldFromViewport: (width: number, height: number) => void;
  openDecryptDialog: (listing: DecodedSkillListing, purchase: DecodedSkillPurchase) => void;
  closeDecryptDialog: () => void;
  requestAutoAttach: (catalog: SkillCatalogCard) => void;
  clearAutoAttach: () => void;
  attachSkillFromCache: (
    walletAddress: string,
    purchaseObjectId: string,
    catalog: SkillCatalogCard,
  ) => boolean;
};

export const useAgentLabStore = create<AgentLabState>((set, get) => ({
  attachedSkills: [],
  skillsRefreshKey: 0,
  agentWorld: defaultAgentCenter(800, 600),
  decryptDialogOpen: false,
  decryptListing: null,
  decryptPurchase: null,
  autoAttachCatalog: null,
  attachSkill: (skill) =>
    set((state) => {
      if (state.attachedSkills.some((s) => s.purchaseObjectId === skill.purchaseObjectId)) {
        return state;
      }
      return { attachedSkills: [...state.attachedSkills, skill] };
    }),
  detachSkill: (purchaseObjectId) =>
    set((state) => ({
      attachedSkills: state.attachedSkills.filter((s) => s.purchaseObjectId !== purchaseObjectId),
    })),
  bumpSkillsRefresh: () => set((s) => ({ skillsRefreshKey: s.skillsRefreshKey + 1 })),
  setAgentWorldFromViewport: (width, height) =>
    set({ agentWorld: defaultAgentCenter(width, height) }),
  openDecryptDialog: (listing, purchase) =>
    set({
      decryptDialogOpen: true,
      decryptListing: listing,
      decryptPurchase: purchase,
    }),
  closeDecryptDialog: () =>
    set({
      decryptDialogOpen: false,
      decryptListing: null,
      decryptPurchase: null,
      autoAttachCatalog: null,
    }),
  requestAutoAttach: (catalog) => set({ autoAttachCatalog: catalog }),
  clearAutoAttach: () => set({ autoAttachCatalog: null }),
  attachSkillFromCache: (walletAddress, purchaseObjectId, catalog) => {
    const cached = getCachedDecryptedSkill(walletAddress, purchaseObjectId);
    if (!cached) return false;

    const state = get();
    if (state.attachedSkills.some((s) => s.purchaseObjectId === purchaseObjectId)) {
      return true;
    }

    const pos = resolveSkillAttachPosition(
      state.agentWorld.x,
      state.agentWorld.y,
      state.attachedSkills,
    );

    set({
      attachedSkills: [
        ...state.attachedSkills,
        {
          purchaseObjectId,
          title: cached.title ?? catalog.title,
          skillSlug: cached.skillSlug ?? catalog.skillSlug,
          skillMd: cached.skillMd,
          x: pos.x,
          y: pos.y,
        },
      ],
    });
    return true;
  },
}));
