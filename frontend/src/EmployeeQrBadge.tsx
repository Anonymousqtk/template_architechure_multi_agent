import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { createQrMatrix, generateQrSvgPath } from './qrcode';

type Props = {
  employee: {
    employeeCode: string;
    fullName: string;
    departmentName?: string | null;
    positionTitle?: string | null;
  };
  orgId: string;
  orgName?: string;
  className?: string;
};

export function EmployeeQrBadge({ employee, orgId, orgName, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const cardFragment = `org=${encodeURIComponent(orgId)}&code=${encodeURIComponent(employee.employeeCode)}`;
  const cardUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/employee-card#${cardFragment}`
    : `/employee-card#${cardFragment}`;

  let matrix: boolean[][] = [];
  let svgPath = '';
  let matrixSize = 0;
  let qrError = '';
  try {
    matrix = createQrMatrix(cardUrl, 'M');
    matrixSize = matrix.length;
    svgPath = generateQrSvgPath(matrix);
  } catch {
    try {
      matrix = createQrMatrix(cardUrl, 'L');
      matrixSize = matrix.length;
      svgPath = generateQrSvgPath(matrix);
    } catch {
      qrError = 'Địa chỉ quá dài để tạo mã QR.';
    }
  }

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    closeRef.current?.focus();

    return () => {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  function changeZoom(amount: number) {
    setZoom(current => Math.min(2.5, Math.max(0.6, Math.round((current + amount) * 100) / 100)));
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(cardUrl);
      setCopied(true);
      setCopyError('');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setCopyError('Không thể sao chép URL. Hãy sao chép trực tiếp từ đường dẫn bên dưới.');
    }
  }

  function handleDownloadSvg() {
    if (!svgPath) return;
    const totalSize = matrixSize + 8;
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="#ffffff" />
      <path d="${svgPath}" fill="#1e1e2d" />
    </svg>`;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QR_${employee.employeeCode}_${employee.fullName.replace(/\s+/g, '_')}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const modal = open
    ? createPortal(
        <dialog
          ref={dialogRef}
          className="avatar-viewer-dialog qr-viewer-dialog"
          aria-modal="true"
          aria-label={`Mã QR thẻ nhân viên của ${employee.fullName}`}
          onCancel={event => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }}
          onClick={event => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <header className="avatar-viewer-header">
            <div className="qr-viewer-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <strong>Mã QR thẻ nhân viên</strong>
            </div>
            <button ref={closeRef} type="button" aria-label="Đóng" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>

          <div className="avatar-viewer-controls" aria-label="Điều khiển thu phóng">
            <button type="button" aria-label="Thu nhỏ" disabled={zoom <= 0.6} onClick={() => changeZoom(-0.2)}>
              −
            </button>
            <output aria-live="polite">{Math.round(zoom * 100)}%</output>
            <button type="button" aria-label="Phóng to" disabled={zoom >= 2.5} onClick={() => changeZoom(0.2)}>
              +
            </button>
            <button type="button" aria-label="Kích thước ban đầu" onClick={() => setZoom(1)}>
              100%
            </button>
            <button type="button" className="qr-action-btn" onClick={handleCopy} aria-label="Sao chép URL">
              {copied ? '✓ Đã sao chép' : 'Sao chép link'}
            </button>
            <button type="button" className="qr-action-btn" onClick={handleDownloadSvg} aria-label="Tải mã QR SVG">
              Tải ảnh QR
            </button>
          </div>

          <div className="avatar-viewer-stage qr-viewer-stage">
            <div className="qr-card-container" style={{ transform: `scale(${zoom})` }}>
              <div className="qr-card-badge">
                <div className="qr-card-org">
                  <span className="qr-org-dot" />
                  <strong>{orgName || 'ManagerHR Verified'}</strong>
                </div>

                <div className="qr-code-box">
                  {svgPath ? (
                    <svg
                      viewBox={`0 0 ${matrixSize + 8} ${matrixSize + 8}`}
                      shapeRendering="crispEdges"
                      className="qr-code-svg"
                      role="img"
                      aria-label={`Mã QR truy cập hồ sơ ${employee.fullName}`}
                    >
                      <rect width="100%" height="100%" fill="#ffffff" rx="1" />
                      <path d={svgPath} fill="#1a1926" />
                    </svg>
                  ) : (
                    <p className="qr-link-state">{qrError}</p>
                  )}
                </div>

                <div className="qr-card-info">
                  <div className="qr-card-name">
                    <strong>{employee.fullName}</strong>
                  </div>
                  <div className="qr-card-meta">
                    <span className="qr-emp-code">{employee.employeeCode}</span>
                    {employee.positionTitle && <span className="qr-emp-pos">{employee.positionTitle}</span>}
                  </div>
                  {employee.departmentName && (
                    <div className="qr-card-dept">{employee.departmentName}</div>
                  )}
                </div>

                <div className="qr-card-footer">
                  <p className="qr-card-tip">
                    <span>Quét mã để kiểm tra URL; thông tin nhân viên không hiển thị</span>
                  </p>
                  <a
                    href={cardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="qr-link-preview"
                    onClick={e => e.stopPropagation()}
                  >
                    Mở URL xem trước ↗
                  </a>
                </div>
              </div>
            </div>
          </div>
          <div className="qr-link-management">
            {copyError && <p role="alert">{copyError}</p>}
            <code className="qr-link-url">{cardUrl}</code>
            <p className="qr-link-preview-warning">
              URL chỉ để kiểm tra mã QR; thẻ công khai chưa được bật nên thông tin nhân viên không hiển thị.
            </p>
            {typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) && (
              <p className="qr-local-origin-warning">
                Địa chỉ localhost chỉ dùng trên thiết bị này. Để quét bằng điện thoại, hãy mở ứng dụng qua tên miền HTTPS hoặc địa chỉ mạng mà điện thoại có thể truy cập được.
              </p>
            )}
          </div>
        </dialog>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`emp-qr-trigger ${className}`}
        aria-label={`Xem mã QR thẻ nhân viên của ${employee.fullName}`}
        title="Xem mã QR &amp; danh thiếp nhân viên"
        onClick={() => {
          setZoom(1);
          setCopyError('');
          setOpen(true);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="emp-qr-icon"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="15" width="6" height="6" rx="1" />
          <path d="M15 15h2v2h-2z" />
          <path d="M19 15h2v6h-6v-2h4v-4z" />
          <path d="M15 19h2v2h-2z" />
        </svg>
        <span className="emp-qr-label">QR</span>
      </button>
      {modal}
    </>
  );
}
