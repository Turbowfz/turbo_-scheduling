// ═══════════════════════════════════════════════
//  cosa · COSA 云控数据库工具 v2 (Turbo调度专用, ORC/inject.rs 同架构)
//  用法:
//    cosa check                              数据库就绪检查
//    cosa list                               已建档包名清单
//    cosa read <包名> [输出文件]              读单行 JSON (嵌套解包)
//    cosa write <包名> <json文件>             写单行 (from_server=0 + 清服务器同名行 + 保护 + WAL)
//    cosa delete <包名>                       删行
//    cosa sync [cccf目录]                     全量: 目录内 *.json → 数据库 (开机注入/手动注入共用)
//    cosa localize <cccf目录>                 兜底注入后用: 把 *.enc 对应的行标回 from_server=0 并重新武装保护
//    cosa protect | unprotect                 三联保护开关
//    cosa diag                               诊断: 触发器现状 + 本地/服务器行数 + 注入拦截自检
//  设计: rusqlite 直连 (零 shell/零命令行 SQL); 参数化绑定; UPDATE/INSERT 二选一;
//        WAL checkpoint 收尾; enc 配置不支持 (由 bin/inject 兜底, 注入后 localize 收尾)。
//  from_server 语义: 0=本地(模块注入, 受保护), !=0=服务器下发(一律不许进库)。
// ═══════════════════════════════════════════════

use anyhow::{bail, Context, Result};
use rusqlite::Connection;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;

const TABLE: &str = "PackageConfigBean";
const DB1: &str = "/data/data/com.oplus.cosa/databases/db_game_database";
const DB2: &str = "/data/user_de/0/com.oplus.cosa/databases/db_game_database";
const DEFAULT_CCCF: &str = "/data/adb/modules/Turbo_Scheduling/cccf";
/// 云端内部配置行 (不是游戏, 从 list 剔除)
const EXCLUDED_PKGS: [&str; 2] = [
    "oplus.cosa.common.model.config",
    "oplus.cosa.default.model.config",
];

/// 数据库路径发现: 静态两路径优先, 命中就直接返回; 都没有才起 dumpsys 兜底
/// (dumpsys 能发现多用户/非常规路径; 但真机上一个进程 11~22ms, 而每条命令都要走这里)
fn db_paths() -> Vec<String> {
    let mut found = Vec::new();
    // 静态: 最常见两路径
    for p in [DB1, DB2] {
        if Path::new(p).exists() && !found.iter().any(|x| x == p) {
            found.push(p.to_string());
        }
    }
    if !found.is_empty() {
        return found;
    }
    // 动态: dumpsys package com.oplus.cosa 的数据目录 (inject.rs 同款)
    if let Ok(out) = std::process::Command::new("dumpsys")
        .args(["package", "com.oplus.cosa"])
        .output()
    {
        let s = String::from_utf8_lossy(&out.stdout);
        for line in s.lines() {
            // 只看 dataDir= 行 (避免隐私字段里的误匹配)
            let Some(dir) = line.strip_prefix("dataDir=") else { continue };
            let dir = dir.trim();
            if dir == "null" || dir.is_empty() { continue; }
            let db = format!("{}/databases/db_game_database", dir);
            if Path::new(&db).exists() && !found.iter().any(|x| x == &db) {
                found.push(db);
            }
        }
    }
    found
}

/// 已安装的第三方应用包名 (pm list packages -3)。
/// 拿不到列表时返回 None → 调用方不做过滤 (fail-open, 不比现状更差)
fn installed_pkgs() -> Option<Vec<String>> {
    let out = std::process::Command::new("pm")
        .args(["list", "packages", "-3"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let mut v: Vec<String> = Vec::new();
    for line in s.lines() {
        if let Some(p) = line.strip_prefix("package:") {
            let p = p.trim();
            if !p.is_empty() {
                v.push(p.to_ascii_lowercase());
            }
        }
    }
    if v.is_empty() { None } else { Some(v) }
}

fn load_cols(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({});", TABLE))?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(1)?,
            row.get::<_, String>(2).unwrap_or_else(|_| "TEXT".into()),
        ))
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 列名大小写自适应
fn real_col<'a>(cols: &'a [(String, String)], want: &str) -> Option<&'a str> {
    cols.iter()
        .find(|(n, _)| n.eq_ignore_ascii_case(want))
        .map(|(n, _)| n.as_str())
}

