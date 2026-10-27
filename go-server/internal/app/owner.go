package app

// owner.go —— 「这台机器的所有者账户」的唯一真相。
//
// 设计上刻意**没有任何"默认账户"常量**：不存在写死的 UUID，也不存在"钉住 id"的环境变量。
// 归属只有一个来源 —— 库里的 auth_owner 单例行，由下面的规则解析出来：
//
//	1. auth_owner 已存在 → 就是它；
//	2. 库里只有一个带密码凭据的账户 → 认它（source=credentials）；
//	3. 都没有 → 还没有 owner；此时**第一个出现的身份**成为 owner
//	   （source=device / signup / bootstrap / first-use，见 claimOwner）。
//
// 这样「先 device-login 还是先登录」两种顺序都收敛到同一个账户，也不会凭空造出
// 任何第二个账户。历史上曾有过一个写死的 UUID（1111…），那套"默认账户 + 认领旧数据"
// 的兼容逻辑已随概念一起删除 —— 服务假定每次部署都是从空库开始。

import (
	"database/sql"
	"errors"
)

// maybeClaimOwner：还没有 owner 时，把本次请求的 JWT sub 认作 owner。
//
// 为什么放在这里：自托管没有"注册"这个必经步骤，用户可能先用
// `issue-token.sh` 签一个 JWT 去导数据（scripts/import-usage.py 就是这样），
// 也可能先用 device-login。谁先出现谁就是所有者，之后的注册会**挂到同一个账户**
// （adoptableOwner），因此不会产生第二个账户。
// 已解析出 owner 后用内存标记短路，不额外查库。
func (s *Server) maybeClaimOwner(sub string) {
	if sub == "" || s.ownerKnown {
		return
	}
	uid, err := s.ownerSub()
	if err != nil {
		return
	}
	if uid == "" {
		if err := s.claimOwner(sub, "first-use"); err != nil {
			return
		}
	}
	s.ownerKnown = true
}

// ownerSub 返回当前所有者账户 id；没有则返回空串。
// 解析成功时会写 auth_owner，此后结果稳定（不会被后续注册/配置悄悄改掉）。
func (s *Server) ownerSub() (string, error) {
	var uid string
	err := s.db.QueryRow(`SELECT user_id FROM auth_owner WHERE slot=1`).Scan(&uid)
	if err == nil {
		s.ownerKnown = true
		return uid, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	uid, source, err := s.resolveOwnerCandidate()
	if err != nil || uid == "" {
		return "", err
	}
	if err := s.claimOwner(uid, source); err != nil {
		return "", err
	}
	return uid, nil
}

// resolveOwnerCandidate 按优先级挑一个候选账户（不落库）。
func (s *Server) resolveOwnerCandidate() (uid, source string, err error) {
	// 2) 唯一的带密码账户
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_credentials`).Scan(&n); err != nil {
		return "", "", err
	}
	if n == 1 {
		if err := s.db.QueryRow(`SELECT user_id FROM auth_credentials LIMIT 1`).Scan(&uid); err != nil {
			return "", "", err
		}
		return uid, "credentials", nil
	}
	return "", "", nil
}

// claimOwner 把 uid 钉成 owner（幂等；已存在则不动）。
func (s *Server) claimOwner(uid, source string) error {
	if uid == "" {
		return errors.New("claimOwner: empty user id")
	}
	if err := s.ensureAccount(uid); err != nil {
		return err
	}
	_, err := s.db.Exec(s.db.InsertIgnore(`auth_owner(slot,user_id,source,created_at) VALUES(1,?,?,?)`),
		uid, source, s.nowISO())
	return err
}

// ensureOwner 取 owner；没有就**创建一个空账户**并钉住（设备批准路径用）。
// 这样「先 device-login、后注册/登录」也能收敛到同一个账户。
func (s *Server) ensureOwner(source string) (string, error) {
	if uid, err := s.ownerSub(); err != nil {
		return "", err
	} else if uid != "" {
		return uid, nil
	}
	uid := newID()
	if err := s.claimOwner(uid, source); err != nil {
		return "", err
	}
	return uid, nil
}

// ownerInfo 是 /api/auth/owner 的响应（只暴露身份，不含任何凭据）。
func (s *Server) ownerInfo() (map[string]any, error) {
	uid, err := s.ownerSub()
	if err != nil {
		return nil, err
	}
	out := map[string]any{"user_id": uid, "has_credentials": false, "source": ""}
	if uid == "" {
		return out, nil
	}
	var source string
	_ = s.db.QueryRow(`SELECT source FROM auth_owner WHERE slot=1`).Scan(&source)
	out["source"] = source
	var email string
	if err := s.db.QueryRow(`SELECT email FROM auth_users WHERE id=?`, uid).Scan(&email); err == nil {
		out["email"] = email
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_credentials WHERE user_id=?`, uid).Scan(&n); err == nil {
		out["has_credentials"] = n > 0
	}
	return out, nil
}

// adoptOwner 在注册/引导时决定「新凭据挂到谁身上」：
//   - 已有 owner 但还没有密码 → 挂到 owner（否则会出现两个账户）；
//   - 有 owner 且有密码 → 拒绝（由调用方报错）；
//   - 没有 owner → 返回空串，调用方创建新账户后自行 claimOwner。
func (s *Server) adoptableOwner() (string, error) {
	uid, err := s.ownerSub()
	if err != nil || uid == "" {
		return "", err
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_credentials WHERE user_id=?`, uid).Scan(&n); err != nil {
		return "", err
	}
	if n > 0 {
		return "", nil
	}
	return uid, nil
}
