"use client";

import { AgentLabCanvas } from "@/components/agent-lab/agent-lab-canvas";
import { AgentLabChat } from "@/components/agent-lab/agent-lab-chat";
import { AgentLabDecryptHost } from "@/components/agent-lab/agent-lab-decrypt-host";
import { AgentLabSkillsPanel } from "@/components/agent-lab/agent-lab-skills-panel";

export default function CreateAgentPage() {
  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Decrypt purchased skills, drag them onto the canvas, or ask chat to find and buy skills
          semantically — then test them with the agent.
        </p>
      </div>

      <div className="grid h-[calc(100vh-11rem)] max-h-[calc(100vh-11rem)] grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1fr_minmax(360px,40%)]">
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
          <AgentLabSkillsPanel />
          <AgentLabCanvas />
        </section>
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
          <AgentLabChat />
        </section>
      </div>

      <AgentLabDecryptHost />
    </div>
  );
}
