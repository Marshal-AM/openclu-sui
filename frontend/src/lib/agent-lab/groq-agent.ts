import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "groq-sdk/resources/chat/completions";
import type { SkillCatalogSearchResult } from "@/lib/supabase/skill-search";
import { searchSkillCatalogSemantic } from "@/lib/supabase/skill-search";

export const AGENT_LAB_TEXT_MODEL = "llama-3.3-70b-versatile";

export type AttachedSkillPayload = {
  title: string;
  skillSlug: string;
  skillMd: string;
};

export type ChatMessagePayload = {
  role: "user" | "assistant";
  content: string;
};

export type AgentLabChatResult = {
  content: string;
  skillOffer: SkillCatalogSearchResult | null;
};

const SEARCH_TOOL_NAME = "search_marketplace_skills";

const SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: SEARCH_TOOL_NAME,
    description:
      "Search the public skill marketplace for NEW skills to buy or add. " +
      "Only when the user wants to find, buy, discover, or shop for a skill not already on the canvas.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Short capability phrase for semantic search, e.g. screen recording, form filling.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

function truncateSkillMd(skillMd: string, maxChars: number): string {
  if (skillMd.length <= maxChars) return skillMd;
  return `${skillMd.slice(0, maxChars)}\n\n[... skill content truncated ...]`;
}