/// 表结构快照: 每条命令只查一次 PRAGMA (列名/NOT NULL 骨架列), 不按包重复查。
/// notnull = (列名, 是否数值型) —— 建档时按类型给安全默认值 (漏一个 NOT NULL 列整条 INSERT 就被拒)
struct TableInfo {
    cols: Vec<(String, String)>,
    pc: String,
    fc: Option<String>,
    notnull: Vec<(String, bool)>,
}

impl TableInfo {
    fn load(conn: &Connection) -> Result<Self> {
        let cols = load_cols(conn)?;
        let pc = real_col(&cols, "package_name")
            .context("缺少 package_name 列")?
            .to_string();
        let fc = real_col(&cols, "from_server").map(|s| s.to_string());
        let mut st = conn.prepare(&format!(
            "SELECT name, type FROM pragma_table_info('{}') WHERE \"notnull\" = 1 AND dflt_value IS NULL",
            TABLE
        ))?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            ))
        })?;
        let mut notnull = Vec::new();
        for r in rows {
            let (name, ty) = r?;
            if name.eq_ignore_ascii_case(&pc) {
                continue;
            }
            let up = ty.to_uppercase();
            let numeric = up.contains("INT") || up.contains("REAL") || up.contains("NUM");
            notnull.push((name, numeric));
        }
        Ok(TableInfo { cols, pc, fc, notnull })
    }
}

/// 三联保护: 本地行 (from_server=0, 就是模块注入的配置) 不许被改写/删除;
/// 服务器下发的行 (from_server!=0) 一律不许进库 —— 它的 INSERT 整行被跳过。
///
/// 这里必须 DROP + CREATE, 不能再用 CREATE IF NOT EXISTS: 第三方注入器 bin/inject 里
/// 内置了同名的旧版触发器 (它的 insert 规则是"同包名已有本地行时才拦"), 用 IF NOT EXISTS
/// 的话它会先建出弱版, 我们的新语义就永远顶不上去。
fn install_protection(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        r#"
        BEGIN;

        DROP TRIGGER IF EXISTS protect_local_pkg_update;
        DROP TRIGGER IF EXISTS protect_local_pkg_insert;
        DROP TRIGGER IF EXISTS protect_local_pkg_delete;

        CREATE TRIGGER protect_local_pkg_update
        BEFORE UPDATE ON {TABLE}
        WHEN OLD.from_server = 0 AND NEW.from_server != 0
        BEGIN SELECT RAISE(IGNORE); END;

        CREATE TRIGGER protect_local_pkg_insert
        BEFORE INSERT ON {TABLE}
        WHEN NEW.from_server != 0
        BEGIN SELECT RAISE(IGNORE); END;

        CREATE TRIGGER protect_local_pkg_delete
        BEFORE DELETE ON {TABLE}
        WHEN OLD.from_server = 0
        BEGIN SELECT RAISE(IGNORE); END;

        COMMIT;
        "#
    ))?;
    Ok(())
}

