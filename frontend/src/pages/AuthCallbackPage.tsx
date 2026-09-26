import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';

// The API redirects here after Google login:
//   /auth/callback#token=<jwt>      on success
//   /auth/callback#error=<code>     on failure
// The token is in the #fragment, which browsers never send to any server.
export default function AuthCallbackPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false); // StrictMode runs effects twice in dev; do the work once

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get('token');
    if (!token) {
      navigate(`/login?error=${fragment.get('error') ?? 'missing_token'}`, { replace: true });
      return;
    }
    // `replace` removes the token URL from history, so Back can't reveal it.
    void signIn(token).then(() => navigate('/', { replace: true }));
  }, [navigate, signIn]);

  return (
    <div className="grid min-h-screen place-items-center">
      <Spinner label="Signing you in..." />
    </div>
  );
}
