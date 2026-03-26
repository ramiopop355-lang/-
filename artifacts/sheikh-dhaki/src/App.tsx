import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useEffect, useState, lazy, Suspense, useCallback } from "react";
import SplashScreen from "@/components/SplashScreen";

const NotFound = lazy(() => import("@/pages/not-found"));
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Offline = lazy(() => import("@/pages/Offline"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => { if (!isLoggedIn) setLocation("/login"); }, [isLoggedIn, setLocation]);
  if (!isLoggedIn) return null;
  return <Component />;
}

function Router() {
  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/">
          <ProtectedRoute component={Dashboard} />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showSplash, setShowSplash] = useState(
    () => !sessionStorage.getItem("sigma_splash_done")
  );
  const handleSplashDone = useCallback(() => {
    sessionStorage.setItem("sigma_splash_done", "1");
    setShowSplash(false);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!isOnline) return <Suspense fallback={null}><Offline /></Suspense>;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
    </QueryClientProvider>
  );
}

export default App;
