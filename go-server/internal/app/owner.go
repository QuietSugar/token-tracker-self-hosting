package app

// owner.go —— 「这台机器的所有者账户」的唯一真相。
//
// 背景（为什么以前有 TT_DEFAULT_ACCOUNT）：
// 最初没有账号体系，`scripts/issue-token.sh` 里写死了一个 sub
// （11111111-1111-4111-8111-111111111111），服务端的 auto/page 设备批准也照抄这个常量，
// 于是"设备上报归属的账户"= 一个配置字符串。后来 /api/auth/* 引入了真正的账号
// （注册/登录产生随机 user id），两者就对不上了：device-login 的用量落在 1111…，
// 登录后拿到的 access token 属于另一个 id，跨设备汇总自然互相看不见。
//
// 现在的规则（本节就是唯一真相）：
//   - 归属不再来自配置常量，而是来自库里的 auth_owner 单例行；
//   - owner 按下面的顺序**自动解析**并落库（解析一次就固定下来）：
//       1. auth_owner 已存在 → 就是它；
//       2. 只有一个带密码凭据的账户 → 认它（source=credentials）；
//       3. 只有配置钉住的 id（TT_OWNER_ACCOUNT，兼容旧名 TT_DEFAULT_ACCOUNT）→ 认它（source=config）；
//       4. 库里有历史遗留的固定 sub（旧版本用过）→ 认它（source=legacy），老数据不丢；
//       5. 都没有 → 还没有 owner。此时**第一个出现的身份**成为 owner：
//          设备批准 / 注册 / 首次用 JWT 访问（见 maybeClaimOwner）。
//
// 这样「先 device-login 还是先登录」两种顺序都能收敛到同一个账户，
// 新装机器则完全没有那个魔法 UUID 参与。

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
)

// 旧版本（无账号体系时）写死过一次的账户 id。
// 只用于**认领历史数据**，不作为默认值：新装机器上它不存在，也就不会被创建。
const legacyDefaultSub = "11111111-1111-4111-8111-111111111111"

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
	// 3) 配置钉住的 id（存在才认，不会凭空创建）
	if s.ownerAccount != "" {
		var exists int
		if err := s.db.QueryRow(`SELECT count(*) FROM auth_users WHERE id=?`, s.ownerAccount).Scan(&exists); err != nil {
			return "", "", err
		}
		if exists == 1 {
			return s.ownerAccount, "config", nil
		}
	}
	// 4) 历史遗留的固定 sub（有设备/用量才算，避免空账户被认领）
	if uid, err = s.legacySubWithData(); err != nil {
		return "", "", err
	}
	if uid != "" {
		return uid, "legacy", nil
	}
	return "", "", nil
}

func (s *Server) legacySubWithData() (string, error) {
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_users WHERE id=?`, legacyDefaultSub).Scan(&n); err != nil {
		return "", err
	}
	if n == 0 {
		return "", nil
	}
	var rows int
	if err := s.db.QueryRow(`SELECT
		(SELECT count(*) FROM devices WHERE user_id=?) +
		(SELECT count(*) FROM hourly WHERE user_id=?)`, legacyDefaultSub, legacyDefaultSub).Scan(&rows); err != nil {
		return "", err
	}
	if rows == 0 {
		return "", nil
	}
	return legacyDefaultSub, nil
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
	uid := s.ownerAccount
	if uid == "" {
		uid = newID()
	}
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

// mergeAccount 把 fromSub 名下的所有数据搬到 owner 名下。
//
// 用途：已经踩到"两条账户"的实例（旧版本 device-login 落在固定 sub，
// 之后又用 TT_AUTH_EMAIL 注册了新账户）可以一次性收拾干净。
// 只搬行、不动 token（device_tokens 里的 hash 原样保留，设备无需重新登录）。
func (s *Server) mergeAccount(fromSub, toSub string) (map[string]int, error) {
	if fromSub == "" || toSub == "" || fromSub == toSub {
		return nil, errors.New("mergeAccount: from and to must differ and be non-empty")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	var exists int
	if err := s.db.QueryRow(`SELECT count(*) FROM auth_users WHERE id=?`, fromSub).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, fmt.Errorf("unknown account %s", fromSub)
	}
	// 同一台设备在两边各有一行时，(user_id,machine_id) 唯一索引会冲突：
	// 先把源侧重复的设备软删掉（撤销），再搬剩下的。
	if _, err := s.db.Exec(`UPDATE devices SET revoked_at=?, machine_id=NULL
		WHERE user_id=? AND revoked_at IS NULL AND machine_id IS NOT NULL
		  AND machine_id IN (SELECT machine_id FROM devices WHERE user_id=? AND revoked_at IS NULL)`,
		s.nowISO(), fromSub, toSub); err != nil {
		return nil, err
	}
	moved := map[string]int{}
	steps := []struct {
		table string
		sql   string
	}{
		{"devices", `UPDATE devices SET user_id=? WHERE user_id=?`},
		{"device_tokens", `UPDATE device_tokens SET user_id=? WHERE user_id=?`},
		{"cloud_machines", `UPDATE cloud_machines SET user_id=? WHERE user_id=?`},
		{"cloud_machine_aliases", `UPDATE cloud_machine_aliases SET user_id=? WHERE user_id=?`},
		{"hourly", `UPDATE hourly SET user_id=? WHERE user_id=?`},
		{"device_tokens_dedup", ``},
	}
	for _, st := range steps {
		if st.sql == "" {
			continue
		}
		res, err := s.db.Exec(st.sql, toSub, fromSub)
		if err != nil {
			// hourly 可能因为 (user,device,hour,source,model) 冲突失败：
			// 这种情况下让用户先处理，报错比悄悄丢数据好。
			return moved, fmt.Errorf("%s: %w", st.table, err)
		}
		if n, err := res.RowsAffected(); err == nil {
			moved[st.table] = int(n)
		}
	}
	// 源账户已空：删掉它（避免列表里挂着幽灵账户）
	if _, err := s.db.Exec(`DELETE FROM auth_credentials WHERE user_id=?`, fromSub); err != nil {
		return moved, err
	}
	if _, err := s.db.Exec(`DELETE FROM auth_sessions WHERE user_id=?`, fromSub); err != nil {
		return moved, err
	}
	if _, err := s.db.Exec(`DELETE FROM auth_users WHERE id=?`, fromSub); err != nil {
		return moved, err
	}
	log.Printf("auth: merged account %s into owner %s: %v", fromSub, toSub, moved)
	return moved, nil
}
