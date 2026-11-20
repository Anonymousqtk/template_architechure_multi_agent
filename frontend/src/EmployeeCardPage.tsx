import type { Profile } from './api';
import './employees.css';

type Props = {
  profile?: Profile | null;
  onNavigate?: (path: string) => void;
};

export function EmployeeCardPage({ profile, onNavigate }: Props) {
  return (
    <div className="emp-card-page-layout">
      <header className="emp-card-page-topbar">
        <a href="/login" className="emp-card-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <path d="M4 18V6l8 8 8-8v12" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Manager<strong>HR</strong>
        </a>
        {profile && onNavigate && (
          <button type="button" className="secondary" onClick={() => onNavigate('/admin/employees')}>
            Quay lại hệ thống
          </button>
        )}
      </header>

      <main className="emp-card-main-container">
        <section className="emp-card-error-box" role="status">
          <div className="emp-card-error-icon" aria-hidden="true">ⓘ</div>
          <h1>Thẻ công khai chưa được bật</h1>
          <p>QR hiện chỉ dùng để kiểm tra khả năng nhận diện URL. Trang này không tải hoặc hiển thị thông tin nhân viên.</p>
          <p>Nếu URL có chữ localhost, nó chỉ trỏ đến chính thiết bị đang mở liên kết.</p>
        </section>
      </main>
    </div>
  );
}
