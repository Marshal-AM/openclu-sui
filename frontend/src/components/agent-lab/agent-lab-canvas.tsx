"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { toast } from "sonner";
import { AgentNode } from "@/components/agent-lab/agent-node";
import { SkillNode } from "@/components/agent-lab/skill-node";
import { CanvasConnections } from "@/components/agent-lab/canvas-connections";
import { getCachedDecryptedSkill, hasCachedDecryptedSkill } from "@/lib/decrypted-skill-cache";
import { useAgentLabStore } from "@/lib/agent-lab/agent-lab-store";
import {
  decodeSkillDragPayload,
  SKILL_DRAG_MIME,
} from "@/lib/agent-lab/drag-payload";
import {
  resolveSkillAttachPosition,
  SKILL_NODE_H,
  SKILL_NODE_W,
} from "@/lib/agent-lab/canvas-layout";
import { cn } from "@/lib/utils";
import "@/styles/agent-lab.css";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const DOT_SPACING_PX = 20;
const CANVAS_LAYER_SIZE = 4000;

function readDragPayload(dataTransfer: DataTransfer) {
  const raw =
    dataTransfer.getData(SKILL_DRAG_MIME) || dataTransfer.getData("text/plain");
  return decodeSkillDragPayload(raw);
}

export function AgentLabCanvas() {
  const account = useCurrentAccount();
  const attachedSkills = useAgentLabStore((s) => s.attachedSkills);
  const attachSkill = useAgentLabStore((s) => s.attachSkill);
  const detachSkill = useAgentLabStore((s) => s.detachSkill);
  const agentWorld = useAgentLabStore((s) => s.agentWorld);
  const setAgentWorldFromViewport = useAgentLabStore((s) => s.setAgentWorldFromViewport);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const panningRef = useRef(false);
  const isDraggingSkillRef = useRef(false);

  const dotSize = DOT_SPACING_PX * zoom;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const centerAgent = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      setAgentWorldFromViewport(rect.width, rect.height);
    };

    centerAgent();
    const observer = new ResizeObserver(centerAgent);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [setAgentWorldFromViewport]);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return { x: 0, y: 0 };
      const rect = viewport.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom - SKILL_NODE_W / 2,
        y: (clientY - rect.top - pan.y) / zoom - SKILL_NODE_H / 2,
      };
    },
    [pan.x, pan.y, zoom],
  );

  const tryAttachSkill = useCallback(
    (
      payload: NonNullable<ReturnType<typeof decodeSkillDragPayload>>,
      preferred?: { x: number; y: number } | null,
    ) => {
      if (!account?.address) {
        toast.error("Connect your wallet to attach skills.");
        return;
      }

      if (attachedSkills.some((s) => s.purchaseObjectId === payload.purchaseObjectId)) {
        toast.info(`"${payload.title}" is already attached.`);
        return;
      }

      if (!hasCachedDecryptedSkill(account.address, payload.purchaseObjectId)) {
        toast.error(`Decrypt "${payload.title}" first using the button on its card.`);
        return;
      }

      const cached = getCachedDecryptedSkill(account.address, payload.purchaseObjectId);
      if (!cached) {
        toast.error(`Decrypt "${payload.title}" first using the button on its card.`);
        return;
      }

      const pos = resolveSkillAttachPosition(
        agentWorld.x,
        agentWorld.y,
        attachedSkills,
        preferred,
      );

      attachSkill({
        purchaseObjectId: payload.purchaseObjectId,
        title: cached.title ?? payload.title,
        skillSlug: cached.skillSlug ?? payload.skillSlug,
        skillMd: cached.skillMd,
        x: pos.x,
        y: pos.y,
      });
      toast.success(`Attached "${payload.title}"`);
    },
    [account?.address, agentWorld.x, agentWorld.y, attachSkill, attachedSkills],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || isDraggingSkillRef.current) return;
      if ((e.target as HTMLElement).closest("[data-canvas-node]")) return;

      panningRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan.x, pan.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panningRef.current) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    panningRef.current = false;
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      setZoom((prevZoom) => {
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom + delta));
        if (nextZoom === prevZoom) return prevZoom;

        const scale = nextZoom / prevZoom;
        setPan((prevPan) => ({
          x: cursorX - scale * (cursorX - prevPan.x),
          y: cursorY - scale * (cursorY - prevPan.y),
        }));
        return nextZoom;
      });
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(SKILL_DRAG_MIME) && !e.dataTransfer.types.includes("text/plain")) {
      return;
    }
    isDraggingSkillRef.current = true;
    e.preventDefault();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasSkill =
      e.dataTransfer.types.includes(SKILL_DRAG_MIME) ||
      e.dataTransfer.types.includes("text/plain");
    if (!hasSkill) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropTarget(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && viewportRef.current?.contains(related)) return;
    setDropTarget(false);
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingSkillRef.current = false;
    setDropTarget(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingSkillRef.current = false;
      setDropTarget(false);

      const payload = readDragPayload(e.dataTransfer);
      if (!payload) {
        toast.error("Could not read dragged skill. Try again.");
        return;
      }

      const { x, y } = clientToWorld(e.clientX, e.clientY);
      tryAttachSkill(payload, { x, y });
    },
    [clientToWorld, tryAttachSkill],
  );

  const handleAgentDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingSkillRef.current = false;
      setDropTarget(false);

      const payload = readDragPayload(e.dataTransfer);
      if (!payload) return;

      tryAttachSkill(payload);
    },
    [agentWorld.x, agentWorld.y, attachedSkills, tryAttachSkill],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-medium">Canvas</p>
        <p className="text-xs text-muted-foreground">
          Drag skills here · Drop on agent · {Math.round(zoom * 100)}%
        </p>
      </div>
      <div
        ref={viewportRef}
        className={cn(
          "agent-lab-canvas-viewport relative min-h-0 flex-1 overflow-hidden",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          backgroundSize: `${dotSize}px ${dotSize}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className="agent-lab-canvas-layer absolute left-0 top-0"
          style={{
            width: CANVAS_LAYER_SIZE,
            height: CANVAS_LAYER_SIZE,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
          onDragEnd={handleDragEnd}
        >
          <CanvasConnections
            agentX={agentWorld.x}
            agentY={agentWorld.y}
            skills={attachedSkills}
          />

          <div
            className="absolute"
            style={{ left: agentWorld.x, top: agentWorld.y }}
            data-canvas-node
          >
            <AgentNode
              isDropTarget={dropTarget}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
                setDropTarget(true);
              }}
              onDragLeave={(e) => {
                e.stopPropagation();
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              }}
              onDrop={handleAgentDrop}
            />
          </div>

          {attachedSkills.map((skill) => (
            <SkillNode
              key={skill.purchaseObjectId}
              skill={skill}
              style={{ left: skill.x, top: skill.y }}
              onRemove={() => detachSkill(skill.purchaseObjectId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
