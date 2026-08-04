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

type NavItem = { label: string; icon: LucideIcon; badge?: number };

const operations: NavItem[] = [
  { label: "Clients", icon: UsersRound },
  { label: "Agreements", icon: ShieldCheck },
  { label: "Representatives", icon: CircleUserRound },
  { label: "Warehouse Receipts", icon: ClipboardCheck },
  { label: "Coffee Lots", icon: Warehouse },
  { label: "Storage Loss", icon: AlertTriangle },
  { label: "Processing", icon: Boxes, badge: 4 },
  { label: "Dispatch", icon: PackageCheck },
  { label: "Ownership Transfers", icon: ShieldCheck },
  { label: "Bag Control", icon: Archive },
  { label: "Labour", icon: CircleUserRound },
  { label: "Generator Requests", icon: Gauge },
];

const management: NavItem[] = [
  { label: "Finance", icon: Banknote },
  { label: "Arrears Cases", icon: AlertTriangle },
  { label: "Reports", icon: Gauge },
  { label: "Documents", icon: FileText },
  { label: "Approvals", icon: ClipboardCheck, badge: 3 },
  { label: "Audit History", icon: Archive },
  { label: "Administration", icon: Settings },
];

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

const attention = [
  { count: 7, label: "Pending approvals", note: "3 processing - 2 dispatch - 2 bags", tone: "red" },
  { count: 5, label: "Agreements expiring", note: "Within the next 15 days", tone: "amber" },
  { count: 2, label: "Above allowance", note: "Independent approval required", tone: "red" },
  { count: 3, label: "Unpaid release blocks", note: "Dispatch cannot be posted", tone: "amber" },
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
          <div className="input-shell"><span>@</span><input id="email" name="email" type="email" defaultValue={supabaseConfigured ? "admin@hayked.local" : "system.admin@hayked.demo"} autoComplete="email" required /></div>

          <label htmlFor="password">Password</label>
          <div className="input-shell"><span>•</span><input id="password" name="password" type={showPassword ? "text" : "password"} defaultValue={supabaseConfigured ? "HaykedLocal#2026" : "HaykedDemo2026"} autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div>

          <div className="login-options"><label><input type="checkbox" defaultChecked /> Keep me signed in</label><button type="button">Forgot password?</button></div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="sign-in" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in to workspace"} <ArrowRight size={17} /></button>
          <div className="prototype-note"><ShieldCheck size={17} /><span><strong>{supabaseConfigured ? "Supabase authentication" : "Prototype access"}</strong>{supabaseConfigured ? "Access is checked against your assigned warehouse role." : "Demo credentials are pre-filled. No real company data is used."}</span></div>
        </form>
      </section>
    </main>
  );
}

