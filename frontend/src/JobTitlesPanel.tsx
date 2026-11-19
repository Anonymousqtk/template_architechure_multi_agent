import { useEffect, useState, type FormEvent } from 'react';
import { errorText, request, type JobTitle } from './api';

const pageSize = 20;

export function JobTitlesPanel({ organizationId }: { organizationId: string }) {
  const endpoint = `/api/organizations/${organizationId}/job-titles`;
  const [items, setItems] = useState<JobTitle[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ q: '', isActive: '', page: 1 });
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<JobTitle | 'new' | null>(null);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams({ q: filters.q, page: String(filters.page), limit: String(pageSize) });
    if (filters.isActive) params.set('isActive', filters.isActive);
    setLoading(true);
    setListError('');
    request<{ items: JobTitle[]; total: number }>(`${endpoint}?${params}`).then(result => {
      if (!current) return;
      setItems(result.items);
      setTotal(result.total);
    }).catch(cause => { if (current) setListError(errorText(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [endpoint, filters, refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    const data = new FormData(event.currentTarget);
    const payload = { code: data.get('code'), name: data.get('name'), description: String(data.get('description')).trim() || null,
      isActive: data.get('isActive') === 'true' };
    setSaving(true);
    setFormError('');
    setMessage('');
    try {
      if (editing === 'new') await request(endpoint, payload);
      else await request(endpoint + '/' + editing.id, payload, 'PATCH');
      setEditing(null);
      setMessage('Đã lưu chức danh.');
      setRefresh(value => value + 1);
    } catch (cause) {
      setFormError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  function open(item: JobTitle | 'new') {
    setFormError('');
    setMessage('');
    setEditing(item);
  }

  const title = editing === 'new' ? null : editing;
  return <section aria-label="Danh mục chức danh">
    <div className="org-toolbar">
      <form className="org-filters" onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setFilters({ q: String(form.get('q')).trim(), isActive: String(form.get('isActive')), page: 1 });
      }}>
        <input name="q" type="search" aria-label="Tìm chức danh" maxLength={100} placeholder="Tìm theo mã hoặc tên" />
        <select name="isActive" aria-label="Lọc trạng thái chức danh">
          <option value="">Tất cả trạng thái</option><option value="true">Đang hoạt động</option><option value="false">Ngừng sử dụng</option>
        </select>
        <button className="primary" type="submit">Tìm kiếm</button>
      </form>
      <button className="primary primary-action" type="button" disabled={saving} onClick={() => open('new')}>+ Thêm chức danh</button>
    </div>
    {message && <p role="status" className="notice success">{message}</p>}
    {editing && <form key={editing === 'new' ? 'new' : editing.id} className="profile-editor" onSubmit={save} aria-busy={saving}>
      <h2>{title ? 'Sửa chức danh' : 'Thêm chức danh'}</h2>
      <fieldset disabled={saving}>
        <label className="field">Mã chức danh<input name="code" defaultValue={title?.code} maxLength={30} pattern={String.raw`[A-Za-z0-9_.\-]+`} required /></label>
        <label className="field">Tên chức danh<input name="name" defaultValue={title?.name} maxLength={100} required /></label>
        <label className="field">Mô tả<textarea name="description" defaultValue={title?.description ?? ''} maxLength={500} /></label>
        <label className="field">Trạng thái chức danh<select name="isActive" defaultValue={String(title?.isActive ?? true)}>
          <option value="true">Đang hoạt động</option><option value="false">Ngừng sử dụng</option>
        </select></label>
        {formError && <p className="notice error" role="alert">{formError}</p>}
        <div className="org-action-cell">
          <button className="primary" type="submit">{saving ? 'Đang lưu…' : 'Lưu chức danh'}</button>
          <button className="secondary" type="button" onClick={() => setEditing(null)}>Hủy</button>
        </div>
      </fieldset>
    </form>}
    {listError && <p role="alert" className="notice error">{listError} <button className="secondary" onClick={() => setRefresh(value => value + 1)}>Thử tải lại</button></p>}
    <div className="table-wrap" aria-busy={loading}>
      <table>
        <caption>{loading ? 'Đang tải…' : `${total} chức danh`}</caption>
        <thead><tr><th>Mã</th><th>Chức danh</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.id}>
          <td><span className="org-code-badge">{item.code}</span></td>
          <td><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</td>
          <td>{item.isActive ? 'Đang hoạt động' : 'Ngừng sử dụng'}</td>
          <td><button className="secondary" type="button" aria-label={`Sửa chức danh ${item.name}`} disabled={saving} onClick={() => open(item)}>Sửa</button></td>
        </tr>)}
        {!loading && !listError && !items.length && <tr><td colSpan={4}>Không tìm thấy chức danh.</td></tr>}</tbody>
      </table>
    </div>
    <div className="pagination">
      <button disabled={filters.page === 1 || loading} onClick={() => setFilters(value => ({ ...value, page: value.page - 1 }))}>← Trước</button>
      <span>Trang {filters.page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
      <button disabled={filters.page * pageSize >= total || loading} onClick={() => setFilters(value => ({ ...value, page: value.page + 1 }))}>Sau →</button>
    </div>
  </section>;
}
