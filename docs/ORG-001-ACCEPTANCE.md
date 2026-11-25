# BÁO CÁO NGHIỆM THU — TASK ORG-001

## Organization Structure, Departments, Positions & Hierarchy

### ManagerHR Platform · Agent Governance V5.3 (Token-Lean Strict)

---

## I. TỔNG QUAN & MỤC TIÊU NGHIỆM THU

Module **ORG-001** mở rộng kiến trúc ManagerHR từ nền tảng Authentication & RBAC (AUTH-001 đến AUTH-004) thành hệ thống quản lý cơ cấu tổ chức doanh nghiệp hoàn chỉnh. Module đảm bảo tính toàn vẹn dữ liệu đa chi nhánh/phòng ban, ngăn chặn triệt để phân cấp và quan hệ quản lý vòng lặp, bảo vệ dữ liệu phụ thuộc và cung cấp giao diện trực quan cho sơ đồ tổ chức.

---

## II. TRẠNG THÁI CÁC HẠNG MỤC CHỨC NĂNG (ORG-001.1 — ORG-001.5)

| Mã hạng mục   | Tên chức năng               |  Trạng thái  | Bằng chứng kiểm thử & triển khai                                                                                                                                                                                                                                                                  |
| :------------ | :-------------------------- | :----------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ORG-001.1** | **Organization Management** | **VERIFIED** | Quản lý thông tin tổ chức (`code`, `name`, `description`, `parentOrganizationId`). Chỉ `ADMIN` có quyền cập nhật cấu hình. Cách ly 100% tenant. Test `ORG-01` PASS.                                                                                                                               |
| **ORG-001.2** | **Department Management**   | **VERIFIED** | CRUD phòng ban theo phân cấp cây, tìm kiếm, phân trang. Mã duy nhất theo tenant (`(organization_id, code)`). Thuật toán `detectDepartmentCycle()` ngăn vòng lặp đệ quy. Chặn xóa cứng khi có con, nhân viên hoặc chức danh liên kết. Tests `ORG-02`, `ORG-03`, `ORG-04`, `ORG-05`, `ORG-06` PASS. |
| **ORG-001.3** | **Position Management**     | **VERIFIED** | CRUD chức danh, liên kết phòng ban tùy chọn. Mã duy nhất theo tenant (`(organization_id, code)`). Tách biệt hoàn toàn giữa chức danh nghề nghiệp và RBAC Role. Chặn xóa khi có nhân viên giữ chức danh. Test `ORG-07` PASS.                                                                       |
| **ORG-001.4** | **Reporting Structure**     | **VERIFIED** | Thiết lập quan hệ quản lý trực tiếp và phân cấp báo cáo. Thuật toán `detectReportingCycle()` ngăn chặn vòng lặp báo cáo ở mọi độ sâu. Xác thực người quản lý thuộc cùng tenant. Test `ORG-09` PASS.                                                                                               |
| **ORG-001.5** | **Organization Chart**      | **VERIFIED** | API `/api/organizations/:orgId/org-chart` tạo cấu trúc cây phân cấp tự động, tổng hợp nhân sự và chức danh. Giao diện frontend tương tác (`OrgChartView`) hỗ trợ đóng/mở nhánh cây, tối ưu desktop/mobile. Test `ORG-10` & Frontend Unit Tests PASS.                                              |

---

## III. THAY ĐỔI SCHEMA & MIGRATIONS DATABASE

Tạo migration mới: `database/migrations/005_org_structure.sql`:

1. **Bảng `organizations`**:
   - Thêm cột `code VARCHAR(30)`, `parent_organization_id UUID REFERENCES organizations(id)`, `description TEXT`.
   - Tạo chỉ mục duy nhất không phân biệt hoa thường: `idx_organizations_code_unique ON organizations(lower(btrim(code)))`.
2. **Bảng `departments`**:
   - Khóa chính `id UUID`, `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`.
   - `parent_id UUID REFERENCES departments(id) ON DELETE RESTRICT`.
   - `code VARCHAR(30) NOT NULL`, `name VARCHAR(100) NOT NULL`, `description TEXT`.
   - `manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL`.
   - Ràng buộc: `UNIQUE (organization_id, code)`, `CHECK (parent_id <> id)`.
   - Performance Indexes: `idx_departments_org_parent`, `idx_departments_org_code`, `idx_departments_manager`.
3. **Bảng `positions`**:
   - Khóa chính `id UUID`, `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`.
   - `department_id UUID REFERENCES departments(id) ON DELETE RESTRICT`.
   - `code VARCHAR(30) NOT NULL`, `title VARCHAR(100) NOT NULL`, `description TEXT`.
   - Ràng buộc: `UNIQUE (organization_id, code)`.
   - Performance Indexes: `idx_positions_org_code`, `idx_positions_org_dept`.