/// WAL 收尾 (ORC finish): checkpoint 合并 WAL 进主库 + sidecar 属主回 COSA
fn finish_db(db: &str) {
    if let Ok(conn) = Connection::open(db) {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
    if let Ok(m) = fs::metadata(db) {
        let (uid, gid) = (m.uid(), m.gid());
        for suffix in ["-wal", "-shm"] {
            let side = format!("{}{}", db, suffix);
            if Path::new(&side).exists() {
                let _ = fs::set_permissions(&side, fs::Permissions::from_mode(0o660));
                chown_path(&side, uid, gid);
            }
        }
    }
}

fn chown_path(path: &str, uid: u32, gid: u32) {
    use std::ffi::CString;
    if let Ok(c) = CString::new(path) {
        unsafe { libc_chown(c.as_ptr() as *const i8, uid, gid) };
    }
}

extern "C" {
    #[link_name = "chown"]
    fn libc_chown(path: *const i8, uid: u32, gid: u32) -> i32;
}

/// 输出宏: 忽略 broken pipe (Rust 默认 SIGPIPE 被忽略, outln! 在管道提前关闭时
/// 会 panic, panic=abort 下直接 abort → 调用方 `cosa read | head` 会异常退出)
macro_rules! outln {
    ($($arg:tt)*) => {{
        use std::io::Write;
        let mut h = std::io::stdout().lock();
        let _ = writeln!(h, $($arg)*);
    }};
}
macro_rules! errln {
    ($($arg:tt)*) => {{
        use std::io::Write;
        let mut h = std::io::stderr().lock();
        let _ = writeln!(h, $($arg)*);
    }};
}

// ═══════════ 子命令 ═══════════

fn cmd_check() -> Result<()> {
    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    for db in &dbs {
        let conn = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let cnt: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", TABLE), [], |r| r.get(0))?;
        outln!("{} [{} 行]", db, cnt);
    }
    Ok(())
}

fn cmd_list() -> Result<()> {
    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    let mut pkgs = BTreeSet::new();
    for db in &dbs {
        let conn = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let mut stmt = conn.prepare(&format!(
            "SELECT DISTINCT package_name FROM {} WHERE package_name NOT IN ('', '{}', '{}') ORDER BY package_name;",
            TABLE, EXCLUDED_PKGS[0], EXCLUDED_PKGS[1]
        ))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for p in rows {
            let p = p?;
            if !p.trim().is_empty() { pkgs.insert(p); }
        }
    }
    for p in &pkgs { outln!("{}", p); }
    Ok(())
}

/// 读单行 → JSON (from_server 数值化; 其余文本列原样)
fn read_row(conn: &Connection, pkg: &str) -> Result<Option<serde_json::Value>> {
    let cols = load_cols(conn)?;
    let pc = real_col(&cols, "package_name").context("缺少 package_name 列")?.to_string();
    let mut stmt = conn.prepare(&format!("SELECT * FROM {} WHERE \"{}\" = ?1 LIMIT 1;", TABLE, pc))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query([pkg])?;
    if let Some(row) = rows.next()? {
        let mut obj = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let v: rusqlite::types::ValueRef = row.get_ref(i)?;
            let jv = match v {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => serde_json::json!(n),
                rusqlite::types::ValueRef::Real(f) => serde_json::json!(f),
                rusqlite::types::ValueRef::Text(t) => {
                    Value::String(String::from_utf8_lossy(t).into_owned())
                }
                rusqlite::types::ValueRef::Blob(_) => Value::Null,
            };
            obj.insert(name.clone(), jv);
        }
        Ok(Some(Value::Object(obj)))
    } else {
        Ok(None)
    }
}

fn cmd_read(pkg: &str, out: Option<&str>) -> Result<()> {
    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    for db in &dbs {
        let conn = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        if let Some(row) = read_row(&conn, pkg)? {
            let text = serde_json::to_string_pretty(&row)?;
            match out {
                Some(path) => {
                    fs::write(path, &text)?;
                    outln!("已导出: {}", path);
                }
                None => outln!("{}", text),
            }
            return Ok(());
        }
    }
    bail!("未找到包名: {}", pkg)
}

