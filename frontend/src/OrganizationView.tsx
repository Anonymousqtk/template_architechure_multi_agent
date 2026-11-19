import { useEffect, useState, type FormEvent } from 'react';
import {
  errorText,
  request,
  type Department,
  type OrgChartData,
  type OrgChartNode,
  type OrgDetails,
  type Position,
  type Profile,
} from './api';
import type { Account } from './account-types';
import './org.css';

function ErrorMessage({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return text ? <div className="notice error org-load-error" role="alert"><span>{text}</span>{onRetry && <button type="button" className="secondary" onClick={onRetry}>Thử tải lại</button>}</div> : null;
}

function SuccessMessage({ text }: { text: string }) {
  return text ? <p className="notice success" role="status">{text}</p> : null;
}

// ============================================================================
// 1. ORG-CHART VIEW (ORG-001.5)
// ============================================================================
function TreeNodeItem({
  node,
  depth = 0,
}: {
  node: OrgChartNode;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const hasMembers = node.members && node.members.length > 0;

  return (
    <li className="org-node-item" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div className="org-card-box">
        <div className="org-card-header">
          <div className="org-card-title-group">
            <span className="org-code-badge">{node.code}</span>
            <h3 className="org-card-title">{node.name}</h3>
          </div>
          <div className="org-card-actions">
            {hasChildren && (
              <button
                type="button"
                className="org-toggle-btn"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
              >
                {expanded ? 'Thu gọn ▲' : `Mở rộng (${node.children.length}) ▼`}
              </button>
            )}
          </div>
        </div>

        <div className="org-card-body">
          {node.description && <p className="muted">{node.description}</p>}
          <div className="org-meta-row">
            <span className="org-manager-badge">
              <strong>Trưởng đơn vị:</strong>{' '}
              {node.manager ? `${node.manager.fullName}${node.manager.email ? ` (${node.manager.email})` : ''}` : 'Chưa phân công'}
            </span>
            <span className="badge">
              {node.members.length} nhân sự
            </span>
          </div>

          {hasMembers && (
            <div className="org-members-preview">
              {node.members.map(m => (
                <span key={m.userId} className="org-member-chip" title={m.email}>
                  <strong>{m.fullName}</strong>
                  {m.positionTitle && <small>· {m.positionTitle}</small>}
                  {m.managerName && <small> (QL: {m.managerName})</small>}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <ul className="org-tree-node-list" style={{ marginTop: 12 }}>
          {node.children.map(child => (
            <TreeNodeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChartView({ profile }: { profile: Profile }) {
  const [data, setData] = useState<OrgChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = () => {
    setLoading(true);
    setError('');
    request<OrgChartData>(`/api/organizations/${profile.organization.id}/org-chart`)
      .then(res => setData(res))
      .catch(err => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [profile.organization.id]);

  if (loading) return <p role="status">Đang tải sơ đồ tổ chức…</p>;
  if (error) return <ErrorMessage text={error} onRetry={loadData} />;
  if (!data) return <p>Không có dữ liệu sơ đồ tổ chức.</p>;

  return (
    <div>
      <div className="org-stats-grid">
        <div className="org-stat-card">
          <div className="org-stat-icon">🏢</div>
          <div>
            <div className="org-stat-value">{data.totalDepartments}</div>
            <div className="org-stat-label">Tổng số phòng ban</div>
          </div>
        </div>
        <div className="org-stat-card">
          <div className="org-stat-icon blue">💼</div>
          <div>
            <div className="org-stat-value">{data.totalPositions}</div>
            <div className="org-stat-label">Tổng số chức danh</div>
          </div>
        </div>
        <div className="org-stat-card">
          <div className="org-stat-icon green">👥</div>
          <div>
            <div className="org-stat-value">{data.totalMembers}</div>
            <div className="org-stat-label">Tổng số thành viên</div>
          </div>
        </div>
      </div>

      <div className="org-tree-wrapper">
        <div className="org-tree-root-card">
          <div>
            <span className="eyebrow">TỔ CHỨC CẤP CAO NHẤT</span>
            <h2>{data.organization.name} {data.organization.code ? `(${data.organization.code})` : ''}</h2>
            {data.organization.description && <p className="muted" style={{ margin: '4px 0 0' }}>{data.organization.description}</p>}
          </div>
          <button className="secondary" onClick={loadData}>Làm mới</button>
        </div>

        {data.departmentTree.length === 0 ? (
          <p className="muted">Chưa có phòng ban nào được thiết lập trong tổ chức.</p>
        ) : (
          <ul className="org-tree-node-list">
            {data.departmentTree.map(rootNode => (
              <TreeNodeItem key={rootNode.id} node={rootNode} />
            ))}
          </ul>
        )}

        {data.unassignedMembers && data.unassignedMembers.length > 0 && (
          <div style={{ marginTop: 24, padding: 16, background: '#faf9fc', borderRadius: 8, border: '1px dashed #dbdade' }}>
            <h4 style={{ margin: '0 0 10px', color: '#5d596c' }}>
              Thành viên chưa phân bổ phòng ban ({data.unassignedMembers.length})
            </h4>
            <div className="org-members-preview">
              {data.unassignedMembers.map(m => (
                <span key={m.userId} className="org-member-chip" style={{ background: '#f8f7fa', color: '#5d596c' }}>
                  <strong>{m.fullName}</strong> ({m.email})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 2. DEPARTMENTS PANEL (ORG-001.2)
// ============================================================================
export function DepartmentsPanel({ profile }: { profile: Profile }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modals state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formParentId, setFormParentId] = useState('');
  const [formManagerId, setFormManagerId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Available managers (members)
  const [members, setMembers] = useState<Account[]>([]);

  const orgId = profile.organization.id;
  const canManage = profile.permissions.manageOrg || ['ADMIN', 'HR'].includes(profile.organization.role);

  const loadDepartments = () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) params.set('q', search.trim());

    request<{ items: Department[]; total: number }>(`/api/organizations/${orgId}/departments?${params}`)
      .then(res => {
        setDepartments(res.items);
        setTotal(res.total);
      })
      .catch(err => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDepartments();
  }, [orgId, page]);

  useEffect(() => {
    if (canManage) {
      request<{ items: Account[] }>(`/api/organizations/${orgId}/users?limit=100&status=active`)
        .then(res => setMembers(res.items))
        .catch(() => {});
    }
  }, [orgId, canManage]);

  const openCreateModal = () => {
    setEditingDept(null);
    setFormCode('');
    setFormName('');
    setFormDesc('');
    setFormParentId('');
    setFormManagerId('');
    setError('');
    setSuccess('');
    setModalOpen(true);
  };

  const openEditModal = (dept: Department) => {
    setEditingDept(dept);
    setFormCode(dept.code);
    setFormName(dept.name);
    setFormDesc(dept.description || '');
    setFormParentId(dept.parentId || '');
    setFormManagerId(dept.managerUserId || '');
    setError('');
    setSuccess('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingDept(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      if (editingDept) {
        await request(
          `/api/organizations/${orgId}/departments/${editingDept.id}`,
          {
            code: formCode.trim().toUpperCase(),
            name: formName.trim(),
            description: formDesc.trim() || null,
            parentId: formParentId || null,
            managerUserId: formManagerId || null,
          },
          'PATCH',
        );
        setSuccess(`Đã cập nhật phòng ban ${formName}.`);
      } else {
        await request(`/api/organizations/${orgId}/departments`, {
          code: formCode.trim().toUpperCase(),
          name: formName.trim(),
          description: formDesc.trim() || null,
          parentId: formParentId || null,
          managerUserId: formManagerId || null,
        });
        setSuccess(`Đã tạo phòng ban ${formName}.`);
      }
      closeModal();
      loadDepartments();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (dept: Department) => {
    if (!window.confirm(`Bạn có chắc muốn xóa phòng ban "${dept.name}" (${dept.code})?`)) return;
    setError('');
    setSuccess('');
    try {
      await request(`/api/organizations/${orgId}/departments/${dept.id}`, {}, 'DELETE');
      setSuccess(`Đã xóa phòng ban "${dept.name}".`);
      loadDepartments();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div>
      <div className="org-toolbar">
        <form
          className="org-filters"
          onSubmit={e => {
            e.preventDefault();
            setPage(1);
            loadDepartments();
          }}
        >
          <input
            type="search"
            placeholder="Tìm theo mã hoặc tên phòng ban…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button type="submit" className="primary">Tìm kiếm</button>
        </form>

        {canManage && (
          <button type="button" className="primary primary-action" onClick={openCreateModal}>
            + Thêm phòng ban mới
          </button>
        )}
      </div>

      <ErrorMessage text={error} onRetry={loadDepartments} />
      <SuccessMessage text={success} />

      <div className="table-wrap" aria-busy={loading}>
        <table>
          <caption>{loading ? 'Đang tải…' : error ? 'Danh sách phòng ban chưa tải được' : `${total} phòng ban trong tổ chức`}</caption>
          <thead>
            <tr>
              <th>Mã đơn vị</th>
              <th>Tên phòng ban</th>
              <th>Đơn vị cấp trên</th>
              <th>Trưởng đơn vị</th>
              <th>Nhân sự</th>
              <th>Trực thuộc</th>
              {canManage && <th>Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {departments.map(dept => (
              <tr key={dept.id}>
                <td><span className="org-code-badge">{dept.code}</span></td>
                <td>
                  <strong>{dept.name}</strong>
                  {dept.description && <small>{dept.description}</small>}
                </td>
                <td>{dept.parentName || '—'}</td>
                <td>{dept.managerName ? `${dept.managerName}` : '—'}</td>
                <td><span className="badge">{dept.memberCount}</span></td>
                <td><span className="badge">{dept.childCount}</span></td>
                {canManage && (
                  <td>
                    <div className="org-action-cell">
                      <button className="org-btn-edit secondary" onClick={() => openEditModal(dept)}>Sửa</button>
                      <button
                        className="org-btn-delete secondary"
                        onClick={() => handleDelete(dept)}
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!loading && !error && departments.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 6}>Không tìm thấy phòng ban nào.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>
          ← Trước
        </button>
        <span>Trang {page} / {Math.max(1, Math.ceil(total / 20))}</span>
        <button disabled={page * 20 >= total || loading} onClick={() => setPage(p => p + 1)}>
          Sau →
        </button>
      </div>

      {modalOpen && (
        <div className="org-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="org-modal-dialog">
            <div className="org-modal-header">
              <h2>{editingDept ? 'Chỉnh sửa phòng ban' : 'Thêm phòng ban mới'}</h2>
              <button className="secondary" onClick={closeModal}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <ErrorMessage text={error} />
              <label className="field">
                Mã phòng ban (DUY NHẤT)
                <input
                  required
                  maxLength={30}
                  value={formCode}
                  onChange={e => setFormCode(e.target.value.toUpperCase())}
                  placeholder="VD: HR_DEPT, SALES_HCM"
                  disabled={submitting}
                />
              </label>

              <label className="field">
                Tên phòng ban
                <input
                  required
                  maxLength={100}
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="VD: Phòng Nhân sự, Ban Giám đốc"
                  disabled={submitting}
                />
              </label>

              <label className="field">
                Đơn vị cấp trên (nếu có)
                <select
                  value={formParentId}
                  onChange={e => setFormParentId(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">Không có (Đơn vị gốc)</option>
                  {departments
                    .filter(d => !editingDept || d.id !== editingDept.id)
                    .map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                </select>
              </label>

              <label className="field">
                Trưởng đơn vị (quản lý)
                <select
                  value={formManagerId}
                  onChange={e => setFormManagerId(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">Chưa phân công</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} ({m.email})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                Mô tả chức năng
                <textarea
                  maxLength={500}
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  placeholder="Mô tả chức năng, nhiệm vụ phòng ban…"
                  disabled={submitting}
                  rows={3}
                />
              </label>

              <div className="org-modal-footer">
                <button type="button" className="secondary" onClick={closeModal} disabled={submitting}>
                  Hủy
                </button>
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? 'Đang lưu…' : editingDept ? 'Cập nhật' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 3. POSITIONS PANEL (ORG-001.3)
// ============================================================================
export function PositionsPanel({ profile }: { profile: Profile }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPos, setEditingPos] = useState<Position | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDeptId, setFormDeptId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const orgId = profile.organization.id;
  const canManage = profile.permissions.manageOrg || ['ADMIN', 'HR'].includes(profile.organization.role);

  const loadPositions = () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) params.set('q', search.trim());
    if (selectedDeptId) params.set('departmentId', selectedDeptId);

    request<{ items: Position[]; total: number }>(`/api/organizations/${orgId}/positions?${params}`)
      .then(res => {
        setPositions(res.items);
        setTotal(res.total);
      })
      .catch(err => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPositions();
  }, [orgId, page, selectedDeptId]);

  useEffect(() => {
    request<{ items: Department[] }>(`/api/organizations/${orgId}/departments?limit=100`)
      .then(res => setDepartments(res.items))
      .catch(() => {});
  }, [orgId]);

  const openCreateModal = () => {
    setEditingPos(null);
    setFormCode('');
    setFormTitle('');
    setFormDesc('');
    setFormDeptId(selectedDeptId || '');
    setError('');
    setSuccess('');
    setModalOpen(true);
  };

  const openEditModal = (pos: Position) => {
    setEditingPos(pos);
    setFormCode(pos.code);
    setFormTitle(pos.title);
    setFormDesc(pos.description || '');
    setFormDeptId(pos.departmentId || '');
    setError('');
    setSuccess('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingPos(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      if (editingPos) {
        await request(
          `/api/organizations/${orgId}/positions/${editingPos.id}`,
          {
            code: formCode.trim().toUpperCase(),
            title: formTitle.trim(),
            description: formDesc.trim() || null,
            departmentId: formDeptId || null,
          },
          'PATCH',
        );
        setSuccess(`Đã cập nhật chức danh ${formTitle}.`);
      } else {
        await request(`/api/organizations/${orgId}/positions`, {
          code: formCode.trim().toUpperCase(),
          title: formTitle.trim(),
          description: formDesc.trim() || null,
          departmentId: formDeptId || null,
        });
        setSuccess(`Đã tạo chức danh ${formTitle}.`);
      }
      closeModal();
      loadPositions();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (pos: Position) => {
    if (!window.confirm(`Bạn có chắc muốn xóa chức danh "${pos.title}" (${pos.code})?`)) return;
    setError('');
    setSuccess('');
    try {
      await request(`/api/organizations/${orgId}/positions/${pos.id}`, {}, 'DELETE');
      setSuccess(`Đã xóa chức danh "${pos.title}".`);
      loadPositions();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div>
      <div className="org-toolbar">
        <form
          className="org-filters"
          onSubmit={e => {
            e.preventDefault();
            setPage(1);
            loadPositions();
          }}
        >
          <input
            type="search"
            placeholder="Tìm theo mã hoặc tên chức danh…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <select
            value={selectedDeptId}
            onChange={e => {
              setSelectedDeptId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả phòng ban</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
          <button type="submit" className="primary">Tìm kiếm</button>
        </form>

        {canManage && (
          <button type="button" className="primary primary-action" onClick={openCreateModal}>
            + Thêm chức danh mới
          </button>
        )}
      </div>

      <ErrorMessage text={error} onRetry={loadPositions} />
      <SuccessMessage text={success} />

      <div className="table-wrap" aria-busy={loading}>
        <table>
          <caption>{loading ? 'Đang tải…' : error ? 'Danh sách chức danh chưa tải được' : `${total} chức danh`}</caption>
          <thead>
            <tr>
              <th>Mã chức danh</th>
              <th>Tên chức danh</th>
              <th>Phòng ban</th>
              <th>Nhân sự đang giữ</th>
              <th>Trạng thái</th>
              {canManage && <th>Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {positions.map(pos => (
              <tr key={pos.id}>
                <td><span className="org-code-badge">{pos.code}</span></td>
                <td>
                  <strong>{pos.title}</strong>
                  {pos.description && <small>{pos.description}</small>}
                </td>
                <td>{pos.departmentName || 'Chung cho tổ chức'}</td>
                <td><span className="badge">{pos.memberCount}</span></td>
                <td><span className="badge">{pos.isActive ? 'Đang hoạt động' : 'Tạm khóa'}</span></td>
                {canManage && (
                  <td>
                    <div className="org-action-cell">
                      <button className="org-btn-edit secondary" onClick={() => openEditModal(pos)}>Sửa</button>
                      <button
                        className="org-btn-delete secondary"
                        onClick={() => handleDelete(pos)}
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!loading && !error && positions.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5}>Không tìm thấy chức danh nào.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>
          ← Trước
        </button>
        <span>Trang {page} / {Math.max(1, Math.ceil(total / 20))}</span>
        <button disabled={page * 20 >= total || loading} onClick={() => setPage(p => p + 1)}>
          Sau →
        </button>
      </div>

      {modalOpen && (
        <div className="org-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="org-modal-dialog">
            <div className="org-modal-header">
              <h2>{editingPos ? 'Chỉnh sửa chức danh' : 'Thêm chức danh mới'}</h2>
              <button className="secondary" onClick={closeModal}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <ErrorMessage text={error} />
              <label className="field">
                Mã chức danh (DUY NHẤT)
                <input
                  required
                  maxLength={30}
                  value={formCode}
                  onChange={e => setFormCode(e.target.value.toUpperCase())}
                  placeholder="VD: DEV_LEAD, HR_EXEC"
                  disabled={submitting}
                />
              </label>

              <label className="field">
                Tên chức danh
                <input
                  required
                  maxLength={100}
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="VD: Trưởng nhóm phát triển, Chuyên viên tuyển dụng"
                  disabled={submitting}
                />
              </label>

              <label className="field">
                Thuộc phòng ban (tùy chọn)
                <select
                  value={formDeptId}
                  onChange={e => setFormDeptId(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">Toàn công ty / Chưa chỉ định</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                Mô tả vai trò / trách nhiệm
                <textarea
                  maxLength={500}
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  placeholder="Mô tả công việc và trách nhiệm chính…"
                  disabled={submitting}
                  rows={3}
                />
              </label>

              <div className="org-modal-footer">
                <button type="button" className="secondary" onClick={closeModal} disabled={submitting}>
                  Hủy
                </button>
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? 'Đang lưu…' : editingPos ? 'Cập nhật' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4. ORGANIZATION DETAILS PANEL (ORG-001.1)
// ============================================================================
export function OrganizationPanel({ profile }: { profile: Profile }) {
  const [details, setDetails] = useState<OrgDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState(false);

  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const orgId = profile.organization.id;
  const isAdmin = profile.organization.role === 'ADMIN';

  const loadOrg = () => {
    setLoading(true);
    request<{ organization: OrgDetails }>(`/api/organizations/${orgId}`)
      .then(res => {
        setDetails(res.organization);
        setFormName(res.organization.name);
        setFormCode(res.organization.code || '');
        setFormDesc(res.organization.description || '');
      })
      .catch(err => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrg();
  }, [orgId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      await request(
        `/api/organizations/${orgId}`,
        {
          name: formName.trim(),
          code: formCode.trim().toUpperCase() || null,
          description: formDesc.trim() || null,
        },
        'PATCH',
      );
      setSuccess('Đã cập nhật thông tin tổ chức.');
      setEditing(false);
      loadOrg();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p role="status">Đang tải thông tin tổ chức…</p>;

  return (
    <div className="dash-card">
      <div className="dash-card-heading">
        <div>
          <h2>Thông tin tổ chức</h2>
          <p className="muted">Cấu hình định danh và thông tin công ty / đơn vị.</p>
        </div>
        {isAdmin && !editing && (
          <button className="primary" onClick={() => setEditing(true)}>
            Chỉnh sửa
          </button>
        )}
      </div>

      <ErrorMessage text={error} />
      <SuccessMessage text={success} />

      {details && !editing && (
        <dl className="dash-personal-details">
          <div>
            <dt>Tên công ty / tổ chức</dt>
            <dd><strong>{details.name}</strong></dd>
          </div>
          <div>
            <dt>Mã định danh tổ chức</dt>
            <dd>{details.code || '—'}</dd>
          </div>
          <div>
            <dt>Mô tả hoạt động</dt>
            <dd>{details.description || '—'}</dd>
          </div>
          <div>
            <dt>Tổ chức cấp trên</dt>
            <dd>{details.parentOrganization ? `${details.parentOrganization.name} (${details.parentOrganization.code || ''})` : 'Tổ chức độc lập'}</dd>
          </div>
          <div>
            <dt>Trạng thái</dt>
            <dd><span className="badge">{details.isActive ? 'Đang hoạt động' : 'Tạm dừng'}</span></dd>
          </div>
          <div>
            <dt>Ngày thành lập trên hệ thống</dt>
            <dd>{new Date(details.createdAt).toLocaleDateString('vi-VN')}</dd>
          </div>
        </dl>
      )}

      {editing && (
        <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
          <label className="field">
            Tên tổ chức
            <input
              required
              maxLength={100}
              value={formName}
              onChange={e => setFormName(e.target.value)}
              disabled={submitting}
            />
          </label>

          <label className="field">
            Mã tổ chức
            <input
              maxLength={30}
              value={formCode}
              onChange={e => setFormCode(e.target.value.toUpperCase())}
              placeholder="VD: CORP_HQ"
              disabled={submitting}
            />
          </label>

          <label className="field">
            Mô tả
            <textarea
              maxLength={500}
              value={formDesc}
              onChange={e => setFormDesc(e.target.value)}
              disabled={submitting}
              rows={3}
            />
          </label>

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button type="button" className="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              Hủy
            </button>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ============================================================================
// 5. MAIN COMBINED ORG VIEW WITH TABS
// ============================================================================
export function OrganizationView({
  profile,
  activeTab = 'org-chart',
  onNavigate,
}: {
  profile: Profile;
  activeTab?: 'org-chart' | 'departments' | 'positions' | 'organization';
  onNavigate?: (tab: string) => void;
}) {
  const [tab, setTab] = useState(activeTab);

  useEffect(() => {
    setTab(activeTab);
  }, [activeTab]);

  const selectTab = (nextTab: 'org-chart' | 'departments' | 'positions' | 'organization') => {
    setTab(nextTab);
    if (onNavigate) {
      onNavigate(`/admin/${nextTab}`);
    }
  };

  const titles: Record<string, string> = {
    'org-chart': 'Sơ đồ tổ chức',
    departments: 'Quản lý phòng ban',
    positions: 'Quản lý chức danh',
    organization: 'Thông tin tổ chức',
  };

  return (
    <div className="org-view">
      <div className="eyebrow">CƠ CẤU TỔ CHỨC · {profile.organization.name}</div>
      <h1 className="dash-page-title" style={{ position: 'static', width: 'auto', height: 'auto', clipPath: 'none' }}>
        {titles[tab] || 'Cơ cấu tổ chức'}
      </h1>
      <p className="dash-page-subtitle" style={{ position: 'static', width: 'auto', height: 'auto', clipPath: 'none' }}>
        Quản lý hệ thống phòng ban, chức danh, phân cấp quản lý và sơ đồ trực quan.
      </p>

      <div className="org-tabs" role="tablist" aria-label="Điều hướng cơ cấu tổ chức">
        <button
          role="tab"
          type="button"
          className={`org-tab-btn ${tab === 'org-chart' ? 'active' : ''}`}
          aria-selected={tab === 'org-chart'}
          onClick={() => selectTab('org-chart')}
        >
          <span>📊 Sơ đồ tổ chức</span>
        </button>
        <button
          role="tab"
          type="button"
          className={`org-tab-btn ${tab === 'departments' ? 'active' : ''}`}
          aria-selected={tab === 'departments'}
          onClick={() => selectTab('departments')}
        >
          <span>🏢 Phòng ban</span>
        </button>
        <button
          role="tab"
          type="button"
          className={`org-tab-btn ${tab === 'positions' ? 'active' : ''}`}
          aria-selected={tab === 'positions'}
          onClick={() => selectTab('positions')}
        >
          <span>💼 Chức danh</span>
        </button>
        {profile.organization.role === 'ADMIN' && (
          <button
            role="tab"
            type="button"
            className={`org-tab-btn ${tab === 'organization' ? 'active' : ''}`}
            aria-selected={tab === 'organization'}
            onClick={() => selectTab('organization')}
          >
            <span>⚙️ Thông tin tổ chức</span>
          </button>
        )}
      </div>

      {tab === 'org-chart' && <OrgChartView profile={profile} />}
      {tab === 'departments' && <DepartmentsPanel profile={profile} />}
      {tab === 'positions' && <PositionsPanel profile={profile} />}
      {tab === 'organization' && <OrganizationPanel profile={profile} />}
    </div>
  );
}
