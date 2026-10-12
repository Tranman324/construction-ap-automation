"use client";

import { createContext, useContext, useState } from "react";

const PANEL_PINNED_KEY = "tbx-panel-pinned";

function readInitialSidebarOpenState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(PANEL_PINNED_KEY) === "true";
  } catch {
    return false;
  }
}

interface SidebarContextValue {
  isSidebarOpen: boolean;
  setSidebarOpen: (isOpen: boolean) => void;
  toggleSidebar: () => void;
}

interface SidebarProviderProps {
  children: React.ReactNode;
}

const SidebarContext = createContext<SidebarContextValue>({
  isSidebarOpen: false,
  setSidebarOpen: () => {},
  toggleSidebar: () => {},
});

export function SidebarProvider({ children }: SidebarProviderProps) {
  const [isSidebarOpen, setSidebarOpen] = useState(() => readInitialSidebarOpenState());

  return (
    <SidebarContext.Provider
      value={{
        isSidebarOpen,
        setSidebarOpen,
        toggleSidebar: () => setSidebarOpen((currentOpen) => !currentOpen),
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
