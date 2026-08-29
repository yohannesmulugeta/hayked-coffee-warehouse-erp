"use client";

import {
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  ArrowRight,
  Banknote,
  Bell,
  Boxes,
  Check,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  FileText,
  Gauge,
  LayoutDashboard,
  Menu,
  PackageCheck,
  Plus,
  Printer,
  Search,
  Settings,
  ShieldCheck,
  UsersRound,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { CoreOperations, coreViews } from "./core-operations";
import { ProcessingOperations } from "./processing-operations";
import { WarehouseControls, warehouseControlViews } from "./warehouse-controls";
import { DispatchOperations, dispatchViews } from "./dispatch-operations";
import { FinanceOperations, financeViews } from "./finance-operations";
import { ManagementOperations, managementViews } from "./management-operations";
import { createSupabaseClient, supabaseConfigured } from "@/lib/supabase/client";
import { loadDashboardData, type DashboardData } from "@/lib/erp-data";
import { notificationTarget, type ProcessingStateFilter, type StockStatusFilter, type StockTypeFilter } from "./ux-rules";

type NavItem = { view: string; label: string; icon: LucideIcon; badge?: number };
type NavigationIntent = { view: string; stockType?: StockTypeFilter; stockStatus?: StockStatusFilter; processingState?: ProcessingStateFilter; focusId?: string };

const operations: NavItem[] = [
  { view: "Clients", label: "Clients", icon: UsersRound },
  { view: "Warehouse Receipts", label: "Receive Coffee", icon: ClipboardCheck },
  { view: "Coffee Lots", label: "Coffee Stock", icon: Warehouse },
  { view: "Processing", label: "Processing", icon: Boxes },
  { view: "Dispatch", label: "Dispatch", icon: PackageCheck },
  { view: "Labour", label: "Labour & Services", icon: CircleUserRound },
];

const management: NavItem[] = [
  { view: "Finance", label: "Billing", icon: Banknote },
  { view: "Reports", label: "Reports", icon: Gauge },
  { view: "Approvals", label: "Approvals", icon: ClipboardCheck },
];

const administration: NavItem[] = [
  { view: "Agreements", label: "Agreements", icon: ShieldCheck },
  { view: "Representatives", label: "Representatives", icon: CircleUserRound },
  { view: "Storage Loss", label: "Storage Loss", icon: AlertTriangle },
  { view: "Ownership Transfers", label: "Ownership Transfers", icon: ShieldCheck },
  { view: "Bag Control", label: "Bag Control", icon: Archive },
  { view: "Generator Requests", label: "Generator Requests", icon: Gauge },
  { view: "Documents", label: "Documents", icon: FileText },
  { view: "Audit History", label: "Audit History", icon: Archive },
  { view: "Arrears Cases", label: "Collections (Arrears)", icon: AlertTriangle },
  { view: "Administration", label: "Administration", icon: Settings },
];

const viewLabels = new Map([...operations, ...management, ...administration].map((item) => [item.view, item.label]));

const metrics = [
  { label: "Total Coffee in Warehouse", value: "243,600", unit: "kg", detail: "4,060 bags", tone: "navy", icon: Warehouse },
  { label: "Arrival Coffee", value: "128,400", unit: "kg", detail: "2,140 bags", tone: "teal", icon: ArrowDownToLine },
  { label: "Processed Coffee", value: "76,800", unit: "kg", detail: "1,280 bags", tone: "green", icon: Check },
  { label: "Client Rejects", value: "9,420", unit: "kg", detail: "157 bags", tone: "amber", icon: AlertTriangle },
] as const;

const movements = [
  { day: "Fri", received: 42, dispatched: 28 },
  { day: "Sat", received: 61, dispatched: 47 },
  { day: "Sun", received: 49, dispatched: 36 },
  { day: "Mon", received: 73, dispatched: 56 },
  { day: "Tue", received: 55, dispatched: 39 },
  { day: "Wed", received: 84, dispatched: 64 },
  { day: "Thu", received: 67, dispatched: 51 },
];

const activities = [
  ["GRN-2026-0040", "Guji Specialty Coffee PLC", "Receipt posted", "25,200 kg"],
  ["PRO-2026-0014", "Sidama Highland Coffee", "Processing started", "19,200 kg"],
  ["DSP-2026-0008", "Biftu Buna Trading", "Awaiting approval", "12,600 kg"],
];

function Brand() {
  return (
    <div className="brand" title="Temporary Hayked logo placeholder">
      <span className="brand-mark">H</span>
      <span><strong>HAYKED</strong><small>COFFEE WAREHOUSE ERP</small></span>
    </div>
  );
}

function Login({ onSignIn }: { onSignIn: (email: string, password: string) => Promise<string | null> }) {
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const message = await onSignIn(String(data.get("email")), String(data.get("password")));
    if (message) setError(message);
    setBusy(false);
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="story-copy">
          <p className="eyebrow">WAREHOUSE OPERATIONS</p>
          <h1>Every coffee lot.<br />Fully traceable.</h1>
          <p>Manage client-owned coffee from arrival and processing through storage, dispatch, billing, and final reporting.</p>
          <div className="journey" aria-label="Warehouse workflow">
            <span><b>01</b>Arrival & GRN</span>
            <span><b>02</b>Process & Store</span>
            <span><b>03</b>Dispatch & Bill</span>
          </div>
        </div>
        <div className="login-foot"><span className="online-dot" />Agreement-aligned operations <span>(c) 2026 Hayked General Trading PLC</span></div>
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <span className="demo-label">{supabaseConfigured ? "SECURE WORKSPACE" : "DEMO ENVIRONMENT"}</span>
          <h2>Welcome back</h2>
          <p>Sign in to continue to Hayked Warehouse ERP.</p>

          <label htmlFor="email">Work email</label>
          <div className="input-shell"><span>@</span><input id="email" name="email" type="email" defaultValue={supabaseConfigured ? "" : "system.admin@hayked.demo"} autoComplete="email" required /></div>

          <label htmlFor="password">Password</label>
          <div className="input-shell"><span>•</span><input id="password" name="password" type={showPassword ? "text" : "password"} defaultValue={supabaseConfigured ? "" : "HaykedDemo2026"} autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div>

          <div className="login-options"><label><input type="checkbox" defaultChecked /> Keep me signed in</label><button type="button">Forgot password?</button></div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="sign-in" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in to workspace"} <ArrowRight size={17} /></button>
          <div className="prototype-note"><ShieldCheck size={17} /><span><strong>{supabaseConfigured ? "Supabase authentication" : "Prototype access"}</strong>{supabaseConfigured ? "Access is checked against your assigned warehouse role." : "Demo credentials are pre-filled. No real company data is used."}</span></div>
        </form>
      </section>
    </main>
  );
}

