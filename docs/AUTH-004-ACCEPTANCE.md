# MANAGERHR — TASK AUTH-004 ACCEPTANCE REPORT

## Authentication Production Readiness & Security Acceptance

- **Audit Date:** 2026-11-19
- **Evaluator:** Senior Software Architect, Security Engineer & QA Lead
- **Status:** **READY**
- **Governance:** V5.3 — Token-Lean Strict (Single-Agent Mode, 0 Delegations)
- **Base Commit:** `0a6504f1c3cdcdb91054dd0b56fdb13d21841111`
- **Environment:** Windows 11, Node.js v20.20.0, Python 3.15.2, PostgreSQL 18.1 (x64) isolated test cluster

---

## 1. Commit và Môi trường Kiểm tra

- **Commit ID:** `0a6504f1c3cdcdb91054dd0b56fdb13d21841111` (với patch kiểm thử `backend/test/auth.test.ts` khắc phục race condition OTP replay).
- **Runtimes & Tools:**
  - Node.js: `v20.20.0`
  - Vitest: `v4.1.12` (backend), `v3.2.4` (frontend)
  - TypeScript: `v6.0.3` (backend), `v5.8.0` (frontend)
  - Python: `3.15.2` (governance test suite)
  - Database: PostgreSQL 18.1 on `127.0.0.1` (fresh ephemeral cluster initialized via `test-migrations.mjs`)
  - Cryptographic Libraries: `@node-rs/argon2` (v2.2.2), Node.js native `crypto` (AES-256-GCM, HMAC-SHA256, SHA-256)

---

## 2. Phạm vi Nghiệm thu (Scope of Acceptance)

Kiểm toán và nghiệm thu toàn diện hệ thống Authentication, RBAC, Session Management, MFA và Audit Log triển khai qua AUTH-001, AUTH-002, và AUTH-003:

1. **AUTH-001 (Core Authentication & Invitations):** Đăng nhập, đăng xuất, luồng lời mời qua HR/Admin, xác minh lời mời, quên mật khẩu và đặt lại mật khẩu.
2. **AUTH-002 (RBAC & User Management):** Quản lý người dùng, phân quyền theo vai trò (ADMIN, HR, MANAGER, EMPLOYEE), cô lập tenant (multi-tenancy), thu hồi phiên tức thì khi đổi quyền, và Audit Log.
3. **AUTH-003 (Session Management, MFA & Hardening):** Vòng đời phiên (idle 30m, absolute 8h), thu hồi phiên lẻ/tất cả, TOTP MFA bắt buộc cho ADMIN/HR, mã phục hồi (backup recovery codes), bước xác thực lại (reauthentication), mã hóa bí mật TOTP (AES-256-GCM), chống brute-force và rate limiting.

---

## 3. Phân loại Baseline (Baseline Verification)

