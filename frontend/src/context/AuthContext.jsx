import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getCurrentUser } from "../services/api.js";
import { clearToken, getToken, subscribeAuthChange } from "../services/auth.js";

const AuthContext = createContext(null);

/**
 * AuthProvider keeps the authenticated User + token lifecycle in one place.
 *
 * On mount (and whenever the token changes via login/logout/401) it tries to
 * load the current user from GET /api/auth/me. `loading` is true only while
 * that first check is in flight, so the app can show a spinner instead of
 * flashing the login page for a user who already has a valid token.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const me = await getCurrentUser();
      setUser(me ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return subscribeAuthChange(refresh);
  }, [refresh]);

  const value = {
    user,
    loading,
    // clearToken() clears storage AND dispatches the change event, which
    // triggers refresh() -> setUser(null) above.
    logout: clearToken,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