function Sidebar({ open, activeView, pendingApprovals, onNavigate, onClose }: { open: boolean; activeView: string; pendingApprovals: number; onNavigate: (intent: NavigationIntent) => void; onClose: () => void }) {
  const [moreOpen, setMoreOpen] = useState(administration.some((item) => item.view === activeView));
  const navGroup = (title: string, items: NavItem[]) => (
    <div className="nav-group">
      <p>{title}</p>
      {items.map(({ view, label, icon: Icon, badge }) => {
        const visibleBadge = view === "Approvals" ? pendingApprovals : badge;
        return (
        <button key={view} type="button" className={activeView === view ? "active" : ""} disabled={!coreViews.includes(view) && view !== "Processing" && !warehouseControlViews.includes(view) && !dispatchViews.includes(view) && !financeViews.includes(view) && !managementViews.includes(view)} onClick={() => { onNavigate({ view }); onClose(); }}>
          <Icon size={17} /><span>{label}</span>{Boolean(visibleBadge) && <b>{visibleBadge}</b>}<ChevronRight size={14} />
        </button>
      ); })}
    </div>
  );

  return (
    <>
      {open && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-head"><Brand /><button type="button" aria-label="Close navigation" onClick={onClose}><X size={20} /></button></div>
        <nav aria-label="Main navigation">
          <div className="nav-group"><p>OVERVIEW</p><button className={activeView === "Dashboard" ? "active" : ""} type="button" onClick={() => { onNavigate({ view: "Dashboard" }); onClose(); }}><LayoutDashboard size={17} /><span>Dashboard</span></button></div>
          {navGroup("OPERATIONS", operations)}
          {navGroup("FINANCE / MANAGEMENT", management)}
          <div className="nav-group more-navigation"><button className={administration.some((item) => item.view === activeView) ? "active" : ""} type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><Settings size={17} /><span>More / Administration</span><ChevronRight className={moreOpen ? "rotated" : ""} size={14} /></button>{moreOpen && <div className="more-navigation-items">{administration.map(({ view, label, icon: Icon }) => <button key={view} type="button" className={activeView === view ? "active" : ""} onClick={() => { onNavigate({ view }); onClose(); }}><Icon size={15} /><span>{label}</span></button>)}</div>}</div>
        </nav>
        <div className="warehouse-switch"><span>HW</span><div><strong>Main Warehouse</strong><small>Gelancho, Addis Ababa</small></div></div>
        <div className="system-status"><span className="online-dot" />All systems operational <span>v0.1</span></div>
      </aside>
    </>
  );
}

type CurrentProfile = { full_name: string; role: string };

function Dashboard({ onSignOut, profile }: { onSignOut: () => void; profile: CurrentProfile }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [stockIntent, setStockIntent] = useState<{ type: StockTypeFilter; status: StockStatusFilter; focusId?: string }>({ type: "All", status: "All" });
  const [processingState, setProcessingState] = useState<ProcessingStateFilter>("All");
  useEffect(() => { void loadDashboardData().then(setDashboardData).catch(() => setDashboardData(null)); }, []);
  const filteredActivities = useMemo(() => (dashboardData?.activities ?? (supabaseConfigured ? [] : activities)).filter((row) => row.join(" ").toLowerCase().includes(query.toLowerCase())), [dashboardData?.activities, query]);
  const visibleMetrics = dashboardData?.metrics.map((item, index) => ({ ...item, value: item.value.toLocaleString(), tone: metrics[index].tone, icon: metrics[index].icon })) ?? metrics;
  const visibleMovements = dashboardData?.movements ?? movements;
  const visibleAttention = dashboardData?.attention ?? [];
  const actionableAttention = visibleAttention.filter((item) => item.count > 0);
  const notificationCount = actionableAttention.reduce((sum, item) => sum + item.count, 0);
  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return (dashboardData?.searchIndex ?? []).filter((item) => `${item.kind} ${item.title} ${item.context}`.toLowerCase().includes(needle)).slice(0, 8);
  }, [dashboardData?.searchIndex, query]);
  const movementMax = Math.max(1, ...visibleMovements.flatMap((item) => [item.received, item.dispatched]));
  const receivedTotal = visibleMovements.reduce((sum, item) => sum + item.received, 0);
  const dispatchedTotal = visibleMovements.reduce((sum, item) => sum + item.dispatched, 0);
  const initials = profile.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const firstName = profile.full_name.split(/\s+/)[0];

  function navigate(intent: NavigationIntent) {
    if (intent.stockType || intent.stockStatus || intent.focusId) setStockIntent({ type: intent.stockType ?? "All", status: intent.stockStatus ?? "All", focusId: intent.focusId });
    if (intent.processingState) setProcessingState(intent.processingState);
    setActiveView(intent.view);
    setNotificationOpen(false);
    setQuery("");
  }

  function metricIntent(label: string): NavigationIntent {
    if (label === "Arrival Coffee") return { view: "Coffee Lots", stockType: "Arrival" };
    if (label === "Processed Coffee") return { view: "Coffee Lots", stockType: "Processed" };
    if (label === "Client Rejects") return { view: "Coffee Lots", stockType: "Reject" };
    return { view: "Coffee Lots" };
  }

  function miniIntent(label: string): NavigationIntent {
    if (label === "Coffee in Processing") return { view: "Processing", processingState: "In Progress" };
    if (label === "Waiting for Processing") return { view: "Processing", processingState: "Ready to Start" };
    if (label === "Awaiting Dispatch") return { view: "Dispatch" };
    return { view: "Coffee Lots", stockType: "Hayked Byproduct" };
  }

  return (
    <main className="app-shell">
      <Sidebar open={sidebarOpen} activeView={activeView} pendingApprovals={dashboardData?.pendingApprovals ?? 0} onNavigate={navigate} onClose={() => setSidebarOpen(false)} />
      <section className="workspace">
        <header className="topbar">
          <div className="crumb"><button type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /><span>Menu</span></button><span>Workspace</span><ChevronRight size={13} /><strong>{viewLabels.get(activeView) ?? activeView}</strong></div>
          <div className="top-actions">
            <div className="global-search-wrap"><label className="global-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search GRN, lot, client, order, dispatch or invoice" aria-label="Search warehouse records" /></label>{query.trim().length >= 2 && <div className="global-search-results" role="listbox" aria-label="Search results">{searchResults.length ? searchResults.map((item) => <button key={`${item.kind}-${item.id}`} type="button" onClick={() => navigate({ view: item.view, focusId: item.id })}><span>{item.kind}</span><strong>{item.title}</strong><small>{item.context}</small></button>) : <p>No matching warehouse records.</p>}</div>}</div>
            <button className="icon-button" type="button" aria-label="Approvals" onClick={() => navigate({ view: "Approvals" })}><ClipboardCheck size={18} />{Boolean(dashboardData?.pendingApprovals) && <b>{dashboardData?.pendingApprovals}</b>}</button>
            <div className="notification-wrap"><button className="icon-button" type="button" aria-label="Notifications" aria-expanded={notificationOpen} onClick={() => setNotificationOpen((value) => !value)}><Bell size={18} />{notificationCount > 0 && <b>{notificationCount}</b>}</button>{notificationOpen && <div className="notification-popover" role="dialog" aria-label="Items needing attention"><header><div><strong>Needs attention</strong><small>{notificationCount ? `${notificationCount} actionable item${notificationCount === 1 ? "" : "s"}` : "Warehouse queue is clear"}</small></div><button type="button" aria-label="Close notifications" onClick={() => setNotificationOpen(false)}><X size={16} /></button></header>{actionableAttention.length ? actionableAttention.map((item) => <button type="button" key={item.label} onClick={() => navigate(notificationTarget(item.label))}><b className={item.tone}>{item.count}</b><span><strong>{item.label}</strong><small>{item.note}</small></span><ChevronRight size={15} /></button>) : <p>No items need your attention.</p>}</div>}</div>
            <button className="profile" type="button" onClick={onSignOut}><span>{initials}</span><span><strong>{profile.full_name}</strong><small>{profile.role.replaceAll("_", " ")}</small></span></button>
          </div>
        </header>

        {activeView === "Dashboard" ? <div className="dashboard">
          <section className="welcome-row">
            <div><span className="demo-label">{supabaseConfigured ? "LIVE LOCAL DATABASE" : "LOCAL SAMPLE WORKSPACE"}</span><h1>Good morning, {firstName}.</h1><p>Here is the warehouse position and today&apos;s operational attention list.</p></div>
            <div className="page-actions"><button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={17} />Print overview</button><button className="primary-button" type="button" onClick={() => navigate({ view: "Warehouse Receipts" })}><Plus size={17} />Receive coffee</button></div>
          </section>

          <section className="metric-grid">
            {visibleMetrics.map(({ label, value, unit, detail, tone, icon: Icon }) => (
              <article className="metric-card" key={label}><div className={`metric-icon ${tone}`}><Icon size={22} /></div><div><p>{label}</p><strong>{value} <small>{unit}</small></strong></div><footer><span>{detail}</span><button type="button" onClick={() => navigate(metricIntent(label))}>View stock <ArrowRight size={13} /></button></footer></article>
            ))}
          </section>

          <section className="mini-grid">
            {(dashboardData?.mini ?? [
              { label: "Coffee in Processing", value: "38,400 kg", detail: "2 active orders" },
              { label: "Waiting for Processing", value: "6 lots", detail: "94,850 kg queued" },
              { label: "Awaiting Dispatch", value: "4 lots", detail: "3 release-ready" },
              { label: "Hayked Byproducts", value: "12,400 kg", detail: "Separate ownership ledger" },
            ]).map((item, index) => <button type="button" key={item.label} onClick={() => navigate(miniIntent(item.label))}><i className={["teal", "amber", "blue", "violet"][index]} /><span>{item.label}<strong>{item.value}</strong></span><small>{item.detail}</small><ChevronRight size={14} /></button>)}
          </section>

          <section className="dashboard-grid">
            <article className="panel movements-panel">
              <header><div><h2>Seven-day warehouse movements</h2><p>Receipts and dispatches in kilograms</p></div><select aria-label="Movement period"><option>This week</option><option>Last week</option></select></header>
              <div className="legend"><span><i className="received" />Received {receivedTotal.toLocaleString()} kg</span><span><i className="dispatched" />Dispatched {dispatchedTotal.toLocaleString()} kg</span></div>
              <div className="bar-chart" aria-label="Warehouse movements chart">
                {visibleMovements.map((item) => <div className="bar-day" key={item.day}><div className="bars"><i className="received" style={{ height: `${item.received / movementMax * 100}%` }} /><i className="dispatched" style={{ height: `${item.dispatched / movementMax * 100}%` }} /></div><span>{item.day}</span></div>)}
              </div>
            </article>

            <article className="panel attention-panel">
              <header><div><h2>Needs attention</h2><p>Prioritized operational alerts</p></div><button type="button" onClick={() => setNotificationOpen(true)}>Review all</button></header>
              <div>{actionableAttention.length ? actionableAttention.map((item) => <button className="attention-row" type="button" key={item.label} onClick={() => navigate(notificationTarget(item.label))}><b className={item.tone}>{item.count}</b><span><strong>{item.label}</strong><small>{item.note}</small></span><ChevronRight size={15} /></button>) : <p className="empty-result">No items need your attention.</p>}</div>
            </article>
          </section>

          <section className="panel activity-panel">
            <header><div><h2>Recent warehouse activity</h2><p>Latest posted and approval events</p></div><button type="button" onClick={() => navigate({ view: "Audit History" })}>View activity log</button></header>
            <div className="activity-table" role="table">
              {filteredActivities.length ? filteredActivities.map((row, rowIndex) => <div role="row" key={`${row[0]}-${rowIndex}`}>{row.map((cell, index) => <span role="cell" key={`${cell}-${index}`} className={index === 0 ? "reference" : ""}>{cell}</span>)}</div>) : <p className="empty-result">No activity matches &quot;{query}&quot;.</p>}
            </div>
          </section>
        </div> : activeView === "Processing" ? <ProcessingOperations initialState={processingState} /> : warehouseControlViews.includes(activeView) ? <WarehouseControls activeView={activeView} onNavigate={navigate} /> : dispatchViews.includes(activeView) ? <DispatchOperations activeView={activeView} /> : financeViews.includes(activeView) ? <FinanceOperations /> : managementViews.includes(activeView) ? <ManagementOperations activeView={activeView} onNavigate={navigate} /> : <CoreOperations activeView={activeView} stockIntent={stockIntent} />}
      </section>
    </main>
  );
}