| Hạng mục     | Thành phần                           | Trạng thái   | Bằng chứng kiểm chứng                                                                                                                                         |
| ------------ | ------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AUTH-001** | Đăng nhập & Đăng xuất                | **VERIFIED** | Tests `AUTH-11`, `AUTH-12`, `AUTH-13`. Cookie HttpOnly, xoay vòng session hash, generic error message.                                                        |
| **AUTH-001** | Đăng ký tài khoản qua thư mời        | **VERIFIED** | Tests `AUTH-01`, `AUTH-02`, `AUTH-03`, `AUTH-04`, `AUTH-21`. Không có bootstrap endpoint hay đăng ký công khai; phân cấp ADMIN > HR > EMPLOYEE.               |
| **AUTH-001** | Xác minh lời mời                     | **VERIFIED** | Tests `AUTH-05`, `AUTH-06`, `AUTH-07`, `AUTH-08`, `AUTH-09`. Chống replay token, khóa transaction chặn race condition accept.                                 |
| **AUTH-001** | Quên mật khẩu & Đặt lại mật khẩu     | **VERIFIED** | Tests `AUTH-14`, `AUTH-15`, `AUTH-16`, `AUTH-17`, `AUTH-22`. Không leak user tồn tại, token hash 30m, thu hồi toàn bộ session khi đổi pass, không auto-login. |
| **AUTH-002** | Quản lý người dùng                   | **VERIFIED** | Tests `RBAC-03`, `RBAC-05`, `RBAC-06`. Admin tìm kiếm/lọc, HR chỉ xem Employee, Manager chỉ xem cấp dưới trực tiếp.                                           |
| **AUTH-002** | RBAC & Authorization                 | **VERIFIED** | Tests `RBAC-01`, `RBAC-04`, `RBAC-13`. Chặn leo thang quyền, HR không cấp được Admin/HR, thẩm định hai lớp tại DB qua `authorizeMutation`.                    |
| **AUTH-002** | Cô lập Tenant (Tenant Isolation)     | **VERIFIED** | Tests `AUTH-04`, `RBAC-07`, `RBAC-10`. Mọi mutation và query đều ràng buộc `organization_id`, kiểm tra chéo tenant bị từ chối 403/404.                        |
| **AUTH-002** | Thu hồi quyền & Khóa tài khoản       | **VERIFIED** | Tests `RBAC-08`, `RBAC-09`, `RBAC-11`, `RBAC-12`, `RBAC-14`, `RBAC-16`. Khóa user hoặc hạ role lập tức vô hiệu hóa phiên; bảo vệ Last Admin.                  |
| **AUTH-002** | Audit Log                            | **VERIFIED** | Test `RBAC-15`. Ghi nhận sự kiện mutation, phân quyền chỉ Admin được đọc, không lưu secret/password vào metadata.                                             |
| **AUTH-003** | Quản lý phiên (Session Management)   | **VERIFIED** | Tests `HARD-01`, `HARD-02`. Lưu session_hash (SHA-256), danh sách phiên người dùng, thu hồi phiên riêng lẻ hoặc all-others.                                   |
| **AUTH-003** | Hết hạn phiên (Timeout & Revocation) | **VERIFIED** | Test `HARD-01`. Idle timeout 30 phút, absolute timeout 8 giờ, pending session chỉ sống 5 phút nếu chưa verify MFA.                                            |
| **AUTH-003** | Bảo vệ Brute-force & Rate Limiting   | **VERIFIED** | Tests `AUTH-12`, `HARD-10`. Bảng `auth_rate_limits`, gắn IP thực tế từ socket (bỏ qua `X-Forwarded-For` giả mạo), giới hạn theo tài khoản/token.              |
| **AUTH-003** | MFA / TOTP & Recovery Codes          | **VERIFIED** | Tests `HARD-03` đến `HARD-18`. TOTP RFC 6238, mã hóa khóa AES-256-GCM với AAD, 10 mã recovery lưu dạng hash một lần dùng, chống replay.                       |
| **AUTH-003** | Security Hardening                   | **VERIFIED** | Helmet CSP `default-src 'self'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, HMAC double-submit CSRF cookie.                                   |

---

## 4. Kết quả Kiểm thử Tự động (Automated Testing Results)

### 4.1. Backend Test Suite (Vitest)

- **Tập tin kiểm thử:** `backend/test/auth.test.ts` (58 tests), `backend/test/security.test.ts` (4 tests)
- **Kết quả:** **62/62 PASS (100%)**, 0 fail
- **Thời lượng:** ~51s
- **Code Coverage (V8):**
  - **Statements:** 92.44%
  - **Branches:** 83.50%
  - **Functions:** 98.18%
  - **Lines:** 97.73%
  - Module `security.ts`: 100% Lines / 100% Branch
  - Module `mfa-crypto.ts`: 100% Lines / 80.00% Branch
  - Module `session-security.ts`: 100% Lines / 84.50% Branch
  - Module `users.ts`: 99.24% Lines / 88.11% Branch
  - Module `app.ts`: 98.61% Lines / 84.61% Branch

### 4.2. Frontend Test Suite (Vitest)

- **Tập tin kiểm thử:** 6 suites (`useSlideClose.test.tsx`, `DashboardShell.test.tsx`, `Dashboard.test.tsx`, `AccountSecurity.test.tsx`, `Users.test.tsx`, `App.test.tsx`)
- **Kết quả:** **66/66 PASS (100%)**, 0 fail
- **Build & Bundle:** TypeScript (`tsc --noEmit`) không lỗi; Vite build production thành công (`dist/index.html`, CSS, JS bundled).

### 4.3. Database Migration Testing

- **Kịch bản:** `database/test-migrations.mjs` trên cụm PostgreSQL 18.1 độc lập.
- **Kết quả:**
  - `001_auth_invitation_schema.sql`: PASS
  - `002_auth_controls.sql`: PASS
  - Nâng cấp dữ liệu tồn tại từ AUTH-001 lên AUTH-002: PASS (`upgrade-before.sql` -> `003_rbac_user_management.sql` -> `upgrade-after.sql`)
  - `003_rbac_user_management.sql`: PASS
  - `004_session_mfa.sql`: PASS
  - Ràng buộc toàn vẹn và Rollback verification (`verify.sql`): PASS

### 4.4. Governance & Policy Checks

- `python -m unittest discover -s tests`: **21/21 tests PASS**
- `scripts/check_token_lean.py`: PASS (Governance V5.3)
- `scripts/check_model_policy.py`: PASS (7 agents, inherit profile)
- `scripts/check_skill_policy.py`: PASS (8 approved skills, 17 official references)
- `scripts/policy_check.py`: PASS (với declared scopes hợp lệ)

---

## 5. Đánh giá An ninh (Security Acceptance Matrix)

Tham chiếu các chuẩn: **OWASP ASVS 5.0.0**, **OWASP Authentication / Session / Authorization Cheat Sheets**, **NIST SP 800-63B-4**.

| #   | Nhóm rủi ro                           | Trạng thái     | Đánh giá & Cơ chế kiểm soát kỹ thuật                                                                                                                                                                                                              |
| --- | ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Authentication Bypass**             | **ĐẠT (PASS)** | Bắt buộc xác thực với email đã verified; mật khẩu băm Argon2id (64MB memory, 3 iterations); dummy hash chống timing attack; MFA bắt buộc cho ADMIN/HR tại API middleware và trong từng mutation transaction.                                      |
| 2   | **Privilege Escalation**              | **ĐẠT (PASS)** | Chặn tự nâng quyền (`SELF_CHANGE_FORBIDDEN`); HR không thể gán quyền Admin hay thay đổi user có đặc quyền; Manager bị chặn chặt chẽ chỉ thao tác trong scope cấp dưới.                                                                            |
| 3   | **IDOR / BOLA**                       | **ĐẠT (PASS)** | Ràng buộc kép ID người dùng và ID tổ chức trong token session; không dùng ID từ client để truy vấn chéo; chặn đổi session của user khác.                                                                                                          |
| 4   | **Cross-Tenant Access**               | **ĐẠT (PASS)** | Mọi truy vấn DB bắt buộc mệnh đề `organization_id = $x`; khóa advisory locks phạm vi tổ chức; kiểm tra chéo tổ chức trả về 403 hoặc 404 (không rò rỉ ID tồn tại).                                                                                 |
| 5   | **Session Fixation & Hijacking**      | **ĐẠT (PASS)** | Token phiên ngẫu nhiên CSPRNG 256-bit (`randomBytes(32)`), chỉ lưu SHA-256 hash tại database; bắt buộc xoay vòng session ID (rotate) khi đăng nhập, đặt lại mật khẩu, xác thực MFA, phục hồi và re-auth.                                          |
| 6   | **Session Timeout & Revocation**      | **ĐẠT (PASS)** | Idle timeout 30 phút cập nhật theo `last_seen_at`; Absolute timeout 8 giờ; Pending MFA session giới hạn 5 phút; Thu hồi lập tức khi đổi quyền/khóa tài khoản/đổi mật khẩu.                                                                        |
| 7   | **Password Reset Token Reuse**        | **ĐẠT (PASS)** | Token reset lưu dạng hash, hạn dùng 30 phút, đánh dấu `consumed_at` nguyên tử trong transaction; thu hồi toàn bộ phiên đăng nhập cũ; không tự động login sau reset.                                                                               |
| 8   | **Invitation Token Reuse**            | **ĐẠT (PASS)** | Token lưu hash, hạn dùng 48h, chỉ sử dụng 1 lần (`consumed_at = now()`); xử lý đồng thời (concurrency) được bảo vệ bằng `pg_advisory_xact_lock`.                                                                                                  |
| 9   | **MFA Bypass & Replay**               | **ĐẠT (PASS)** | Khóa bí mật TOTP mã hóa bằng AES-256-GCM với AAD (User ID); lưu trữ `last_counter` để từ chối OTP replay trong cùng cửa sổ thời gian; 10 mã recovery hash một lần dùng; yêu cầu re-authentication trong vòng 10 phút trước các thao tác nhạy cảm. |
| 10  | **Brute-Force & Rate-Limit Bypass**   | **ĐẠT (PASS)** | Rate limit qua DB bảng `auth_rate_limits`, gắn chặt theo Socket IP thực tế (bỏ qua header `X-Forwarded-For` chống spoofing); đa khóa (IP, email, token); không khóa tài khoản vĩnh viễn (tránh DoS).                                              |
| 11  | **CSRF, XSS & SQL Injection**         | **ĐẠT (PASS)** | CSRF token ký HMAC kép (cookie + header + Origin header check); Helmet bảo vệ CSP `default-src 'self'`; 100% câu lệnh SQL tham số hóa (`$1, $2,...`) kết hợp Zod input validation và `escapeLike`.                                                |
| 12  | **Cookie Security & Secret Exposure** | **ĐẠT (PASS)** | Cookie `HttpOnly`, `SameSite=Lax`, cờ `Secure` bật ở production kèm prefix `__Host-`; Header `Cache-Control: no-store`; Lỗi hệ thống trả về mã generic; Audit log không ghi mật khẩu/token/OTP.                                                   |
| 13  | **Audit Log Integrity & Access**      | **ĐẠT (PASS)** | Ghi nhận tập trung bảng `auth_audit_events`; Phân quyền chỉ vai trò `ADMIN` trong cùng tenant mới có quyền truy cập; Ràng buộc không lưu thông tin nhạy cảm.                                                                                      |

---

## 6. Các Lỗi đã Khắc phục (Defect Remediation)

- **Mã lỗi:** `DEFECT-AUTH-004-01` (Test Flake / OTP Replay Timing Race Condition).
- **Phân loại:** Medium (Kiểm thử tự động & Xác minh).
- **Hiện tượng:** Trong `test/auth.test.ts`, kiểm thử `HARD-05 OTP replay across logins is rejected` đôi khi nhận mã `204` thay vì `401`.
- **Nguyên nhân gốc:** Hàm kiểm thử gọi `currentCode(enrolled.secret)` để kiểm tra replay. Khi thời gian thực tế chạy kiểm thử rơi vào điểm giao thoa giữa 2 chu kỳ 30 giây của TOTP, mã OTP được sinh mới thay vì tái sử dụng mã cũ đã xác thực ở bước `enroll`. Do đó, server coi đó là mã hợp lệ của chu kỳ tiếp theo và chấp nhận (204).
- **Khắc phục:** Sửa hàm `enroll()` lưu lại chính xác chuỗi mã OTP đã dùng (`usedCode`) và truyền `enrolled.usedCode` vào lệnh gọi xác minh replay của session thứ hai. Điều này bảo đảm kiểm thử luôn kiểm tra việc tái sử dụng chính xác token đã tiêu thụ, loại bỏ hoàn toàn race condition phụ thuộc vào thời gian chạy.
- **File sửa:** `backend/test/auth.test.ts`.
- **Kiểm chứng:** Re-run 62/62 tests PASS ổn định 100%.

---

## 7. Các Rủi ro còn Tồn tại (Residual Risks)

1. **TOTP Phishing Resistance:** Phương thức TOTP (RFC 6238) không có khả năng chống tấn công Man-in-the-Middle thời gian thực (phishing). Khuyến nghị nâng cấp bổ sung FIDO2/WebAuthn Passkeys trong các giai đoạn phát triển tiếp theo khi có yêu cầu mức bảo đảm AAL3.
2. **Quản lý Khóa Mã hóa MFA (`MFA_ENCRYPTION_KEY`):** Hiện tại khóa mã hóa AES-256-GCM 32 bytes được nạp qua biến môi trường. Khi triển khai production, cần được lưu trữ và luân chuyển (key rotation) bằng các giải pháp KMS/Vault chuyên dụng (e.g., AWS KMS, HashiCorp Vault).
3. **Cơ chế Gửi Thư Phục hồi:** Hệ thống hiện tại đang sử dụng chế độ gửi mail nội bộ/ephemeral queue (DEV_ONLY / mock / nodemailer). Khi lên production, cần kết nối nhà cung cấp SMTP/SES có uy tín và cấu hình SPF/DKIM/DMARC chặt chẽ để đảm bảo email reset và invitation không bị đưa vào thư rác.

---

## 8. Các Hạng mục Chưa Xác minh Ngoài Môi trường Hiện tại (Unverified in Sandbox)

- **Static Application Security Testing (SAST):** Semgrep và SonarQube chưa được cài đặt trong môi trường máy trạm nội bộ; kiểm tra an ninh hiện dựa trên code audit thủ công, type-system và comprehensive test matrix. Cần kích hoạt pipeline SAST trên GitHub Actions CI trước khi merge vào nhánh chính.
- **Active Scanning / Penetration Testing:** Chưa thực hiện quét DAST chủ động (OWASP ZAP) trên môi trường mạng staging/production (tuân thủ quy tắc không quét trái phép).

---

## 9. Kết luận Nghiệm thu (Final Acceptance Conclusion)

### **KẾT LUẬN: READY**

Hệ thống Authentication của ManagerHR đã hoàn thiện đầy đủ các tiêu chí thiết kế của AUTH-001, AUTH-002 và AUTH-003. Toàn bộ 13 tiêu chí an ninh theo chuẩn OWASP/NIST đều được kiểm soát bằng cơ chế phòng thủ chuyên sâu (defense-in-depth), kiểm thử tự động đạt 100% (62 backend tests, 66 frontend tests, 21 governance tests), migration cơ sở dữ liệu an toàn và không có lỗi nghiêm trọng chưa được xử lý.

Hệ thống **SẴN SÀNG** cho việc tích hợp các phân hệ quản lý nhân sự tiếp theo.