4. **Bảng `memberships`**:
   - Thêm cột `department_id UUID REFERENCES departments(id) ON DELETE RESTRICT`.
   - Thêm cột `position_id UUID REFERENCES positions(id) ON DELETE RESTRICT`.
   - Indexes: `idx_memberships_department`, `idx_memberships_position`.

**Kiểm tra tính an toàn Migration:**

- Đã chạy qua `database/test-migrations.mjs` trên cụm PostgreSQL độc lập:
  - `PASS migration 001_auth_invitation_schema.sql`
  - `PASS migration 002_auth_controls.sql`
  - `PASS existing AUTH-001 data preserved during RBAC upgrade`
  - `PASS migration 003_rbac_user_management.sql`
  - `PASS migration 004_session_mfa.sql`
  - `PASS migration 005_org_structure.sql`
  - `PASS PostgreSQL migration constraints and rollback verification`

---

## IV. MA TRẬN PHÂN QUYỀN TRUY CẬP (ACCESS CONTROL MATRIX)

| Hành động                 | Endpoint                            |    ADMIN    |       HR        |   MANAGER   |  EMPLOYEE   |
| :------------------------ | :---------------------------------- | :---------: | :-------------: | :---------: | :---------: |
| Xem thông tin tổ chức     | `GET /api/organizations/:orgId`     | ✅ Cho phép |   ✅ Cho phép   | ✅ Cho phép | ✅ Cho phép |
| Cập nhật cấu hình tổ chức | `PATCH /api/organizations/:orgId`   | ✅ Cho phép |     ❌ 403      |   ❌ 403    |   ❌ 403    |
| Xem danh sách phòng ban   | `GET .../departments`               | ✅ Toàn bộ  |   ✅ Toàn bộ    | ✅ Toàn bộ  | ✅ Toàn bộ  |
| Thêm/Sửa/Xóa phòng ban    | `POST/PATCH/DELETE .../departments` | ✅ Cho phép |   ✅ Cho phép   |   ❌ 403    |   ❌ 403    |
| Xem danh sách chức danh   | `GET .../positions`                 | ✅ Toàn bộ  |   ✅ Toàn bộ    | ✅ Toàn bộ  | ✅ Toàn bộ  |
| Thêm/Sửa/Xóa chức danh    | `POST/PATCH/DELETE .../positions`   | ✅ Cho phép |   ✅ Cho phép   |   ❌ 403    |   ❌ 403    |
| Gán phòng ban & chức danh | `POST .../users/:userId/assignment` | ✅ Toàn bộ  | ✅ Cho Employee |   ❌ 403    |   ❌ 403    |
| Phân công người quản lý   | `POST .../users/:userId/manager`    | ✅ Cho phép |     ❌ 403      |   ❌ 403    |   ❌ 403    |
| Xem sơ đồ tổ chức         | `GET .../org-chart`                 | ✅ Toàn cây |   ✅ Toàn cây   | ✅ Toàn cây | ✅ Toàn cây |

---

## V. KIỂM TOÁN AN TOÀN & BẢO MẬT (OWASP ASVS & DEFENSE-IN-DEPTH)

1. **Tenant Isolation (IDOR/BOLA Prevention):**
   - Mọi câu lệnh SQL truy vấn và cập nhật đều ràng buộc tường minh `WHERE organization_id = $1`.
   - Kiểm tra mã trùng lặp, phòng ban cha và người quản lý đều bị giới hạn nghiêm ngặt trong cùng tổ chức.
   - Thử nghiệm IDOR (`ORG-08`) chứng minh tài khoản Tenant B bị chặn 404/403 khi truy vấn ID thuộc Tenant A.
2. **Chống lặp vòng (Anti-Cycle Detection):**
   - Thuật toán `detectDepartmentCycle()` duyệt ngược chuỗi đơn vị cha (tối đa 100 cấp) để phát hiện và từ chối `400 CIRCULAR_HIERARCHY`.
   - Thuật toán `detectReportingCycle()` duyệt ngược chuỗi báo cáo để phát hiện và từ chối `400 CIRCULAR_REPORTING`.
3. **Bảo vệ tính toàn vẹn dữ liệu (Dependency Protection):**
   - Từ chối xóa phòng ban khi có đơn vị con (`409 DEPARTMENT_IN_USE_HAS_CHILDREN`).
   - Từ chối xóa phòng ban khi có nhân sự trực thuộc (`409 DEPARTMENT_IN_USE_HAS_MEMBERS`).
   - Từ chối xóa phòng ban khi có chức danh liên kết (`409 DEPARTMENT_IN_USE_HAS_POSITIONS`).
   - Từ chối xóa chức danh khi đang được gán cho nhân sự (`409 POSITION_IN_USE_HAS_MEMBERS`).
