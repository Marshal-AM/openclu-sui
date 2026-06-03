"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChatMarkdown } from "@/components/agent-lab/chat-markdown";
import { ChatSkillOfferCard } from "@/components/agent-lab/chat-skill-offer-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgentLabStore } from "@/lib/agent-lab/agent-lab-store";
import type { SkillCatalogSearchResult } from "@/lib/supabase/skill-search";
import { cn } from "@/lib/utils";
import "@/styles/agent-lab.css";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  skillOffer?: SkillCatalogSearchResult | null;
  at: number;
};

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Welcome to Agent lab. Ask **what skills are connected** and what they do, or say **find a skill for …** to search the marketplace. Attach skills from the palette above to test them on the canvas.",
  at: Date.now(),
};

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AgentLabChat() {
  const attachedSkills = useAgentLabStore((s) => s.attachedSkills);
  const bumpSkillsRefresh = useAgentLabStore((s) => s.bumpSkillsRefresh);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: text,
      at: Date.now(),
    };

    const history = [...messages.filter((m) => m.id !== "welcome"), userMsg];
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setSending(true);

    try {
      const res = await fetch("/api/agent-lab/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          attachedSkills: attachedSkills.map((s) => ({
            title: s.title,
            skillSlug: s.skillSlug,
            skillMd: s.skillMd,
          })),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        content?: string;
        skillOffer?: SkillCatalogSearchResult | null;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? `Chat failed (${res.status})`);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: data.content ?? "(No response)",
          skillOffer: data.skillOffer ?? null,
          at: Date.now(),
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
      toast.error("Chat failed", { description: message });
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: `Error: ${message}`,
          at: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [attachedSkills, draft, messages]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <p className="text-sm font-medium">Chat</p>
        <p className="text-xs text-muted-foreground">
          {attachedSkills.length > 0
            ? `${attachedSkills.length} skill(s) connected · ask what they do, or find more on the marketplace`
            : "Attach skills on the canvas, or ask to find one on the marketplace"}
        </p>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[92%] rounded-lg px-3 py-2",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {msg.role === "assistant" ? (
                <>
                  <ChatMarkdown content={msg.content} />
                  {msg.skillOffer ? (
                    <ChatSkillOfferCard
                      offer={msg.skillOffer}
                      onRefreshPurchases={bumpSkillsRefresh}
                    />
                  ) : null}
                </>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='Try: "What skills do I have?" or "Find a skill for screen recording"'
          rows={2}
          className="min-h-[4rem] resize-none"
          disabled={sending}
        />
        <Button
          type="button"
          size="sm"
          className="self-end"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
