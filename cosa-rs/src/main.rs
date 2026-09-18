// ═══════════════════════════════════════════════
//  cosa · COSA 云控数据库工具 v2 (Turbo调度专用, ORC/inject.rs 同架构)
//  用法:
//    cosa check                              数据库就绪检查
//    cosa list                               已建档包名清单
//    cosa read <包名> [输出文件]              读单行 JSON (嵌套解包)
//    cosa write <包名> <json文件>             写单行 (from_server=0 + 保护 + WAL)
//    cosa delete <包名>                       删行
//    cosa sync [cccf目录]                     全量: 目录内 *.json → 数据库 (开机注入/手动注入共用)
//   cosa protect | unprotect                 三联保护开关
//  设计: rusqlite 直连 (零 shell/零命令行 SQL); 参数化绑定; UPDATE/INSERT 二选一;
//        WAL checkpoint 收尾; enc 配置不支持 (由 bin/inject 兜底)。
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

/// 数据库路径动态发现 (inject.rs 同款 dumpsys 法 + 静态路径兜底):
/// dumpsys 能发现多用户/非常规路径, 静态路径保证最小可用
fn db_paths() -> Vec<String> {
    let mut found = Vec::new();
    // 静态: 最常见两路径
    for p in [DB1, DB2] {
        if Path::new(p).exists() && !found.iter().any(|x| x == p) {
            found.push(p.to_string());
        }
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

/// 三联保护触发器 (inject.rs 同款 SQL)
fn install_protection(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        r#"
        CREATE TRIGGER IF NOT EXISTS protect_local_pkg_update
        BEFORE UPDATE ON {TABLE}
        WHEN OLD.from_server = 0 AND NEW.from_server != 0
        BEGIN SELECT RAISE(IGNORE); END;

        CREATE TRIGGER IF NOT EXISTS protect_local_pkg_insert
        BEFORE INSERT ON {TABLE}
        WHEN NEW.from_server != 0
         AND EXISTS (SELECT 1 FROM {TABLE}
             WHERE package_name = NEW.package_name AND from_server = 0)
        BEGIN SELECT RAISE(IGNORE); END;

        CREATE TRIGGER IF NOT EXISTS protect_local_pkg_delete
        BEFORE DELETE ON {TABLE}
        WHEN OLD.from_server = 0
        BEGIN SELECT RAISE(IGNORE); END;
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

/// 单库写入: UPDATE/INSERT 二选一 (inject.rs 同款) + from_server=0 + 回读验证
fn write_one(db: &str, pkg: &str, obj: &serde_json::Map<String, Value>) -> Result<()> {
    let conn = Connection::open(db)?;
    let cols = load_cols(&conn)?;
    let pc = real_col(&cols, "package_name")
        .context("缺少 package_name 列")?
        .to_string();
    let fsc = real_col(&cols, "from_server").map(|s| s.to_string());

    let exists: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM {} WHERE \"{}\" = ?1", TABLE, pc),
        [pkg],
        |r| r.get(0),
    )?;

    // 键 → (真实列名, 绑定值); 未知列跳过; from_server/package_name 特判
    let mut skipped: Vec<String> = Vec::new();
    let mut sets: Vec<(String, Option<String>)> = Vec::new();
    for (k, v) in obj {
        if k.eq_ignore_ascii_case(&pc) { continue; }
        if let Some(fc) = &fsc {
            if k.eq_ignore_ascii_case(fc) { continue; }
        }
        let Some(actual) = real_col(&cols, k) else {
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
        for (name, ty) in &cols {
            if name.eq_ignore_ascii_case(&pc) { continue; }
            let info: (i64, Option<String>) = conn.query_row(
                &format!(
                    "SELECT \"notnull\", dflt_value FROM pragma_table_info('{}') WHERE lower(name) = lower(?1)",
                    TABLE
                ),
                [name],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            if info.0 == 1 && info.1.is_none() {
                let up = ty.to_uppercase();
                let v = if up.contains("INT") || up.contains("REAL") || up.contains("NUM") { "0" } else { "''" };
                ins_cols.push(format!("\"{}\"", name));
                ins_vals.push(v.to_string());
            }
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

    // ── 3) from_server 强制 0 (本地配置标记, 配合三联触发器)
    if let Some(fc) = &fsc {
        conn.execute(
            &format!("UPDATE {} SET \"{}\" = 0 WHERE \"{}\" = ?1", TABLE, fc, pc),
            [pkg],
        )?;
    }

    // 回读验证 (inject.rs/ORC 同款)
    let after: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM {} WHERE \"{}\" = ?1", TABLE, pc),
        [pkg],
        |r| r.get(0),
    )?;
    if after == 0 { bail!("写入后未找到包名: {}", pkg); }

    install_protection(&conn)?;
    finish_db(db);

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
        write_one(db, pkg, obj)
            .with_context(|| format!("写入 {} (@{})", pkg, db))?;
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
        for (pkg, obj) in &json_data {
            match write_one(db, pkg, obj) {
                Ok(()) => outln!("OK: {}", pkg),
                Err(e) => { errln!("FAIL: {} ({})", pkg, e); bad += 1; }
            }
        }
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
        let cols = load_cols(&conn)?;
        let pc = real_col(&cols, "package_name").context("缺少 package_name 列")?.to_string();
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

fn usage() -> &'static str {
    "用法: cosa check|list|read <包名> [输出文件]|write <包名> <json文件>|delete <包名>|sync [目录]|protect|unprotect"
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
        Some("protect") => cmd_protect(),
        Some("unprotect") => cmd_unprotect(),
        Some("version") => { outln!("cosa 2.0 (rust)"); Ok(()) }
        _ => Err(anyhow::anyhow!(usage())),
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => { errln!("{}", e); std::process::ExitCode::FAILURE }
    }
}
