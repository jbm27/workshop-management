const API_ENV = typeof import.meta !== 'undefined' ? String(import.meta.env?.VITE_API_URL || '').trim() : '';
const API = API_ENV ? API_ENV.replace(/\/+$/, '') : '/api';

async function request(path, options = {}) {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('admin_token') : null;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API + path, {
    headers,
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      window.localStorage.removeItem('admin_token');
    }
    throw new Error(data.error || res.statusText);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),

  admin: {
    login: (body) => api.post('/admin/login', body),
    logout: () => api.post('/admin/logout', {}),
    me: () => api.get('/admin/me'),
    users: {
      list: () => api.get('/admin/users'),
      assignable: () => api.get('/admin/users/assignable'),
      create: (body) => api.post('/admin/users', body),
      update: (id, body) => api.patch(`/admin/users/${id}`, body),
    },
    teamStats: (params) => {
      const sp = new URLSearchParams();
      if (params?.from) sp.set('from', params.from);
      if (params?.to) sp.set('to', params.to);
      if (params?.include_inactive) sp.set('include_inactive', '1');
      if (params?.admin_user_id != null && params.admin_user_id !== '') sp.set('admin_user_id', String(params.admin_user_id));
      const qs = sp.toString();
      return api.get('/admin/team-stats' + (qs ? `?${qs}` : ''));
    },
    teamStatsParts: (adminUserId, params) => {
      const sp = new URLSearchParams();
      if (params?.from) sp.set('from', params.from);
      if (params?.to) sp.set('to', params.to);
      const qs = sp.toString();
      return api.get(`/admin/team-stats/${adminUserId}/parts` + (qs ? `?${qs}` : ''));
    },
    teamStatsHours: (adminUserId, params) => {
      const sp = new URLSearchParams();
      if (params?.from) sp.set('from', params.from);
      if (params?.to) sp.set('to', params.to);
      const qs = sp.toString();
      return api.get(`/admin/team-stats/${adminUserId}/hours` + (qs ? `?${qs}` : ''));
    },
  },

  customers: {
    list: (q) => api.get(q ? `/customers?q=${encodeURIComponent(q)}` : '/customers'),
    get: (id) => api.get(`/customers/${id}`),
    vehicles: (id) => api.get(`/customers/${id}/vehicles`),
    create: (data) => api.post('/customers', data),
    update: (id, data) => api.patch(`/customers/${id}`, data),
    delete: (id) => api.delete(`/customers/${id}`),
    portalLink: (id) => api.post(`/customers/${id}/portal-link`, {}),
  },
  vehicles: {
    list: (params) => {
      const sp = new URLSearchParams();
      if (params?.q) sp.set('q', params.q);
      if (params?.customer_id) sp.set('customer_id', params.customer_id);
      return api.get('/vehicles' + (sp.toString() ? '?' + sp : ''));
    },
    get: (id) => api.get(`/vehicles/${id}`),
    create: (data) => api.post('/vehicles', data),
    update: (id, data) => api.patch(`/vehicles/${id}`, data),
    delete: (id) => api.delete(`/vehicles/${id}`),
  },
  jobs: {
    list: (params) => {
      const sp = new URLSearchParams();
      if (params?.status) sp.set('status', params.status);
      if (params?.q) sp.set('q', params.q);
      return api.get('/jobs' + (sp.toString() ? '?' + sp : ''));
    },
    get: (id) => api.get(`/jobs/${id}`),
    create: (data) => api.post('/jobs', data),
    update: (id, data) => api.patch(`/jobs/${id}`, data),
    addTestDrive: (jobId, body) => api.post(`/jobs/${jobId}/test-drives`, body),
    deleteTestDrive: (jobId, tdId) => api.delete(`/jobs/${jobId}/test-drives/${tdId}`),
    createQuote: (id) => api.post(`/jobs/${id}/quote`, {}),
    createInvoice: (id) => api.post(`/jobs/${id}/invoice`, {}),
    addTimeLog: (jobId, body) => api.post(`/jobs/${jobId}/time-logs`, body),
    deleteTimeLog: (jobId, logId) => api.delete(`/jobs/${jobId}/time-logs/${logId}`),
    myTimeLogs: (date) => api.get('/jobs/time-logs/mine' + (date ? `?date=${encodeURIComponent(date)}` : '')),
  },
  invoices: {
    list: (params) => {
      const sp = new URLSearchParams();
      if (params?.type) sp.set('type', params.type);
      if (params?.status) sp.set('status', params.status);
      if (params?.job_id) sp.set('job_id', params.job_id);
      if (params?.q) sp.set('q', params.q);
      return api.get('/invoices' + (sp.toString() ? '?' + sp : ''));
    },
    myAssignedReceipts: () => api.get('/invoices/assigned-receipts/mine'),
    get: (id) => api.get(`/invoices/${id}`),
    create: (data) => api.post('/invoices', data),
    update: (id, data) => api.patch(`/invoices/${id}`, data),
    addPayment: (id, data) => api.post(`/invoices/${id}/payments`, data),
    deletePayment: (invId, paymentId) => api.delete(`/invoices/${invId}/payments/${paymentId}`),
    addItem: (id, data) => api.post(`/invoices/${id}/items`, data),
    updateItem: (invId, itemId, data) => api.patch(`/invoices/${invId}/items/${itemId}`, data),
    deleteItem: (invId, itemId) => api.delete(`/invoices/${invId}/items/${itemId}`),
    listLpos: (invoiceId) => api.get(`/invoices/${invoiceId}/lpos`),
    createLpo: (invoiceId, body) => api.post(`/invoices/${invoiceId}/lpos`, body),
    updateLpo: (invoiceId, lpoId, body) => api.patch(`/invoices/${invoiceId}/lpos/${lpoId}`, body),
    approveLpo: (invoiceId, lpoId) => api.post(`/invoices/${invoiceId}/lpos/${lpoId}/approve`, {}),
    finalizeLpo: (invoiceId, lpoId) => api.post(`/invoices/${invoiceId}/lpos/${lpoId}/finalize`, {}),
    updateLpoLineReceipt: (invoiceId, lpoId, lineId, body) => api.patch(`/invoices/${invoiceId}/lpos/${lpoId}/lines/${lineId}/receipt`, body),
    deleteLpo: (invoiceId, lpoId) => api.delete(`/invoices/${invoiceId}/lpos/${lpoId}`),
    downloadLpoPDF: (invoiceId, lpoId) => {
      window.open(API + `/invoices/${invoiceId}/lpos/${lpoId}/pdf`, '_blank');
    },
    downloadIprPDF: (invoiceId, iprId) => {
      window.open(API + `/invoices/${invoiceId}/iprs/${iprId}/pdf`, '_blank');
    },
    listIprs: (invoiceId) => api.get(`/invoices/${invoiceId}/iprs`),
    createIpr: (invoiceId, body) => api.post(`/invoices/${invoiceId}/iprs`, body),
    updateIpr: (invoiceId, iprId, body) => api.patch(`/invoices/${invoiceId}/iprs/${iprId}`, body),
    approveIpr: (invoiceId, iprId) => api.post(`/invoices/${invoiceId}/iprs/${iprId}/approve`, {}),
    updateIprLineReceipt: (invoiceId, iprId, lineId, body) => api.patch(`/invoices/${invoiceId}/iprs/${iprId}/lines/${lineId}/receipt`, body),
    deleteIpr: (invoiceId, iprId) => api.delete(`/invoices/${invoiceId}/iprs/${iprId}`),
    finalizeIpr: (invoiceId, iprId) => api.post(`/invoices/${invoiceId}/iprs/${iprId}/finalize`, {}),
    downloadPDF: (id) => {
      const url = API + `/invoices/${id}/pdf`;
      window.open(url, '_blank');
    },
  },
  lpoIpr: {
    summary: () => api.get('/lpo-ipr/summary'),
  },
  suppliers: {
    list: (q) => api.get(q ? `/suppliers?q=${encodeURIComponent(q)}` : '/suppliers'),
    get: (id) => api.get(`/suppliers/${id}`),
    create: (data) => api.post('/suppliers', data),
    update: (id, data) => api.patch(`/suppliers/${id}`, data),
    delete: (id) => api.delete(`/suppliers/${id}`),
    addPayment: (id, data) => api.post(`/suppliers/${id}/payments`, data),
    deletePayment: (supplierId, paymentId) => api.delete(`/suppliers/${supplierId}/payments/${paymentId}`),
  },
  stock: {
    list: (params) => {
      const sp = new URLSearchParams();
      if (params?.q) sp.set('q', params.q);
      const qs = sp.toString();
      return api.get('/stock' + (qs ? `?${qs}` : ''));
    },
    get: (id) => api.get(`/stock/${id}`),
    create: (data) => api.post('/stock', data),
    receiveLpo: (data) => api.post('/stock/receive-lpo', data),
    listStockLpos: () => api.get('/stock/lpos'),
    getStockLpo: (lpoId) => api.get(`/stock/lpos/${lpoId}`),
    updateStockLpo: (lpoId, data) => api.patch(`/stock/lpos/${lpoId}`, data),
    finalizeStockLpo: (lpoId) => api.post(`/stock/lpos/${lpoId}/finalize`, {}),
    deleteStockLpo: (lpoId) => api.delete(`/stock/lpos/${lpoId}`),
    downloadStockLpoPdf: (lpoId) => {
      window.open(API + `/stock/lpos/${lpoId}/pdf`, '_blank');
    },
    update: (id, data) => api.patch(`/stock/${id}`, data),
    delete: (id) => api.delete(`/stock/${id}`),
  },
  jobTypes: {
    list: () => api.get('/job-types'),
    get: (id) => api.get(`/job-types/${id}`),
    create: (data) => api.post('/job-types', data),
    update: (id, data) => api.patch(`/job-types/${id}`, data),
    delete: (id) => api.delete(`/job-types/${id}`),
  },
  reports: {
    dashboard: () => api.get('/reports/dashboard'),
    sales: (from, to) => api.get('/reports/sales' + (from && to ? `?from=${from}&to=${to}` : '')),
    feedback: (from, to) => {
      const sp = new URLSearchParams();
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
      const qs = sp.toString();
      return api.get('/reports/feedback' + (qs ? `?${qs}` : ''));
    },
  },
  customerPortal: {
    get: (token) => api.get(`/customer-portal/${encodeURIComponent(token)}`),
    getJob: (token, jobId) =>
      api.get(`/customer-portal/${encodeURIComponent(token)}/jobs/${encodeURIComponent(jobId)}`),
    approveItem: (token, quoteId, itemId, approved) =>
      api.post(`/customer-portal/${encodeURIComponent(token)}/quotes/${quoteId}/items/${itemId}/approve`, { approved }),
    approveAllQuote: (token, quoteId) =>
      api.post(`/customer-portal/${encodeURIComponent(token)}/quotes/${quoteId}/approve-all`, {}),
    submitRating: (token, jobId, rating, feedback) =>
      api.post(`/customer-portal/${encodeURIComponent(token)}/jobs/${jobId}/rating`, { rating, feedback }),
  },
};