/// 单行写入 (连接与表结构由调用方复用): UPDATE/INSERT 二选一 + from_server=0 + 回读验证。
/// 保护触发器与 WAL 收尾不放这里 —— 调用方每条命令只做一次, 不按包重复。
fn write_one(conn: &Connection, ti: &TableInfo, pkg: &str, obj: &serde_json::Map<String, Value>) -> Result<()> {
    let pc = &ti.pc;
    let fsc = &ti.fc;

    let exists: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM {} WHERE \"{}\" = ?1", TABLE, pc),
        [pkg],
        |r| r.get(0),
    )?;

    // 键 → (真实列名, 绑定值); 未知列跳过; from_server/package_name 特判
    let mut skipped: Vec<String> = Vec::new();
    let mut sets: Vec<(String, Option<String>)> = Vec::new();
    for (k, v) in obj {
        if k.eq_ignore_ascii_case(pc) { continue; }
        if let Some(fc) = fsc {
            if k.eq_ignore_ascii_case(fc) { continue; }
        }
        let Some(actual) = real_col(&ti.cols, k) else {
            skipped.push(k.clone());
            continue;
        };
        let sv = match v {
            Value::Null => None,
            Value::String(s) => Some(s.clone()),
            other => Some(other.to_string()),
        };
        sets.push((actual.to_string(), sv));
    }

    // ── 1) 目标行不存在 → 建骨架: 包名 + 全部 NOT NULL 无默认值列 (类型安全默认值)
    //     漏掉任何 NOT NULL 列都会被约束拒绝 (真机实测 from_server)
    if exists == 0 {
        let mut ins_cols = vec![format!("\"{}\"", pc)];
        let mut ins_vals = vec![format!("'{}'", pkg.replace('\'', "''"))];
        for (name, numeric) in &ti.notnull {
            ins_cols.push(format!("\"{}\"", name));
            ins_vals.push(if *numeric { "0".to_string() } else { "''".to_string() });
        }
        conn.execute(
            &format!(
                "INSERT INTO {} ({}) VALUES ({})",
                TABLE,
                ins_cols.join(", "),
                ins_vals.join(", ")
            ),
            [],
        )
        .with_context(|| format!("建档失败: {}", pkg))?;
    }

    // ── 2) 应用用户值: 两条路径共用同一条参数化 UPDATE
    //     (建档路径曾漏掉这一步 → 新行全是 null, 真机实测修复)
    if !sets.is_empty() {
        let parts: Vec<String> = sets
            .iter()
            .enumerate()
            .map(|(i, (c, _))| format!("\"{}\" = ?{}", c, i + 1))
            .collect();
        let sql = format!(
            "UPDATE {} SET {} WHERE \"{}\" = ?{}",
            TABLE,
            parts.join(", "),
            pc,
            sets.len() + 1
        );
        let mut bind: Vec<Option<String>> = sets.iter().map(|(_, v)| v.clone()).collect();
        bind.push(Some(pkg.to_string()));
        let params: Vec<&dyn rusqlite::ToSql> = bind
            .iter()
            .map(|p| p as &dyn rusqlite::ToSql)
            .collect();
        conn.execute(&sql, params.as_slice())
            .with_context(|| format!("写入 {} 失败", pkg))?;
    }

    // ── 3) from_server 强制 0 (本地配置标记, 配合三联触发器) + 清除服务器下发的同名行
    //     新触发器拦的是"以后"的服务器插入, 这里清的是历史遗留:
    //     同包名同时存在本地行与服务器行时, 应用可能优先读服务器行, 我们注入的等于没生效
    if let Some(fc) = fsc {
        // 输入 JSON 自带 from_server (从库里读出来的云端行会是 1) → 说清它被改写, 免得以为注入的是云端值
        if let Some(v) = obj.iter().find(|(k, _)| k.eq_ignore_ascii_case(fc)).map(|(_, v)| v) {
            let nonzero = match v {
                Value::Null => false,
                Value::Number(n) => n.as_i64().map_or(true, |x| x != 0),
                Value::String(s) => { let t = s.trim(); !t.is_empty() && t != "0" }
                _ => true,
            };
            if nonzero { outln!("输入 from_server={} 已强制写成 0 (注入一律落本地行)", v); }
        }
        conn.execute(
            &format!("UPDATE {} SET \"{}\" = 0 WHERE \"{}\" = ?1", TABLE, fc, pc),
            [pkg],
        )?;
        // 删的是 from_server!=0 的行 → 不触发 protect_local_pkg_delete (它只护 from_server=0)
        let purged = conn.execute(
            &format!("DELETE FROM {} WHERE \"{}\" = ?1 AND \"{}\" != 0", TABLE, pc, fc),
            [pkg],
        )?;
        if purged > 0 {
            outln!("已清除服务器下发的同名配置行: {} 个 ({})", purged, pkg);
        }
    }

    // 回读验证 (inject.rs/ORC 同款)
    let after: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM {} WHERE \"{}\" = ?1", TABLE, pc),
        [pkg],
        |r| r.get(0),
    )?;
    if after == 0 { bail!("写入后未找到包名: {}", pkg); }

    if !skipped.is_empty() {
        errln!("已忽略未知字段: {}", skipped.join(", "));
    }
    Ok(())
}