export default function Home() {
  const [signedIn, setSignedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(supabaseConfigured);
  const [profile, setProfile] = useState<CurrentProfile>({ full_name: "Local user", role: "viewer" });

  async function loadProfile(userId: string) {
    const { data } = await createSupabaseClient().from("profiles").select("full_name,role").eq("id", userId).maybeSingle();
    if (data) setProfile(data);
  }

  useEffect(() => {
    if (!supabaseConfigured) return;
    const supabase = createSupabaseClient();
    void supabase.auth.getUser().then(({ data }) => {
      setSignedIn(Boolean(data.user));
      if (data.user) void loadProfile(data.user.id);
      setCheckingSession(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSignedIn(Boolean(session?.user)); if (session?.user) void loadProfile(session.user.id); });
    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    if (!supabaseConfigured) {
      setSignedIn(true);
      return null;
    }
    const { data, error } = await createSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) return error.message;
    if (data.user) await loadProfile(data.user.id);
    setSignedIn(true);
    return null;
  }

  async function signOut() {
    if (supabaseConfigured) await createSupabaseClient().auth.signOut();
    setProfile({ full_name: "Local user", role: "viewer" });
    setSignedIn(false);
  }

  if (checkingSession) return <main className="auth-loading"><Brand /><span>Checking secure session...</span></main>;
  return signedIn ? <Dashboard onSignOut={signOut} profile={profile} /> : <Login onSignIn={signIn} />;
}
