import { createContext, useContext, type ReactNode } from "react";
import type { OperationalScopeSessionState } from "../lib/operationalScopeSession";

const OperationalScopeSessionContext = createContext<OperationalScopeSessionState | null>(null);

export function OperationalScopeSessionProvider({
  value,
  children,
}: {
  value: OperationalScopeSessionState;
  children: ReactNode;
}) {
  return (
    <OperationalScopeSessionContext.Provider value={value}>
      {children}
    </OperationalScopeSessionContext.Provider>
  );
}

export function useOperationalScopeSession(): OperationalScopeSessionState {
  const session = useContext(OperationalScopeSessionContext);
  if (!session) {
    throw new Error("Operational scope session is unavailable outside its provider");
  }
  return session;
}
