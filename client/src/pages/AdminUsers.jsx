import { useEffect, useMemo, useState } from 'react';
import { useAdmin } from '../auth/AdminContext';
import { api } from '../api';

const PERMISSION_FIELDS = [
  { key: 'can_create_lpos', label: 'Create LPOs' },
  { key: 'can_create_iprs', label: 'Create IPRs' },
  { key: 'can_approve_lpo_ipr', label: 'Approve LPO / IPR' },
  { key: 'can_assign_lpo_ipr_receivers', label: 'Assign LPO / IPR receivers' },
  { key: 'can_record_invoice_payments', label: 'Record invoice payments' },
  { key: 'can_record_supplier_payments', label: 'Record supplier payments' },
  { key: 'can_finalize_lpos', label: 'Finalise LPOs (stock intake)' },
  { key: 'can_finalize_iprs', label: 'Finalise IPRs' },
  { key: 'can_manage_team_members', label: 'Manage team members' },
  { key: 'can_view_statistics_reports', label: 'View statistics and reports' },
  { key: 'can_view_lpo_ipr', label: 'View LPO / IPR page' },
  { key: 'can_view_stores', label: 'View Stores page' },
  { key: 'can_log_test_drives', label: 'Log test drives on jobs' },
];

function defaultPermissions() {
  const p = {};
  for (const f of PERMISSION_FIELDS) {
    p[f.key] =
      f.key === 'can_view_lpo_ipr' ||
      f.key === 'can_view_stores' ||
      f.key === 'can_view_statistics_reports' ||
      f.key === 'can_log_test_drives';
  }
  return p;
}

function allPermissionsFalse() {
  const p = {};
  for (const f of PERMISSION_FIELDS) p[f.key] = false;
  return p;
}

function mechanicPermissionsPayload(canLogTestDrives) {
  return { ...allPermissionsFalse(), can_log_test_drives: !!canLogTestDrives };
}

