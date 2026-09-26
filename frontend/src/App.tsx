import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireAuth } from './auth/AuthContext';
import { ToastProvider } from './components/Toasts';
import AuthCallbackPage from './pages/AuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';

// Three screens. The dashboard is wrapped in RequireAuth, which sends anonymous
// visitors to /login.
export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* The API redirects here after Google login, with #token=... */}
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
