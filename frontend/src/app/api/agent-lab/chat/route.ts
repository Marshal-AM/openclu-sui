import {
  runAgentLabChat,
  type AttachedSkillPayload,
  type ChatMessagePayload,
} from "@/lib/agent-lab/groq-agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: ChatMessagePayload[];
      attachedSkills?: AttachedSkillPayload[];
    };

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const attachedSkills = Array.isArray(body.attachedSkills) ? body.attachedSkills : [];

    const sanitizedMessages = messages
      .filter(
        (m): m is ChatMessagePayload =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0,
      )
      .slice(-40);

    const sanitizedSkills = attachedSkills
      .filter(
        (s) =>
          typeof s.title === "string" &&
          typeof s.skillSlug === "string" &&
          typeof s.skillMd === "string" &&
          s.skillMd.length > 0,
      )
      .map((s) => ({
        title: s.title.slice(0, 200),
        skillSlug: s.skillSlug.slice(0, 120),
        skillMd: s.skillMd.slice(0, 100_000),
      }));

    const result = await runAgentLabChat({
      messages: sanitizedMessages,
      attachedSkills: sanitizedSkills,
    });

    return Response.json({
      content: result.content,
      skillOffer: result.skillOffer,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat request failed.";
    const lower = message.toLowerCase();

    if (lower.includes("groq_api_key") || lower.includes("not set")) {
      return Response.json(
        { error: "Chat is not configured. Set GROQ_API_KEY in the server environment." },
        { status: 503 },
      );
    }
    if (lower.includes("rate") || lower.includes("429")) {
      return Response.json({ error: "Groq rate limit reached. Try again shortly." }, { status: 429 });
    }

    return Response.json({ error: message }, { status: 500 });
  }
}
