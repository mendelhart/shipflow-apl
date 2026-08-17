import { lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
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
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
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
            <Routes>
              {/* Public: reachable while signed out. */}
              <Route path="/login" element={<Login />} />
              {/* Everything else requires a session. */}
              <Route path="/*" element={<AuthenticatedApp />} />
            </Routes>
          </Router>
          <Toaster />
          <div className="fixed top-1 right-2 text-xs text-gray-400 select-none z-50 no-print" style={{fontFamily:"serif", pointerEvents:"none"}}>בס״ד</div>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App