function skillMdBlurb(skillMd: string): string {
  const desc = skillMd.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (desc) return desc.slice(0, 280);

  const overview = skillMd.match(/## Overview\s*\n+([\s\S]*?)(?=\n## |\n---|$)/)?.[1]?.trim();
  if (overview) {
    const line = overview.split("\n").find((l) => l.trim())?.trim();
    if (line) return line.slice(0, 280);
  }

  return "See SKILL.md below for details.";
}

/** User is asking about skills already connected on the canvas. */
export function isAttachedSkillsQuestion(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const patterns = [
    /\bwhat skills?\b.*\b(have|connected|attached|on (my |the )?(agent|canvas))\b/,
    /\b(which|what) skills?\b.*\b(connected|attached|on the canvas)\b/,
    /\b(list|show|tell me about|describe|summarize)\b.*\b(my |attached |connected )?skills?\b/,
    /\bwhat do (they|these skills?|my skills?) do\b/,
    /\bwhat can (you|this agent|the agent) do\b/,
    /\bhow many skills?\b.*\b(connected|attached|have)\b/,
    /\bskills?\s+do you have\b/,
    /\bdo i (already )?have\b.*\bskill/,
    /\bcapabilities\b.*\b(agent|attached|connected)\b/,
    /\bwhat are (my |the |these )?skills?\b/,
    /\bwhat skills?\s+(are|is)\b/,
  ];
  return patterns.some((p) => p.test(lower));
}

/** User wants to find or buy a new skill from the marketplace. */
export function isMarketplaceSearchIntent(text: string): boolean {
  if (isAttachedSkillsQuestion(text)) return false;

  const lower = text.toLowerCase().trim();
  return (
    /\b(find|search|buy|purchase|shop|discover|recommend|looking for|need to (find|buy|get))\b/.test(
      lower,
    ) ||
    /\b(get me|help me find|add a new skill|from the marketplace|on the marketplace)\b/.test(
      lower,
    ) ||
    /\b(i want you to|can you|please)\b.*\b(find|get)\b.*\bskill/.test(lower) ||
    /\b(is there a skill|any skill)\b/.test(lower) ||
    /\bskill(s)?\b.*\b(related to|for)\b/.test(lower) ||
    /\bfind a skill\b/.test(lower)
  );
}

function buildInventorySection(skills: AttachedSkillPayload[]): string {
  if (skills.length === 0) {
    return `## Connected skills on this agent
None yet. If the user asks what skills they have, say none are connected and suggest attaching skills from the palette above or asking you to find one on the marketplace.`;
  }

  const lines = skills.map(
    (s, i) =>
      `${i + 1}. **${s.title}** (\`${s.skillSlug}\`) — ${skillMdBlurb(s.skillMd)}`,
  );

  return `## Connected skills on this agent (${skills.length})
These skills are already attached on the canvas. When the user asks "what skills do you have", "what do they do", or similar, answer from THIS list and the SKILL.md docs below — not from marketplace search.

${lines.join("\n")}`;
}

function buildSystemPrompt(skills: AttachedSkillPayload[], marketplaceMode: boolean): string {
  const skillBlock =
    skills.length === 0
      ? ""
      : skills
          .map(
            (s) =>
              `### ${s.title} (${s.skillSlug})\n${truncateSkillMd(s.skillMd, 8000)}`,
          )
          .join("\n\n---\n\n");

  const toolNote = marketplaceMode
    ? `
## Marketplace search (this turn)
The user wants a NEW skill from the marketplace. Call ${SEARCH_TOOL_NAME} with a short capability query (e.g. "screen recording", "screen capture") — not their full sentence. Use the tool API only; do not write <function> tags or JSON in your reply text.`
    : "";

  return `You are an Agent Lab assistant. The user is building and testing an agent from purchased skills attached on the canvas.

${buildInventorySection(skills)}

${skillBlock ? `## Full SKILL.md documents\n\n${skillBlock}` : ""}
${toolNote}

---

Behavior:
1. **Inventory questions** (what skills are connected, what they do, what the agent can do):
   - Answer directly from the connected skills list and SKILL.md content above.
   - Summarize each skill clearly: purpose, main steps, and when to use it.
   - Never say "no skills were found" when connected skills exist.
   - Do not mention marketplace search or purchase cards.

2. **Marketplace discovery** (find/buy/add a new skill):
   - Call ${SEARCH_TOOL_NAME} with a short capability query.
   - After results return, briefly explain why the match fits. The UI shows a purchase card — don't repeat price/IDs.
   - If nothing matches, say so and suggest rephrasing.

3. **Execution questions** (how do I do X with a connected skill):
   - Use the relevant SKILL.md as the only source. If not covered, say so.

Keep answers natural and helpful. No meta-commentary about "search results" or "match percentages" unless the user asked you to find something on the marketplace.`;
}

export function getAgentLabGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set. Add it to frontend/.env.local");
  }
  return new Groq({ apiKey });
}

function extractToolUseFailedGeneration(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const root = err as { error?: Record<string, unknown> };
  const nested = root.error?.error;
  const payload: { code?: string; failed_generation?: string } | undefined =
    nested &&
    typeof nested === "object" &&
    (nested as { code?: string }).code === "tool_use_failed"
      ? (nested as { code?: string; failed_generation?: string })
      : (root.error as { code?: string; failed_generation?: string } | undefined);

  if (payload?.code === "tool_use_failed" && typeof payload.failed_generation === "string") {
    return payload.failed_generation;
  }
  return null;
}

/** Recover tool call when Groq rejects Llama's <function=...> wire format. */
export function parseFailedToolGeneration(
  raw: string,
): { name: string; arguments: Record<string, unknown> } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const xmlMatch = trimmed.match(/<function=([^\s>{]+)\s*(\{[\s\S]*?\})\s*(?:<\/function>)?/i);
  if (xmlMatch) {
    try {
      const args = JSON.parse(xmlMatch[2]!) as Record<string, unknown>;
      return { name: xmlMatch[1]!, arguments: args };
    } catch {
      /* try other parsers */
    }
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]!) as {
        tool_calls?: Array<{
          function?: { name?: string; arguments?: unknown; parameters?: unknown };
        }>;
      };
      const fn = parsed.tool_calls?.[0]?.function;
      if (!fn?.name) return null;
      const rawArgs = fn.arguments ?? fn.parameters;
      const args =
        typeof rawArgs === "string"
          ? (JSON.parse(rawArgs) as Record<string, unknown>)
          : (rawArgs as Record<string, unknown>);
      return { name: fn.name, arguments: args ?? {} };
    } catch {
      return null;
    }
  }

  return null;
}

function syntheticToolCall(
  name: string,
  args: Record<string, unknown>,
  id = "recovered_call_0",
): ChatCompletionMessageToolCall {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function parseToolCallArguments(call: ChatCompletionMessageToolCall): Record<string, unknown> {
  if (call.type !== "function") return {};
  try {
    return JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return { query: call.function.arguments };
  }
}

async function executeSearchTool(query: string): Promise<{
  results: SkillCatalogSearchResult[];
  toolContent: string;
}> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      results: [],
      toolContent: JSON.stringify({ found: false, message: "Empty search query." }),
    };
  }

  try {
    const results = await searchSkillCatalogSemantic(trimmed, { limit: 1, minSimilarity: 0.35 });
    if (results.length === 0) {
      return {
        results: [],
        toolContent: JSON.stringify({ found: false, message: "No marketplace listing matched." }),
      };
    }
    const top = results[0];
    return {
      results,
      toolContent: JSON.stringify({
        found: true,
        listingId: top.listingId,
        title: top.title,
        skillSlug: top.skillSlug,
        description: top.description,
        priceMist: top.priceMist,
        similarity: top.similarity,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return {
      results: [],
      toolContent: JSON.stringify({ found: false, error: message }),
    };
  }
}

async function runSearchToolCall(
  call: ChatCompletionMessageToolCall,
): Promise<{ toolContent: string; top: SkillCatalogSearchResult | null }> {
  const args = parseToolCallArguments(call);
  const query = typeof args.query === "string" ? args.query : "";
  const { results, toolContent } = await executeSearchTool(query);
  return { toolContent, top: results[0] ?? null };
}

function shouldOfferSkill(
  offer: SkillCatalogSearchResult | null,
  attachedSkills: AttachedSkillPayload[],
  lastUserMessage: string,
): SkillCatalogSearchResult | null {
  if (!offer) return null;
  if (isAttachedSkillsQuestion(lastUserMessage)) return null;

  const alreadyAttached = attachedSkills.some(
    (s) => s.skillSlug === offer.skillSlug || s.title.toLowerCase() === offer.title.toLowerCase(),
  );
  if (alreadyAttached) return null;

  return offer;
}

export async function runAgentLabChat(args: {
  messages: ChatMessagePayload[];
  attachedSkills: AttachedSkillPayload[];
}): Promise<AgentLabChatResult> {
  const client = getAgentLabGroqClient();

  const lastUserMessage =
    [...args.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const allowMarketplaceSearch = isMarketplaceSearchIntent(lastUserMessage);

  const groqMessages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt(args.attachedSkills, allowMarketplaceSearch),
    },
    ...args.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let skillOffer: SkillCatalogSearchResult | null = null;
  let searchCompleted = false;

  for (let round = 0; round < 3; round++) {
    const toolPass = allowMarketplaceSearch && !searchCompleted;

    let response;
    try {
      response = await client.chat.completions.create({
        model: AGENT_LAB_TEXT_MODEL,
        messages: groqMessages,
        ...(toolPass
          ? {
              tools: [SEARCH_TOOL],
              tool_choice: {
                type: "function" as const,
                function: { name: SEARCH_TOOL_NAME },
              },
              parallel_tool_calls: false,
              temperature: 0,
            }
          : { temperature: 0.25 }),
        max_tokens: 2048,
      });
    } catch (err) {
      const failedGen = extractToolUseFailedGeneration(err);
      if (!toolPass || !failedGen) throw err;

      const recovered = parseFailedToolGeneration(failedGen);
      if (!recovered || recovered.name !== SEARCH_TOOL_NAME) throw err;

      const call = syntheticToolCall(recovered.name, recovered.arguments);
      groqMessages.push({
        role: "assistant",
        content: null,
        tool_calls: [call],
      });

      const { toolContent, top } = await runSearchToolCall(call);
      if (top) skillOffer = top;
      searchCompleted = true;

      groqMessages.push({
        role: "tool",
        tool_call_id: call.id,
        name: SEARCH_TOOL_NAME,
        content: toolContent,
      } as ChatCompletionMessageParam);
      continue;
    }

    const choice = response.choices[0]?.message;
    if (!choice) {
      return { content: "", skillOffer: null };
    }

    const toolCalls = choice.tool_calls;
    if (toolCalls?.length) {
      groqMessages.push(choice);

      for (const call of toolCalls) {
        if (call.type !== "function" || call.function.name !== SEARCH_TOOL_NAME) {
          continue;
        }
        const { toolContent, top } = await runSearchToolCall(call);
        if (top) skillOffer = top;

        groqMessages.push({
          role: "tool",
          tool_call_id: call.id,
          name: SEARCH_TOOL_NAME,
          content: toolContent,
        } as ChatCompletionMessageParam);
      }

      searchCompleted = true;
      continue;
    }

    return {
      content: choice.content?.trim() ?? "",
      skillOffer: shouldOfferSkill(skillOffer, args.attachedSkills, lastUserMessage),
    };
  }

  return {
    content: "I couldn't complete the marketplace search. Please try again.",
    skillOffer: shouldOfferSkill(skillOffer, args.attachedSkills, lastUserMessage),
  };
}
