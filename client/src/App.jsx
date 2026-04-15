import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import Vehicles from './pages/Vehicles';
import Jobs from './pages/Jobs';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import JobTypes from './pages/JobTypes';
import Stores from './pages/Stores';
import LpoIpr from './pages/LpoIpr';
import Suppliers from './pages/Suppliers';
import SupplierDetail from './pages/SupplierDetail';
import JobDetail from './pages/JobDetail';
import CustomerPortal from './pages/CustomerPortal';
import Feedback from './pages/Feedback';
import JobReports from './pages/JobReports';
import AdminLogin from './pages/AdminLogin';
import AdminUsers from './pages/AdminUsers';
import TeamStats from './pages/TeamStats';
import TimeLogs from './pages/TimeLogs';
import AssignedReceipts from './pages/AssignedReceipts';
import { AdminProvider, useAdmin } from './auth/AdminContext';

const MECHANIC_PATHS = new Set(['/time-logs', '/assigned-receipts']);

function AppShell({ children }) {
  const { admin, logout } = useAdmin();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const isMechanic = Boolean(admin?.is_mechanic);
  const canViewStores = admin?.permissions?.can_view_stores;
  const canViewLpoIpr = admin?.permissions?.can_view_lpo_ipr;
  const canManageTeamMembers = admin?.permissions?.can_manage_team_members;
  const canViewStatsReports = admin?.permissions?.can_view_statistics_reports;

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen || typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 768px)');
    if (!mq.matches) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  return (
    <div className={`app ${navOpen ? 'app--nav-open' : ''}`}>
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label="Open navigation menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <span className="mobile-menu-icon" aria-hidden>
            ☰
          </span>
        </button>
        <span className="mobile-topbar-title">Chequered Flag</span>
      </header>

      <button type="button" className="sidebar-scrim" tabIndex={-1} aria-hidden="true" onClick={() => setNavOpen(false)} />

      <aside className="sidebar" aria-label="Main navigation">
        <button type="button" className="sidebar-close-btn" aria-label="Close menu" onClick={() => setNavOpen(false)}>
          ×
        </button>
        <div className="brand">🏁 Chequered Flag</div>
        <nav>
          {!isMechanic && (
            <>
              <NavLink to="/" end>
                Dashboard
              </NavLink>
              <NavLink to="/jobs">Jobs</NavLink>
              <NavLink to="/customers">Customers</NavLink>
              <NavLink to="/vehicles">Vehicles</NavLink>
              <NavLink to="/invoices">Invoices & quotes</NavLink>
              {admin?.permissions?.can_view_stores !== false && <NavLink to="/stores">Stores</NavLink>}
              <NavLink to="/suppliers">Suppliers</NavLink>
              {admin?.permissions?.can_view_lpo_ipr !== false && <NavLink to="/lpo-ipr">LPO / IPR</NavLink>}
              <NavLink to="/job-types">Job types</NavLink>
              {canViewStatsReports !== false && <NavLink to="/feedback">Feedback</NavLink>}
              {canViewStatsReports !== false && <NavLink to="/reports/jobs">Job reports</NavLink>}
            </>
          )}
          <NavLink to="/time-logs">Time logs</NavLink>
          <NavLink to="/assigned-receipts">Assigned parts</NavLink>
          {!isMechanic && canManageTeamMembers && (
            <>
              <NavLink to="/admin/team-members">Team members</NavLink>
              {canViewStatsReports !== false && <NavLink to="/admin/team-stats">Team statistics</NavLink>}
            </>
          )}
        </nav>
        {admin && (
          <div className="sidebar-footer">
            <div className="sidebar-user">Signed in as {admin.display_name || admin.username}</div>
            <button type="button" className="btn btn-sidebar-logout" onClick={() => logout()}>
              Log out
            </button>
          </div>
        )}
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

function AdminShell({ location }) {
  const { admin, loading } = useAdmin();
  const isLogin = location.pathname === '/login';
  const isMechanic = Boolean(admin?.is_mechanic);
  const canViewStores = admin?.permissions?.can_view_stores;
  const canViewLpoIpr = admin?.permissions?.can_view_lpo_ipr;
  const canViewStatsReports = admin?.permissions?.can_view_statistics_reports;

  if (loading) return <div className="page-title">Loading…</div>;
  // Avoid hard route redirects in environments without history fallback.
  // If session is missing/expired, show login in place.
  if (!admin && !isLogin) return <AdminLogin />;

  if (admin && isMechanic && location.pathname === '/') {
    return <Navigate to="/time-logs" replace />;
  }

  if (admin && isMechanic && !MECHANIC_PATHS.has(location.pathname)) {
    return (
      <AppShell>
        <h1 className="page-title">Limited access</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Your account can only use <NavLink to="/time-logs">Time logs</NavLink> and{' '}
          <NavLink to="/assigned-receipts">Assigned parts</NavLink>.
        </p>
      </AppShell>
    );
  }

  // Simple “view restriction” for initial version.
  if (admin && !isMechanic && location.pathname.startsWith('/stores') && canViewStores === false) {
    return <div className="page-title">You do not have access to Stores.</div>;
  }
  if (admin && !isMechanic && location.pathname.startsWith('/lpo-ipr') && canViewLpoIpr === false) {
    return <div className="page-title">You do not have access to LPO / IPR.</div>;
  }
  if (
    admin &&
    !isMechanic &&
    (location.pathname.startsWith('/feedback') ||
      location.pathname.startsWith('/reports/jobs') ||
      location.pathname.startsWith('/admin/team-stats')) &&
    canViewStatsReports === false
  ) {
    return <div className="page-title">You do not have access to statistics and reports.</div>;
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/login" element={<AdminLogin />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/vehicles" element={<Vehicles />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/stores" element={<Stores />} />
        <Route path="/stock" element={<Navigate to="/stores" replace />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
        <Route path="/lpo-ipr" element={<LpoIpr />} />
        <Route path="/job-types" element={<JobTypes />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/reports/jobs" element={<JobReports />} />
        <Route path="/time-logs" element={<TimeLogs />} />
        <Route path="/assigned-receipts" element={<AssignedReceipts />} />
        <Route path="/admin/team-members" element={<AdminUsers />} />
        <Route path="/admin/team-stats" element={<TeamStats />} />
      </Routes>
    </AppShell>
  );
}

function App() {
  const location = useLocation();
  const isPortal = location.pathname.startsWith('/portal');

  // Customer portal layout: no admin sidebar, just the portal content
  if (isPortal) {
    return (
      <div className="app">
        <main className="main">
          <Routes>
            <Route path="/portal/:token/*" element={<CustomerPortal />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <AdminProvider>
      <AdminShell location={location} />
    </AdminProvider>
  );
}

export default App;