/// write <包名> <json文件>
fn cmd_write(pkg: &str, json_path: &str) -> Result<()> {
    if !valid_pkg(pkg) { bail!("包名格式无效: {}", pkg); }
    let content = fs::read_to_string(json_path).context("无法读取 JSON 文件")?;
    let doc: Value = serde_json::from_str(&content).context("JSON 格式错误")?;
    let obj = doc.as_object().context("JSON 顶层必须是对象")?;
    if obj.is_empty() { bail!("JSON 内容为空"); }

    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    for db in &dbs {
        let conn = Connection::open(db)?;
        let ti = TableInfo::load(&conn)?;
        write_one(&conn, &ti, pkg, obj)
            .with_context(|| format!("写入 {} (@{})", pkg, db))?;
        install_protection(&conn)?;
        finish_db(db);
    }
    outln!("{} 配置写入成功", pkg);
    Ok(())
}

fn valid_pkg(pkg: &str) -> bool {
    !pkg.is_empty()
        && pkg.len() <= 255
        && pkg.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// sync [cccf目录]: 目录内 *.json 全量写库 (开机注入/手动注入共用; inject.rs 的批量角色)
fn cmd_sync(dir: Option<&str>) -> Result<()> {
    let dir = dir.unwrap_or(DEFAULT_CCCF);
    let cccf = Path::new(dir);
    if !cccf.is_dir() { bail!("cccf 目录不存在: {}", dir); }

    let mut json_data: Vec<(String, serde_json::Map<String, Value>)> = Vec::new();
    let mut bad = 0;
    for entry in fs::read_dir(cccf).context("无法读取 cccf 目录")? {
        let path = entry?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        let pkg = path.file_stem().unwrap().to_string_lossy().to_string();
        let content = match fs::read_to_string(&path) { Ok(c) => c, Err(_) => { bad += 1; continue } };
        let json: Value = match serde_json::from_str(&content) { Ok(v) => v, Err(_) => { bad += 1; errln!("FAIL: {} (JSON 无效)", pkg); continue } };
        match json.as_object() {
            Some(o) if !o.is_empty() => json_data.push((pkg, o.clone())),
            _ => { bad += 1; errln!("FAIL: {} (空对象)", pkg); }
        }
    }
    if json_data.is_empty() { bail!("cccf 内没有有效配置 ({} 个坏文件)", bad); }
    let total = json_data.len();

    // 只注入手机上已安装的游戏 (包名大小写不敏感); 拿不到列表则不过滤
    match installed_pkgs() {
        Some(list) => {
            json_data.retain(|(pkg, _)| list.iter().any(|p| p == &pkg.to_ascii_lowercase()));
            let skipped = total - json_data.len();
            if skipped > 0 {
                outln!("跳过未安装的游戏: {} 个", skipped);
            }
        }
        None => errln!("警告: 无法获取已安装应用列表, 本次不按已安装性过滤"),
    }
    if json_data.is_empty() {
        bail!("{} 个配置对应的游戏均未安装, 无可注入内容", total);
    }

    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }

    for db in &dbs {
        outln!("处理数据库: {}", db);
        let conn = Connection::open(db)?;
        let ti = TableInfo::load(&conn)?;
        for (pkg, obj) in &json_data {
            match write_one(&conn, &ti, pkg, obj) {
                Ok(()) => outln!("OK: {}", pkg),
                Err(e) => { errln!("FAIL: {} ({})", pkg, e); bad += 1; }
            }
        }
        // 保护触发器与 WAL 收尾每条命令只做一次: 原来写在 write_one 里 → N 个包就 N 轮
        // DDL + N 次 checkpoint(TRUNCATE) + N 次 sidecar chown (WAL 反复重写, 白写闪存)
        install_protection(&conn)?;
        finish_db(db);
    }
    outln!("注入完成. 共 {} 个, 失败 {}", json_data.len(), bad);
    if bad > 0 && bad >= json_data.len() { bail!("全部失败"); }
    Ok(())
}

fn cmd_delete(pkg: &str) -> Result<()> {
    if !valid_pkg(pkg) { bail!("包名格式无效"); }
    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    for db in &dbs {
        let conn = Connection::open(db)?;
        let ti = TableInfo::load(&conn)?;
        let pc = &ti.pc;
        conn.execute_batch("DROP TRIGGER IF EXISTS protect_local_pkg_delete;")?;
        conn.execute(&format!("DELETE FROM {} WHERE \"{}\" = ?1", TABLE, pc), [pkg])?;
        install_protection(&conn)?;
        finish_db(db);
    }
    outln!("{} 已删除", pkg);
    Ok(())
}

