import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getToken, hasToken, setToken, validateToken } from "../lib/api";

interface AuthState {
  token: string;
  authed: boolean;
  checking: boolean;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string>(() => getToken());
  const [authed, setAuthed] = useState<boolean>(() => hasToken());
  const [checking, setChecking] = useState<boolean>(() => hasToken());

  useEffect(() => {
    let active = true;
    if (!hasToken()) {
      setChecking(false);
      return;
    }
    validateToken()
      .then((ok) => {
        if (!active) return;
        setAuthed(ok);
        if (!ok) setToken("");
      })
      .finally(() => active && setChecking(false));
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (value: string): Promise<boolean> => {
    setToken(value);
    const ok = await validateToken();
    setTokenState(getToken());
    setAuthed(ok);
    if (!ok) setToken("");
    return ok;
  }, []);

  const logout = useCallback(() => {
    setToken("");
    setTokenState("");
    setAuthed(false);
  }, []);

  return (
    <AuthContext.Provider value={{ token, authed, checking, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
