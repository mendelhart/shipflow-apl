import { lazy, Suspense, useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { ThemeProvider } from '@/components/ThemeContext';

// Add page imports here

const TjxCanada = lazy(() => import('./pages/TjxCanada'));
const CustomerDocs = lazy(() => import('./pages/CustomerDocs'));
const CommercialInvoice = lazy(() => import('./pages/CommercialInvoice'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Vendors = lazy(() => import('./pages/Vendors'));
const Products = lazy(() => import('./pages/Products'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const Invoices = lazy(() => import('./pages/Invoices'));
const PackingLists = lazy(() => import('./pages/PackingLists'));
const Labels = lazy(() => import('./pages/Labels'));
const PalletLabels = lazy(() => import('./pages/PalletLabels'));
const SCLP = lazy(() => import('./pages/SCLP.jsx'));
const FoodChecklist = lazy(() => import('./pages/FoodChecklist'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

const RouteFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

const AuthenticatedApp = () => {
  const {
    isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated,
    navigateToLogin, checkAppState,
  } = useAuth();

  // Redirecting during render is a side effect in the render phase; it re-fires
  // on every render until the browser navigates. Do it in an effect instead.
  useEffect(() => {
    if (!isLoadingAuth && authError?.type === 'auth_required') {
      navigateToLogin();
    }
  }, [isLoadingAuth, authError, navigateToLogin]);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError message={authError.message} />;
  }

  // A transient failure (offline, DNS, a token refresh that didn't land) used
  // to fall through to the permanent "not registered" screen. It is
  // recoverable, so offer the recovery.
  if (authError?.type === 'network_error') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Can&apos;t reach the server</h1>
          <p className="mt-2 text-sm text-slate-600">{authError.message}</p>
          <button
            onClick={checkAppState}
            className="mt-6 w-full h-9 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Belt and braces: never render app chrome without a session, even if
  // authError is somehow null.
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<Navigate to="/Dashboard" replace />} />
      <Route path="/Dashboard" element={<Dashboard />} />
      <Route path="/Vendors" element={<Vendors />} />
      <Route path="/Products" element={<Products />} />
      <Route path="/PurchaseOrders" element={<PurchaseOrders />} />
      <Route path="/Invoices" element={<Invoices />} />
      <Route path="/PackingLists" element={<PackingLists />} />
      <Route path="/Labels" element={<Labels />} />
      <Route path="/PalletLabels" element={<PalletLabels />} />
      <Route path="/SCLP" element={<SCLP />} />
      <Route path="/FoodChecklist" element={<FoodChecklist />} />
      <Route path="/Settings" element={<Settings />} />
      <Route path="/TjxCanada" element={<TjxCanada />} />
      <Route path="/CustomerDocs" element={<CustomerDocs />} />
      <Route path="/CommercialInvoice" element={<CommercialInvoice />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ErrorBoundary>
            <Routes>
              {/* Public: reachable while signed out. */}
              <Route path="/login" element={<Login />} />
              {/* Everything else requires a session. */}
              <Route path="/*" element={<AuthenticatedApp />} />
            </Routes>
            </ErrorBoundary>
          </Router>
          <Toaster />
          <div className="fixed top-1 right-2 text-xs text-gray-400 select-none z-50 no-print" style={{fontFamily:"serif", pointerEvents:"none"}}>בס״ד</div>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App