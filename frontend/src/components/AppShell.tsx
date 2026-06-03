"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BotIcon,
  MoonIcon,
  PenToolIcon,
  ShoppingBagIcon,
  SunIcon,
  ReceiptIcon,
} from "lucide-react";
import { WalletConnectButton } from "@/components/auth/wallet-connect-button";
import { OpenCluLogo } from "@/components/OpenCluLogo";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/theme-provider";

const NAV = [
  { href: "/record", label: "Record", icon: PenToolIcon },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingBagIcon },
  { href: "/purchased-skills", label: "Purchased Skills", icon: ReceiptIcon },
  { href: "/create-agent", label: "Agent lab", icon: BotIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader className="p-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:p-1">
          <Link
            href="/record"
            aria-label="Skill Capture"
            className="flex h-24 w-full min-w-0 items-center justify-center overflow-hidden rounded-lg group-data-[collapsible=icon]:size-14"
          >
            <div className="flex w-full items-center justify-center group-data-[collapsible=icon]:hidden">
              <OpenCluLogo priority className="h-20 w-full" />
            </div>
            <span className="hidden size-14 shrink-0 overflow-hidden rounded-lg group-data-[collapsible=icon]:grid group-data-[collapsible=icon]:place-items-center">
              <OpenCluLogo markOnly className="size-12" />
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent className="gap-2 px-2 group-data-[collapsible=icon]:px-2">
          <SidebarGroup className="group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="app-sidebar-nav">
                {NAV.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <Link
                        href={item.href}
                        className={cn("app-sidebar-nav-item", isActive && "is-active")}
                      >
                        <span className="app-sidebar-nav-icon">
                          <item.icon />
                        </span>
                        <span className="app-sidebar-nav-label">{item.label}</span>
                      </Link>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger />
          </div>
          <div className="hidden min-w-0 md:block">
            <p className="text-sm font-medium">Clu Dashboard</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <WalletConnectButton />
            <Button type="button" variant="ghost" size="sm" onClick={toggleTheme}>
              {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
              <span className="sr-only">Toggle theme</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
