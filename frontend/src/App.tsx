import { useEffect, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { getCachedUser } from "./auth/session";
import { AppShell } from "./layout/AppShell";
import { parseHash, type Route } from "./lib/routing";
import { readUserTheme, writeUserTheme } from "./lib/theme";
import { DashboardScreen } from "./screens/DashboardScreen";
import { KpiScreen } from "./screens/KpiScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { CaseDetailScreen, ModuleListScreen, NewRecordScreen } from "./screens/ModuleScreens";
import { moduleTitle } from "./screens/shared";
import { ReportsScreen } from "./screens/ReportsScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
import { HwScreen } from "./screens/HwScreen";
import { AdminScreen } from "./screens/AdminScreen";
import { PerformanceScreen } from "./screens/PerformanceScreen";
import { ReviewScreen } from "./screens/SupportScreens";
import { WeatherScreen } from "./screens/WeatherScreen";

function titles(route: Route): { title: string; subtitle: string } {
  if (route.name === "dashboard") return { title: "Dashboard", subtitle: "" };
  if (route.name === "list" || route.name === "new") {
    return { title: moduleTitle(route.type), subtitle: "" };
  }
  if (route.name === "detail") return { title: "Record", subtitle: "" };
  if (route.name === "review") return { title: "Review & Records", subtitle: "" };
  if (route.name === "reports") return { title: "Reports", subtitle: "" };
  if (route.name === "kpi") return { title: "KPI Dashboard", subtitle: "" };
  if (route.name === "weather") return { title: "Weather Monitoring", subtitle: "" };
  if (route.name === "hw") return { title: "SCC Hardware", subtitle: "" };
  if (route.name === "contacts") {
    return { title: "Key Personnel & Contacts", subtitle: "" };
  }
  if (route.name === "admin") return { title: "Administration", subtitle: "" };
  return { title: "Operator Performance", subtitle: "" };
}

export default function App() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState<Route>(() => parseHash());
  const userKey = user?.username ?? null;
  const [dark, setDark] = useState(() => {
    try {
      const cached = getCachedUser();
      return readUserTheme(cached?.username);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!window.location.hash) window.location.hash = "#/dashboard";
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Sidebar / hash navigations should land at the top of the new page.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [route]);

  // Restore this account's last theme on sign-in / user switch.
  useEffect(() => {
    if (!userKey) {
      setDark((prev) => (prev ? false : prev));
      document.documentElement.classList.remove("theme-dark");
      return;
    }
    const next = readUserTheme(userKey);
    setDark((prev) => (prev === next ? prev : next));
  }, [userKey]);

  useEffect(() => {
    // Night mode only after sign-in; login stays light.
    const applyDark = Boolean(userKey) && dark;
    document.documentElement.classList.toggle("theme-dark", applyDark);
    return () => document.documentElement.classList.remove("theme-dark");
  }, [dark, userKey]);

  function setUserDark(value: boolean) {
    setDark(value);
    writeUserTheme(userKey, value);
  }

  if (loading) return <p className="state login-loading">Checking session…</p>;
  if (!user || user.must_change_password) return <LoginScreen />;

  const { title, subtitle } = titles(route);
  const caps = user.capabilities;
  const blocked =
    (route.name === "admin" && !caps.manage_users) ||
    (route.name === "performance" && !caps.operator_performance) ||
    (route.name === "kpi" && !caps.view_kpi) ||
    (route.name === "new" && !caps.register);

  return (
    <div className={dark ? "theme-dark" : undefined}>
      <AppShell
        route={route}
        title={title}
        subtitle={subtitle}
        dark={dark}
        onDark={setUserDark}
      >
        {blocked ? (
          <section className="page">
            <p className="state error">
              This workspace is restricted for your role (
              {user.role}).
            </p>
          </section>
        ) : (
          <Screen key={JSON.stringify(route)} route={route} dark={dark} onDark={setUserDark} />
        )}
      </AppShell>
    </div>
  );
}

function Screen({
  route,
  dark,
  onDark,
}: {
  route: Route;
  dark: boolean;
  onDark: (value: boolean) => void;
}) {
  if (route.name === "dashboard") {
    return <DashboardScreen tab={route.tab} dark={dark} onDark={onDark} />;
  }
  if (route.name === "list") {
    return <ModuleListScreen type={route.type} caseId={route.caseId} />;
  }
  if (route.name === "new") {
    return <NewRecordScreen type={route.type} />;
  }
  if (route.name === "detail") return <CaseDetailScreen id={route.id} />;
  if (route.name === "review") {
    return (
      <ReviewScreen
        caseId={route.caseId}
        status={route.status}
        types={route.types}
      />
    );
  }
  if (route.name === "reports") {
    return (
      <ReportsScreen reportId={route.reportId} openSign={Boolean(route.sign)} />
    );
  }
  if (route.name === "kpi") return <KpiScreen />;
  if (route.name === "weather") return <WeatherScreen />;
  if (route.name === "hw") return <HwScreen />;
  if (route.name === "contacts") return <ContactsScreen />;
  if (route.name === "admin") return <AdminScreen />;
  return <PerformanceScreen />;
}