4. **Audit Logging:**
   - Mọi thay đổi đều được ghi log bất biến vào `auth_audit_events`: `ORGANIZATION_UPDATED`, `DEPARTMENT_CREATED`, `DEPARTMENT_UPDATED`, `DEPARTMENT_DELETED`, `POSITION_CREATED`, `POSITION_UPDATED`, `POSITION_DELETED`, `USER_ASSIGNMENT_CHANGED`.
   - `subject_user_id` chỉ liên kết tới bảng `users(id)`; ID thực thể tổ chức được đặt trong trường `metadata`.

---

## VI. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG

### 1. Backend Integration Tests (Vitest + PostgreSQL 18 Cluster)

- **Tổng số test:** 73/73 tests **PASS** (100%).
- **Thời gian chạy:** 58.61s.
- **Độ bao phủ code (Coverage):** Lines: 93.11%, Statements: 87.85%, Functions: 97.14%.
  - `test/org.test.ts`: 11/11 PASS (ORG-01 đến ORG-11).
  - `test/auth.test.ts`: 58/58 PASS (AUTH-01..AUTH-22, RBAC-01..RBAC-16, HARD-01..HARD-18).
  - `test/security.test.ts`: 4/4 PASS (Argon2id hashing & crypto vectors).

### 2. Frontend Unit & Integration Tests (Vitest + React Testing Library)

- **Tổng số test:** 72/72 tests **PASS** (100%).
- **Thời gian chạy:** 9.26s.
  - `src/OrganizationView.test.tsx`: 5/5 PASS.
  - `src/App.test.tsx`: 22/22 PASS.
  - `src/Users.test.tsx`: 16/16 PASS.
  - `src/AccountSecurity.test.tsx`: 13/13 PASS.
  - `src/Dashboard.test.tsx`: 5/5 PASS.
  - `src/DashboardShell.test.tsx`: 7/7 PASS.
  - `src/useSlideClose.test.tsx`: 4/4 PASS.

---

## VII. CÁC VẤN ĐỀ ĐÃ XÁC MINH VÀ KHẮC PHỤC

1. **Khóa ngoại `auth_audit_events.subject_user_id`:** Ghi nhận lỗi 500 do truyền departmentId/positionId vào cột khóa ngoại liên kết `users`. Đã chuyển các ID này vào `metadata` JSON và đặt `subject_user_id = undefined`.
2. **Khả năng báo cáo của Manager:** Logic cũ giới hạn chỉ Employee mới có thể phân công quản lý. Đã cập nhật cho phép Manager báo cáo cho Manager cấp trên theo cấu trúc phân cấp công ty.
3. **Cơ chế xác thực CSRF trên HTTP DELETE:** Các request DELETE không body làm mất header `Content-Type: application/json`. Đã đồng bộ hóa client helper gửi body rỗng `{}` để CSRF middleware luôn kiểm tra hợp lệ.
4. **Đồng bộ hóa Focus trên React 19 Notice:** Chuyển `useEffect` sang `useLayoutEffect` để đảm bảo thông báo lỗi được focus đồng bộ trước khi kiểm thử DOM hoàn tất.

---

## VIII. RỦI RO CÒN LẠI & KHUYẾN NGHỊ VẬN HÀNH

1. **Cấu trúc phòng ban quy mô cực lớn:** Với tổ chức > 1,000 phòng ban, cây tổ chức nên được lazy-load theo từng nhánh cấp 1 thay vì nạp toàn bộ một lần.
2. **Lịch sử chức danh (Position History):** Phiên bản hiện tại lưu chức danh hiện tại của nhân sự. Khi phát triển module EMPLOYEE-001 / HR-001, cần bổ sung bảng ghi nhận lịch sử điều chuyển, bổ nhiệm.

---

## IX. KẾT LUẬN & SẴN SÀNG CHO MODULE TIẾP THEO

Toàn bộ tiêu chí của **ORG-001** đã được hoàn thành, nghiệm thu bảo mật và kiểm thử tự động đạt 100%. Hệ thống sẵn sàng làm nền móng vững chắc để phát triển module tiếp theo: **EMPLOYEE-001** (Hồ sơ nhân viên chi tiết & Onboarding) hoặc **LEAVE-001** (Quản lý nghỉ phép & phê duyệt theo cấp quản lý).