fn cmd_protect() -> Result<()> {
    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    for db in &dbs {
        let conn = Connection::open(db)?;
        install_protection(&conn)?;
        finish_db(db);
    }
    outln!("已启用本地配置保护");
    Ok(())
}

fn cmd_unprotect() -> Result<()> {
    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    for db in &dbs {
        let conn = Connection::open(db)?;
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS protect_local_pkg_update; \
             DROP TRIGGER IF EXISTS protect_local_pkg_insert; \
             DROP TRIGGER IF EXISTS protect_local_pkg_delete;",
        )?;
        finish_db(db);
    }
    outln!("已撤掉本地配置保护");
    Ok(())
}

/// localize <目录>: 注入收尾 —— 保证目录内每个包 (含 *.json 与 *.enc) 的行都是
/// from_server=0 (本地行), 校验行到底有没有落库, 并重新武装三联保护。
/// 兜底注入用的 bin/inject 写的是服务器标记行, 而且它自己会装一套旧版弱触发器 —— 全靠这一步扳回来。
fn cmd_localize(dir: &str) -> Result<()> {
    let cccf = Path::new(dir);
    if !cccf.is_dir() { bail!("cccf 目录不存在: {}", dir); }

    let mut pkgs: BTreeSet<String> = BTreeSet::new();
    for entry in fs::read_dir(cccf).context("无法读取 cccf 目录")? {
        let path = entry?.path();
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        if ext != "json" && ext != "enc" { continue; }
        pkgs.insert(path.file_stem().unwrap().to_string_lossy().to_string());
    }
    if pkgs.is_empty() { bail!("目录内没有 .json/.enc: {}", dir); }

    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    for db in &dbs {
        let conn = Connection::open(db)?;
        let ti = TableInfo::load(&conn)?;
        let pc = &ti.pc;
        let Some(fc) = ti.fc.as_deref() else {
            errln!("该库没有 from_server 列, 无法保证本地标记");
            continue;
        };
        let mut fixed = 0usize;
        let mut missing: Vec<&String> = Vec::new();
        let mut left: Vec<&String> = Vec::new();
        for pkg in &pkgs {
            fixed += conn.execute(
                &format!(
                    "UPDATE {} SET \"{}\" = 0 WHERE \"{}\" = ?1 AND \"{}\" != 0",
                    TABLE, fc, pc, fc
                ),
                [pkg.as_str()],
            )?;
            let (rows, nonzero): (i64, i64) = conn.query_row(
                &format!(
                    "SELECT COUNT(*), COALESCE(SUM(CASE WHEN \"{}\" != 0 THEN 1 ELSE 0 END), 0) FROM {} WHERE \"{}\" = ?1",
                    fc, TABLE, pc
                ),
                [pkg.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            if rows == 0 {
                missing.push(pkg);
            } else if nonzero > 0 {
                left.push(pkg);
            }
        }
        install_protection(&conn)?;
        finish_db(db);
        outln!("已标回本地 (from_server=0): {} 行 / 包 {} 个", fixed, pkgs.len());
        if !missing.is_empty() {
            // 真有缺行时才去取已安装列表 (pm list 真机约 100ms), 用它滤掉未安装的游戏免得刷屏
            let inst = installed_pkgs();
            let real: Vec<&str> = missing
                .iter()
                .filter(|p| {
                    inst.as_ref()
                        .map_or(false, |v| v.iter().any(|x| x == &p.to_ascii_lowercase()))
                })
                .map(|s| s.as_str())
                .collect();
            if !real.is_empty() {
                errln!("警告: 已安装但库里没有行 (注入未生效): {}", real.join(", "));
            }
        }
        if !left.is_empty() {
            errln!(
                "警告: 仍有服务器标记行: {}",
                left.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
            );
        }
    }
    outln!("保护已重新武装");
    Ok(())
}

/// diag: 诊断 —— 触发器现状 / 本地·服务器行数 / 同名冲突 / "服务器行能不能插进来"自检。
/// 自检在事务里插一行 from_server=1 再回滚 (不留痕): 被触发器整行跳过才算拦下。
fn cmd_diag() -> Result<()> {
    let dbs = db_paths();
    if dbs.is_empty() { bail!("未找到数据库"); }
    for db in &dbs {
        let conn = Connection::open(db)?;
        let ti = TableInfo::load(&conn)?;
        let pc = &ti.pc;
        outln!("数据库: {}", db);
        // 关键列名与声明类型: 不同 COSA 版本/机型的大小写与类型可能不同 (排查兼容性问题用)
        let ty_of = |want: &str| -> String {
            ti.cols
                .iter()
                .find(|(n, _)| n.eq_ignore_ascii_case(want))
                .map(|(n, t)| format!("\"{}\" {}", n, t))
                .unwrap_or_else(|| "(无)".to_string())
        };
        outln!(
            "  关键列: package_name={} | from_server={}",
            ty_of("package_name"),
            ty_of("from_server")
        );

        let mut st = conn.prepare(
            "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?1 ORDER BY name",
        )?;
        let rows = st.query_map([TABLE], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?;
        let mut n_trig = 0;
        for r in rows {
            let (name, sql) = r?;
            n_trig += 1;
            let one = sql.unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" ");
            outln!("  触发器 {}: {}", name, one);
        }
        drop(st);
        if n_trig == 0 { outln!("  触发器: 无 (保护未武装)"); }

        let total: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", TABLE), [], |r| r.get(0))?;
        outln!("  配置行总数: {}", total);

        let Some(fc) = ti.fc.as_deref() else {
            outln!("  该库没有 from_server 列, 跳过行数统计与自检");
            continue;
        };
        let server: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM {} WHERE \"{}\" != 0", TABLE, fc),
            [],
            |r| r.get(0),
        )?;
        outln!("  本地行 (from_server=0): {}   服务器行 (!=0): {}", total - server, server);
        let dup: i64 = conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM {0} WHERE \"{1}\" != 0 AND \"{2}\" IN (SELECT \"{2}\" FROM {0} WHERE \"{1}\" = 0)",
                TABLE, fc, pc
            ),
            [],
            |r| r.get(0),
        )?;
        outln!("  同名冲突 (同包名既有本地行又有服务器行): {}", dup);

        conn.execute_batch("BEGIN;")?;
        let ins = conn.execute(
            &format!(
                "INSERT INTO {} (\"{}\", \"{}\") VALUES ('turbo.diag.selfcheck', 1)",
                TABLE, pc, fc
            ),
            [],
        );
        let landed: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM {} WHERE \"{}\" = 'turbo.diag.selfcheck'", TABLE, pc),
            [],
            |r| r.get(0),
        )?;
        conn.execute_batch("ROLLBACK;")?;
        match ins {
            Ok(_) if landed == 0 => outln!("  自检: 服务器行注入被拦下 OK"),
            Ok(_) => outln!("  自检: 服务器行注入未被拦下 FAIL (进了 {} 行)", landed),
            Err(e) => outln!("  自检: 插入未被触发器跳过 (走到约束检查: {}), 视为未拦下", e),
        }
    }
    Ok(())
}

