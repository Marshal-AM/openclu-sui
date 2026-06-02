"use client";

import { BotIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function CreateAgentPage() {
  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure and deploy an agent from your recorded skills.
        </p>
      </div>

      <Empty className="border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BotIcon />
          </EmptyMedia>
          <EmptyTitle>Coming soon</EmptyTitle>
          <EmptyDescription>
            Agent creation will be available here. Use Record to capture skills first.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
