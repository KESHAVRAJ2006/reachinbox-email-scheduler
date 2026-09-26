import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ServerOff } from 'lucide-react';
import { api, ApiError, onUnauthorized, tokenStore } from '../lib/api';
import type { User } from '../lib/types';
import { Button, Spinner } from '../components/ui';

// loading     = we have a token and are asking the API who it belongs to
// ready       = logged in, `user` is set
// anonymous   = no (valid) token: show the login page
// unreachable = the API didn't answer, so we can't tell yet
type AuthStatus = 'loading' | 'ready' | 'anonymous' | 'unreachable';

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  signIn: (token: string) => Promise<void>;
  signOut: (reason?: string) => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() => (tokenStore.get() ? 'loading' : 'anonymous'));
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();
  // A ref always holds the latest navigate, so the callbacks below never go stale.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const signOut = useCallback((reason?: string) => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
    navigateRef.current(reason ? `/login?error=${reason}` : '/login', { replace: true });
  }, []);

  // Asks the API "who am I?". This both validates the stored token and loads the
  // profile (name, avatar, Slack status) for the header.
  const refreshUser = useCallback(async () => {
    if (!tokenStore.get()) {
      setStatus('anonymous');
      return;
    }
    try {
      const { user } = await api.me();
      setUser(user);
      setStatus('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signOut('session_expired');
      else setStatus((current) => (current === 'ready' ? current : 'unreachable'));
    }
  }, [signOut]);

  const signIn = useCallback(
    async (token: string) => {
      tokenStore.set(token);
      setStatus('loading');
      await refreshUser();
    },
    [refreshUser],
  );

  useEffect(() => {
    // Any API call that gets a 401 (expired/invalid token) logs the user out.
    onUnauthorized(() => signOut('session_expired'));
    void refreshUser();
  }, [refreshUser, signOut]);

  return (
    <AuthContext.Provider value={{ status, user, signIn, signOut, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

// Wraps pages that need a logged-in user.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, refreshUser } = useAuth();

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading your workspace..." />
      </div>
    );
  }
  if (status === 'unreachable') {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="max-w-sm text-center">
          <ServerOff className="mx-auto size-10 text-slate-400" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Can't reach the server</h1>
          <p className="mt-1 text-sm text-slate-500">
            The API at localhost:4000 isn't responding. Start it with <code className="rounded bg-slate-100 px-1">npm run dev</code> in the backend folder.
          </p>
          <Button className="mt-5" onClick={() => void refreshUser()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
