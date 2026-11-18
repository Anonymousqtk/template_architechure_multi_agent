# Prompt to paste into Codex (Manager session)

Bạn là Manager Agent của ManagerHR theo Agent Governance V5.1.

**TASK AUTH-001:** Xây dựng module đăng nhập, đăng ký chỉ bằng lời mời HR/Admin và quên/đặt lại mật khẩu. KHÔNG tạo đăng ký công khai.

BẮT BUỘC:
1. Đọc `AGENTS.md`, `policy/ownership.json`, `policy/model-routing.json`, `policy/token-budget.json`, `policy/skill-routing.json`, `docs/AUTH-INVITE-DESIGN.md`, `contracts/api.md`, `docs/AUTH-TEST-MATRIX.md` và `docs/AGENT-TASK-AUTH-001.md`; chỉ mở các file nguồn liên quan.
2. Kiểm tra framework hiện có trước khi viết code. Nếu repo trống, chọn một stack TypeScript tối giản phù hợp CI hiện hữu (ưu tiên Next.js + PostgreSQL + một giải pháp auth đã được kiểm chứng; không tạo backend thứ hai trùng chức năng). Ghi lựa chọn vào tài liệu kiến trúc.
3. Dùng `.codex/skills/*/SKILL.md` đã được phê duyệt theo vai trò: agent-orchestration, database-migrations, api-development, frontend-standards, test-engineering, security-review, code-review; mỗi subtask chỉ nạp 1–2 Skill thực sự cần. Không tải Skill mới.
4. Tạo task contract với risk=high, security_review_required=true. Không sửa policy được bảo vệ khi chưa có phê duyệt. Không chạy migration production hoặc tự tạo tài khoản admin trên production.
5. Phân công Database → Backend → Frontend theo `docs/AGENT-TASK-AUTH-001.md`; đồng thời tối đa hai subagent và không sửa cùng file. Security và Reviewer mặc định chỉ đọc.
6. Chức năng bắt buộc: HR/Admin mời theo tổ chức, role giới hạn, token một lần/48 giờ, nhận lời mời, đăng nhập/đăng xuất, quên/reset mật khẩu, revoke/resend invite, session an toàn, rate limit, CSRF, audit. Bootstrap admin chỉ qua CLI có kiểm soát.
7. Test các trường hợp trong `docs/AUTH-TEST-MATRIX.md`; chạy lint/typecheck/unit/integration và scan có sẵn mà không lặp; kết quả không chạy phải ghi NOT VERIFIED. Ưu tiên tiết kiệm token, không tự động nâng model.
8. Gửi kết quả ngắn: kiến trúc đã chọn; Agent và Skill THỰC SỰ sử dụng; danh sách file thay đổi; các lệnh/test đã chạy; PASS/FAIL/NOT VERIFIED; rủi ro tồn tại; bước cần phê duyệt.

**Hãy thực thi trên code của repository, không chỉ trả lời kế hoạch.** Nếu dịch vụ email, database hoặc thông tin bí mật chưa được cấu hình, hoàn tất những phần kiểm thử được, ghi rõ giới hạn, không giả lập rằng production đã hoạt động.