export default function AdminUsers() {
  const { admin } = useAdmin();
  const canManage = admin?.permissions?.can_manage_team_members;

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(null); // null | { mode: 'create'|'edit', user?: object }
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    password: '',
    active: true,
    is_mechanic: false,
    permissions: defaultPermissions(),
  });
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [labourCostPerHour, setLabourCostPerHour] = useState('');
  const [labourSettingsBusy, setLabourSettingsBusy] = useState(false);
  const [labourSettingsError, setLabourSettingsError] = useState('');
  const [labourSettingsSaved, setLabourSettingsSaved] = useState(false);

  const load = () => {
    setLoading(true);
    return api.admin.users
      .list()
      .then((data) => {
        setUsers(data);
        setListError('');
      })
      .catch((e) => setListError(String(e?.message || 'Could not load team members.')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!canManage) return;
    load();
    setLabourSettingsError('');
    setLabourSettingsSaved(false);
    api.admin.workshopSettings
      .get()
      .then((s) => {
        const v = Number(s?.average_labour_cost_per_hour);
        setLabourCostPerHour(Number.isFinite(v) ? String(v) : '0');
      })
      .catch((e) => setLabourSettingsError(String(e?.message || 'Could not load workshop settings.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const openCreate = () => {
    setSaveError('');
    setForm({
      username: '',
      display_name: '',
      password: '',
      active: true,
      is_mechanic: false,
      permissions: defaultPermissions(),
    });
    setModal({ mode: 'create' });
  };

  const openEdit = (u) => {
    setSaveError('');
    setForm({
      username: u.username,
      display_name: u.display_name,
      password: '',
      active: u.active,
      is_mechanic: !!u.is_mechanic,
      permissions: { ...defaultPermissions(), ...u.permissions },
    });
    setModal({ mode: 'edit', user: u });
  };

  const permSummary = (u) => {
    if (u.is_mechanic) {
      const td = u.permissions?.can_log_test_drives ? ' · Test drives' : '';
      return `Mechanic${td}`;
    }
    const parts = [];
    if (u.permissions.can_create_lpos) parts.push('LPO');
    if (u.permissions.can_create_iprs) parts.push('IPR');
    if (u.permissions.can_assign_lpo_ipr_receivers) parts.push('Assign receivers');
    if (u.permissions.can_record_invoice_payments) parts.push('Payments');
    if (u.permissions.can_finalize_lpos) parts.push('Finalise LPO');
    if (u.permissions.can_view_statistics_reports) parts.push('Reports');
    if (u.permissions.can_manage_team_members) parts.push('Admin');
    return parts.join(' · ');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    if (!form.username?.trim() && modal?.mode === 'create') return setSaveError('Username is required');
    if (!form.display_name?.trim()) return setSaveError('Display name is required');
    if (modal?.mode === 'create' && !form.password?.trim()) return setSaveError('Password is required');

    setBusy(true);
    setSaveError('');
    try {
      const payload = {
        // Username is also updatable in edit mode (changes login identity).
        username: form.username.trim(),
        display_name: form.display_name.trim(),
        active: !!form.active,
        is_mechanic: !!form.is_mechanic,
        permissions: form.is_mechanic ? mechanicPermissionsPayload(form.permissions.can_log_test_drives) : form.permissions,
      };
      if (modal?.mode === 'create') {
        payload.password = form.password;
        await api.admin.users.create(payload);
      } else {
        const patch = { ...payload };
        if (form.password?.trim()) patch.password = form.password.trim();
        await api.admin.users.update(modal.user.id, patch);
      }
      setModal(null);
      setForm((s) => ({ ...s, password: '' }));
      await load();
    } catch (err) {
      setSaveError(String(err?.message || 'Save failed.'));
    } finally {
      setBusy(false);
    }
  };

  const canViewStores = admin?.permissions?.can_view_stores;
  const canViewLpoIpr = admin?.permissions?.can_view_lpo_ipr;
  const canViewStatsReports = admin?.permissions?.can_view_statistics_reports;

  const missingNotes = useMemo(() => {
    const missing = [];
    if (!canViewLpoIpr) missing.push('LPO / IPR');
    if (!canViewStores) missing.push('Stores');
    if (!canViewStatsReports) missing.push('Statistics / Reports');
    return missing.length ? `View restricted for: ${missing.join(', ')}` : '';
  }, [canViewStatsReports, canViewStores, canViewLpoIpr]);

  if (!canManage) {
    return (
      <div style={{ padding: '1rem' }}>
        <h1 className="page-title">Team members</h1>
        <p style={{ color: 'var(--text-muted)' }}>You do not have permission to manage team members.</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Team members</h1>
      {listError ? (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '1rem' }}>
          {listError}
        </div>
      ) : null}
      {missingNotes && (
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          {missingNotes}
        </p>
      )}

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Labour cost (workshop)</h2>
        <p style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Set an <strong>average cost per hour</strong> (KES) used to estimate <strong>total labour cost</strong> on each
          job card from time logged. This is an internal cost figure, not the customer labour sell rate on quotes.
        </p>
        {labourSettingsError ? (
          <p style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{labourSettingsError}</p>
        ) : null}
        {labourSettingsSaved ? (
          <p style={{ color: '#15803d', marginBottom: '0.75rem', fontSize: '0.9rem' }}>Saved.</p>
        ) : null}
        <div className="form-group" style={{ marginBottom: '0.75rem' }}>
          <label>Average labour cost (KES per hour)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={labourCostPerHour}
            onChange={(e) => {
              setLabourSettingsSaved(false);
              setLabourCostPerHour(e.target.value);
            }}
            style={{ maxWidth: '12rem' }}
          />
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={labourSettingsBusy}
          onClick={async () => {
            const n = Number(labourCostPerHour);
            if (!Number.isFinite(n) || n < 0) {
              setLabourSettingsError('Enter a valid non-negative number.');
              return;
            }
            setLabourSettingsBusy(true);
            setLabourSettingsError('');
            setLabourSettingsSaved(false);
            try {
              const out = await api.admin.workshopSettings.update({ average_labour_cost_per_hour: n });
              setLabourCostPerHour(String(out?.average_labour_cost_per_hour ?? n));
              setLabourSettingsSaved(true);
            } catch (e) {
              setLabourSettingsError(String(e?.message || 'Save failed.'));
            } finally {
              setLabourSettingsBusy(false);
            }
          }}
        >
          {labourSettingsBusy ? 'Saving…' : 'Save labour rate'}
        </button>
      </div>

      <div className="search-bar" style={{ marginBottom: '1rem' }}>
        <button type="button" className="btn primary" onClick={openCreate}>
          Add team member
        </button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Active</th>
                <th>Permissions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5}>Loading…</td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No team members yet.
                  </td>
                </tr>
              )}
              {!loading &&
                users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.display_name}</strong>
                    </td>
                    <td>{u.username}</td>
                    <td>{u.active ? 'Yes' : 'No'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{permSummary(u) || '—'}</td>
                    <td>
                      <button type="button" className="btn" onClick={() => openEdit(u)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div
          className="modal-overlay"
          onClick={() => {
            setSaveError('');
            setModal(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>{modal.mode === 'create' ? 'New team member' : `Edit ${modal.user.display_name}`}</header>
            <form className="body" onSubmit={submit}>
              {saveError ? (
                <div
                  className="card"
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '0.75rem', padding: '0.5rem 0.75rem' }}
                >
                  {saveError}
                </div>
              ) : null}
              <div className="form-group">
                <label>Display name *</label>
                <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
              </div>

              {/* Allow changing username in edit mode too (affects login). */}
              {(modal.mode === 'create' || modal.mode === 'edit') && (
                <div className="form-group">
                  <label>Username {modal.mode === 'create' ? '*' : '(login)'} </label>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
                </div>
              )}

              <div className="form-group">
                <label>
                  Active{' '}
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} style={{ marginLeft: '0.5rem' }} />
                </label>
              </div>

              <div className="form-group">
                <label>{modal.mode === 'create' ? 'Password *' : 'New password (optional)'}</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete={modal.mode === 'create' ? 'new-password' : 'current-password'}
                />
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={!!form.is_mechanic}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setForm((prev) => {
                        if (checked) {
                          return {
                            ...prev,
                            is_mechanic: true,
                            permissions: mechanicPermissionsPayload(false),
                          };
                        }
                        const restored =
                          modal?.mode === 'edit' && modal?.user && !modal.user.is_mechanic
                            ? { ...modal.user.permissions }
                            : defaultPermissions();
                        return { ...prev, is_mechanic: false, permissions: restored };
                      });
                    }}
                  />
                  Mechanic (Time logs &amp; Assigned parts only)
                </label>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  Mechanics cannot access the rest of the workshop app. All other permissions are turned off except
                  test drives (below), if you allow it.
                </div>
              </div>

              {form.is_mechanic && (
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={!!form.permissions.can_log_test_drives}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          permissions: { ...form.permissions, can_log_test_drives: e.target.checked },
                        })
                      }
                      style={{ marginTop: '0.15rem' }}
                    />
                    <span>
                      <strong>Can log test drives</strong>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '0.25rem' }}>
                        Lets this person open <strong>Jobs</strong>, view mileage on a workshop job, and record test drive
                        returns (odometer and fuel).
                      </span>
                    </span>
                  </label>
                </div>
              )}

              <div className="card" style={{ padding: '0.75rem', marginTop: '0.75rem', opacity: form.is_mechanic ? 0.45 : 1 }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Permissions</div>
                {form.is_mechanic ? (
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Not used while &quot;Mechanic&quot; is enabled.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.6rem' }}>
                    {PERMISSION_FIELDS.map((f) => (
                      <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={!!form.permissions[f.key]}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              permissions: { ...form.permissions, [f.key]: e.target.checked },
                            })
                          }
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <footer style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSaveError('');
                    setModal(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