fn usage() -> &'static str {
    "用法: cosa check|list|read <包名> [输出文件]|write <包名> <json文件>|delete <包名>|sync [目录]|localize <目录>|protect|unprotect|diag"
}

fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("check") => cmd_check(),
        Some("list") => cmd_list(),
        Some("read") => match (args.get(2), args.get(3)) {
            (Some(p), out) => cmd_read(p, out.as_deref().map(|x| x.as_str())),
            _ => Err(anyhow::anyhow!(usage())),
        },
        Some("write") => match (args.get(2), args.get(3)) {
            (Some(p), Some(f)) => cmd_write(p, f),
            _ => Err(anyhow::anyhow!(usage())),
        },
        Some("delete") => match args.get(2) {
            Some(p) => cmd_delete(p),
            _ => Err(anyhow::anyhow!(usage())),
        },
        Some("sync") => cmd_sync(args.get(2).map(String::as_str)),
        Some("localize") => match args.get(2) {
            Some(d) => cmd_localize(d),
            _ => Err(anyhow::anyhow!(usage())),
        },
        Some("protect") => cmd_protect(),
        Some("unprotect") => cmd_unprotect(),
        Some("diag") => cmd_diag(),
        Some("version") => { outln!("cosa 2.0 (rust)"); Ok(()) }
        _ => Err(anyhow::anyhow!(usage())),
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => { errln!("{}", e); std::process::ExitCode::FAILURE }
    }
}