function Sidebar({ open, activeView, onNavigate, onClose }: { open: boolean; activeView: string; onNavigate: (view: string) => void; onClose: () => void }) {
  const navGroup = (title: string, items: NavItem[]) => (
    <div className="nav-group">
      <p>{title}</p>
      {items.map(({ label, icon: Icon, badge }) => (
        <button key={label} type="button" className={activeView === label ? "active" : ""} disabled={!coreViews.includes(label) && label !== "Processing" && !warehouseControlViews.includes(label) && !dispatchViews.includes(label) && !financeViews.includes(label) && !managementViews.includes(label)} onClick={() => { onNavigate(label); onClose(); }}>
          <Icon size={17} /><span>{label}</span>{badge && <b>{badge}</b>}<ChevronRight size={14} />
        </button>
      ))}
    </div>
  );

  return (
    <>
      {open && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-head"><Brand /><button type="button" aria-label="Close navigation" onClick={onClose}><X size={20} /></button></div>
        <nav aria-label="Main navigation">
          <div className="nav-group"><p>OVERVIEW</p><button className={activeView === "Dashboard" ? "active" : ""} type="button" onClick={() => { onNavigate("Dashboard"); onClose(); }}><LayoutDashboard size={17} /><span>Dashboard</span></button></div>
          {navGroup("OPERATIONS", operations)}
          {navGroup("MANAGEMENT", management)}
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
  const filteredActivities = useMemo(() => activities.filter((row) => row.join(" ").toLowerCase().includes(query.toLowerCase())), [query]);
  const initials = profile.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const firstName = profile.full_name.split(/\s+/)[0];

  return (
    <main className="app-shell">
      <Sidebar open={sidebarOpen} activeView={activeView} onNavigate={setActiveView} onClose={() => setSidebarOpen(false)} />
      <section className="workspace">
        <header className="topbar">
          <div className="crumb"><button type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span>Operations</span><ChevronRight size={13} /><strong>{activeView}</strong></div>
          <div className="top-actions">
            <label className="global-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search GRN, lot, client or order..." /></label>
            <button className="icon-button" type="button" aria-label="Approvals" onClick={() => setActiveView("Approvals")}><ClipboardCheck size={18} /><b>3</b></button>
            <button className="icon-button" type="button" aria-label="Notifications"><Bell size={18} /><b>4</b></button>
            <button className="profile" type="button" onClick={onSignOut}><span>{initials}</span><span><strong>{profile.full_name}</strong><small>{profile.role.replaceAll("_", " ")}</small></span></button>
          </div>
        </header>

        {activeView === "Dashboard" ? <div className="dashboard">
          <section className="welcome-row">
            <div><span className="demo-label">LOCAL OPERATIONAL DATA</span><h1>Good morning, {firstName}.</h1><p>Here is the warehouse position and today&apos;s operational attention list.</p></div>
            <div className="page-actions"><button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={17} />Export overview</button><button className="primary-button" type="button" onClick={() => setActiveView("Warehouse Receipts")}><Plus size={17} />New warehouse receipt</button></div>
          </section>

          <section className="shift-strip">
            <div><span className="online-dot" /><strong>Day Shift - Active</strong><small>Saturday, 1 August 2026</small></div>
            <div><small>Current warehouse</small><strong>Main Warehouse - Gelancho</strong></div>
            <div><small>Governing agreement</small><strong>No. 001/2018 - Active</strong></div>
            <button type="button">View shift details <ArrowRight size={14} /></button>
          </section>

          <section className="metric-grid">
            {metrics.map(({ label, value, unit, detail, tone, icon: Icon }) => (
              <article className="metric-card" key={label}><div className={`metric-icon ${tone}`}><Icon size={22} /></div><div><p>{label}</p><strong>{value} <small>{unit}</small></strong></div><footer><span>{detail}</span><button type="button">View stock <ArrowRight size={13} /></button></footer></article>
            ))}
          </section>

          <section className="mini-grid">
            <article><i className="teal" /><span>Coffee in Processing<strong>38,400 kg</strong></span><small>2 active orders</small></article>
            <article><i className="amber" /><span>Waiting for Processing<strong>6 lots</strong></span><small>94,850 kg queued</small></article>
            <article><i className="blue" /><span>Awaiting Dispatch<strong>4 lots</strong></span><small>3 release-ready</small></article>
            <article><i className="violet" /><span>Hayked Byproducts<strong>12,400 kg</strong></span><small>Separate ownership ledger</small></article>
          </section>

          <section className="dashboard-grid">
            <article className="panel movements-panel">
              <header><div><h2>Seven-day warehouse movements</h2><p>Receipts and dispatches in kilograms</p></div><select aria-label="Movement period"><option>This week</option><option>Last week</option></select></header>
              <div className="legend"><span><i className="received" />Received 482,600 kg</span><span><i className="dispatched" />Dispatched 318,250 kg</span></div>
              <div className="bar-chart" aria-label="Warehouse movements chart">
                {movements.map((item) => <div className="bar-day" key={item.day}><div className="bars"><i className="received" style={{ height: `${item.received}%` }} /><i className="dispatched" style={{ height: `${item.dispatched}%` }} /></div><span>{item.day}</span></div>)}
              </div>
            </article>

            <article className="panel attention-panel">
              <header><div><h2>Needs attention</h2><p>Prioritized operational alerts</p></div><button type="button">Review all</button></header>
              <div>{attention.map((item) => <button className="attention-row" type="button" key={item.label}><b className={item.tone}>{item.count}</b><span><strong>{item.label}</strong><small>{item.note}</small></span><ChevronRight size={15} /></button>)}</div>
            </article>
          </section>

          <section className="panel activity-panel">
            <header><div><h2>Recent warehouse activity</h2><p>Latest posted and approval events</p></div><button type="button">View activity log</button></header>
            <div className="activity-table" role="table">
              {filteredActivities.length ? filteredActivities.map((row) => <div role="row" key={row[0]}>{row.map((cell, index) => <span role="cell" key={cell} className={index === 0 ? "reference" : ""}>{cell}</span>)}</div>) : <p className="empty-result">No activity matches &quot;{query}&quot;.</p>}
            </div>
          </section>
        </div> : activeView === "Processing" ? <ProcessingOperations /> : warehouseControlViews.includes(activeView) ? <WarehouseControls activeView={activeView} /> : dispatchViews.includes(activeView) ? <DispatchOperations activeView={activeView} /> : financeViews.includes(activeView) ? <FinanceOperations /> : managementViews.includes(activeView) ? <ManagementOperations activeView={activeView} /> : <CoreOperations activeView={activeView} />}
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
