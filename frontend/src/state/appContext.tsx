/**
 * Global application context — provides the active Table Space to all pages.
 *
 * SpaceSelector writes here; ExplorerPage and ConfigWizard read from here.
 * Spaces are loaded once at mount and refreshed on demand.
 */
import {
  createContext, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from "react";
import { api, type TableSpace } from "../api/client";

interface AppCtx {
  spaces: TableSpace[];
  activeSpace: TableSpace | null;
  setActiveSpace: (s: TableSpace | null) => void;
  reloadSpaces: () => Promise<void>;
  spacesLoading: boolean;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [spaces, setSpaces] = useState<TableSpace[]>([]);
  const [activeSpace, setActiveSpaceState] = useState<TableSpace | null>(null);
  const [spacesLoading, setSpacesLoading] = useState(true);

  const reloadSpaces = useCallback(async () => {
    setSpacesLoading(true);
    try {
      const list = await api.listSpaces();
      setSpaces(list);
      // Auto-select default or first
      if (!activeSpace || !list.find((s) => s.id === activeSpace.id)) {
        const def = list.find((s) => s.is_default) ?? list[0] ?? null;
        setActiveSpaceState(def);
      } else {
        // Refresh active space data
        const updated = list.find((s) => s.id === activeSpace?.id);
        if (updated) setActiveSpaceState(updated);
      }
    } catch {
      // Backend not ready — silently fail
    } finally {
      setSpacesLoading(false);
    }
  }, [activeSpace?.id]);

  useEffect(() => { reloadSpaces(); }, []);

  const setActiveSpace = useCallback((s: TableSpace | null) => {
    setActiveSpaceState(s);
  }, []);

  return (
    <Ctx.Provider value={{ spaces, activeSpace, setActiveSpace, reloadSpaces, spacesLoading }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppCtx() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppCtx must be inside AppContextProvider");
  return ctx;
}
