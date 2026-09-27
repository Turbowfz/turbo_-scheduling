/* ── 云控页 · 基础版表单层: 参数注释表 / 表单渲染 / 表单收集 ──
   依赖 core.js (escapeHTML); 依赖 cloud-io.js 的运行期存在 (_baseObj 挂 window)
   参数依据: 风驰一代云控参数解析.jsonc + 全机型官方云控配置普查 (101 份) */

/* 状态挂 window: 经典 script 全局词法绑定与 window 属性互通, 便于跨脚本/测试访问 */
window._baseObj = null; /* 基础版当前编辑的游戏配置对象 */
window._baseOrig = {}; /* id -> 原始值 (类型保持) */
window._baseExisted = new Set(); /* 配置里原本就存在的字段路径 */

/* ═══════════ 参数注释表 ═══════════
   依据: 风驰·官方云控配置解析.jsonc (官方实测/⚠标记) + 全机型官方配置普查 */
const FI = {
  /* ── gpa_config 频率档位对 (映射: cl/ch=大核, sm=小核, gf/gm=超大核, tl/th=中核; -1=禁用) ── */
  cl: { k: 'cl', n: '大核频率下限', t: '频点索引: -1=禁用, 从0起对应大核各频点. 抬高大核最低频防止关键时刻掉频 (官方实测 -1~8)' }, ch: { k: 'ch', n: '大核频率上限', t: '大核调频区间上限 (官方实测 -1~22). 调低降发热, 压太狠影响重负载帧率' }, sm: { k: 'sm', n: '小核频率上限', t: '小核限频档, -1=禁用 (小核共18档 0~17, 官方实测12). 压小核上限是最划算的省电点' }, gf: { k: 'gf', n: '超大核频率下限', t: '超大核下限档, -1=禁用 (官方实测7). 抬底频让单核爆发更稳' }, gm: { k: 'gm', n: '超大核频率上限', t: '超大核上限档 (共35档 0~34, 官方实测 -1~21). 超大核最费电, 温度高时优先压这里' }, tl: { k: 'tl', n: '中核频率下限', t: '中核下限档, -1=禁用 (共32档 0~31, 官方实测 -1~7). 中核是主力核, 抬底频稳定感最明显' }, th: { k: 'th', n: '中核频率上限', t: '中核上限档 (官方实测 -1~22)' }, core: { k: 'core', n: '核心参与表', t: '逗号 8 值对应 8 核, 开关核心: 0=参与 1=屏蔽 -1=不干预' }, /* ── gpa_config.es4g 核心隔离辅助调度 (蜂鸟) ── */
  es4gState: { k: 'es4g state', n: '蜂鸟总开关', t: 'bool. true=进游戏打开蜂鸟调度, 本包其它设置随之生效' }, es4gIsolate: { k: 'es4g isolate', n: '隔离核表', t: '逗号分隔(主档掩码, 备用档): 掩码第N位=CPU N, 如 144=0x90=CPU4+7. 把核从普通调度抽出留给游戏线程' }, es4gClist: { k: 'es4g clist', n: '关键线程座位表', t: '逗号分隔 CPU 号: 关键任务优先放这些核, 如 "4,7,2,3"=中核首颗+超大核' }, es4gTcount: { k: 'es4g tcount', n: '关键任务数量', t: '最多挑几个关键任务重点照顾, 官方值 4' }, es4gFps: { k: 'es4g fps', n: '目标帧率', t: '内核按它对齐负载统计窗口, 填游戏实际帧率 60/90/120' }, es4gDelay: { k: 'es4g delay', n: '启动延迟(ms)', t: '进游戏后延迟启用, 等场景稳定' }, es4gPartial: { k: 'es4g partial', n: '部分隔离', t: 'bool. 只隔离一部分核, 剩下照常参与普通调度, 比全隔离温和' }, /* ── gpa_config.mema 内存带宽调频 (EMA 负载平滑后选频; 全局 + custom 按簇覆盖) ── */
  memaBeta: { k: 'mema beta', n: '平滑系数', t: '对连续采样做 EMA 平滑, 官方默认 45. 调小更平缓, 调大反应快但可能抖动' }, memaMode: { k: 'mema mode', n: '簇内负载合并', t: '0=取最高(激进) 1=取平均(居中) 2=取中位(抗单核抖动, 最稳). 官方 2' }, memaTl: { k: 'mema tl', n: '目标负载表', t: '成对(util分段点0..1024递增, 目标负载%非0), 如 "0,75,300,75,450,75,600,75". 目标负载越低越激进越费电' }, /* ── game_config 游戏期加速控制 (只可改 cht_boost_max / cht_boost_min / ctn / ctep) ── */
  gcBoostMax: { k: 'cht_boost_max', n: '重载任务提频上限', t: '每簇一个档位(0=该簇最低频点): 识别到关键线程拖后腿时把这几簇频率顶到上限. 一加15原神官方 "0,27,6,28"' }, gcBoostMin: { k: 'cht_boost_min', n: '重载任务提频下限', t: '每簇一个档位, 与 cht_boost_max 配套的底线. 一加15原神官方 "0,16,6,14"' }, gcCtn: { k: 'ctn', n: '关键线程名单', t: '空格分隔的线程名前缀, 命中即按关键任务加速, 如 "RenderThread Thread-"' }, gcCtep: { k: 'ctep', n: '关键任务优先级', t: '关键任务的优先级数值, 官方默认 110, 示例配置常用 80. 调大提升关键任务调度优先级' }, /* ── thermal_frame 温控降帧 (统一标准格式 balance_nl/highperf_nl/ternary) ── */
  tfBalance:{ k: 'balance_nl', n: '均衡NL曲线', t: '均衡模式的温度-帧率曲线, 成对(温度档,目标帧率), 如 "50,45,52,30"' }, tfHighperf:{ k: 'highperf_nl', n: '高性能NL曲线', t: '高性能模式的温度-帧率曲线, 成对(温度档,目标帧率)' }, tfTernary:{ k: 'ternary', n: '三段式降帧', t: '固定 false 的只读标记, 不可修改' }, /* ── fps_stabilizer 掉帧急救队 ── */
  fsBoostStep: { k: 'boostStep', n: '掉帧加压系数', t: '逗号浮点升序, 个数=急救档数. 掉得越严重用越大系数, 官方默认 "1.1,1.3,1.5", 实测 0.9/1.1/1.3' }, fsFreqStep: { k: 'freqStep', n: '频档阶梯', t: '每急救档 × 每颗代表核的(上限档, 下限档)对, 先按核(小核→中核→大核→超大核)再按档; 8G3=3档×4核=24个数, 个数不对整条不生效' }, fsTemp: { k: 'temp', n: '过温停止线', t: '0.1°C 精度, 450=45°C. 超过它不再靠提频救帧 (实测 450)' }, fsBoostTime: { k: 'boostTime', n: '单级boost时长', t: '一次提频持续多久(ms), 到点自动回落' }, fsMode: { k: 'mode', n: '算法模式', t: 'step=分档阶跃 / ddl=按期限. 缺省 step' }, fsColdDelay: { k: 'coldDelay', n: '冷态boost间隔', t: 'ms. 两次 boost 的间隔' }, fsHotDelay: { k: 'hotDelay', n: '过温再压延迟', t: 'ms. 过温后延迟多久再压' }, /* ── cpu_config 场景化提频 ── */
  ccBoost: { k: 'boost', n: '提频档对', t: '逗号频率档对按簇, 8个数=4簇×(上限档,下限档), 如 "11,6,15,5,15,5,12,5"; 空=回退各簇最高档' }, ccTime: { k: 'time', n: '提频时长(ms)', t: '场景提频持续时间, 默认1000, 官方最长60000. 场景名必须用官方枚举才生效' }, /* ── game_zone 关键线程识别与伺候 ── */
  gzRecognize: { k: 'recognize_interval', n: '识别周期(ms)', t: '关键线程识别轮次周期, 默认8000. 调小反应快, 调大省开销' }, gzWakeUp: { k: 'wake_up_times', n: '唤醒次数阈值', t: '一周期内唤醒达到它才算高频唤醒(换算成每秒). 越大挑出的关键线程越少' }, gzKeyUx: { k: 'key_thread_ux', n: '关键线程UX', t: '关键线程提权等级, 官方实测恒为 2' }, gzKeyWorkerUx:{ k: 'key_worker_ux', n: 'worker线程UX', t: 'worker 类关键线程提权等级, 官方常用 2' }, gzWhiteListUx:{ k: 'white_list_ux', n: '白名单线程UX', t: 'white_list 命中线程提权等级, 官方常用 2' }, gzSearchWhite:{ k: 'search_white_list', n: '白名单搜索强度', t: '白名单搜索强度, 官方常用 25, 越高搜索范围越积极' }, gzFixedCritical:{ k: 'fixed_critical_task', n: '固定关键任务', t: 'JSON数组或字符串, 固定不变的关键线程表, 如 ["f_RenderThread","n_Thread-"]' }, gzBindCore: { k: 'bind_core', n: '绑核总开关', t: '0=关 1或2=开. 开启把最频繁唤醒的关键线程绑到超大核, 发热明显可先关它' }, gzWhiteList: { k: 'white_list', n: '线程白名单', t: 'JSON数组, 线程名前缀, 命中即纳入关键线程识别+提权+绑核候选' }, gzBindList: { k: 'bind_list', n: '绑核表', t: '8G3 分组: g_0=全部核; g_1=CPU0-1小核; g_2=CPU2-4中核; g_3=CPU5-6大核; g_4=CPU7超大核; g_5=中核+超大核; g_6=中核+大核; g_7=大核+超大核; g_8=小核+大核; g_9=中核+大核+超大核; g_10=小核; g_11=中核. p_十进制=硬绑CPU, m_十六进制=软偏好CPU, c_十六进制=软偏好簇' }, gzPipeline: { k: 'pipeline', n: '渲染管线', t: 'JSON对象 核号→线程名: 7=超大核(触发pipeline提频) 4=大核 3/2=中核; -1普通 -2UI -3TOP' },
}; /* 数字/文本输入行 (带参数注释: 点参数名展开说明) */
function fieldRow(key, id, value) {
  const info = FI[key] || { k: key, n: '', t: '' }; const isStr = typeof value === 'string'; const v = (value === null || value === undefined) ? '' : String(value); const numAttr = isStr ? '' : ' inputmode="numeric" style="max-width:120px;text-align:right"'; const q = info.t ? '<span class="cf-q">?</span>' : ''; const nameHtml = info.n ? `<span class="cf-name">${info.n}</span>` : ''; const tipRow = info.t ? `<div class="cf-tiprow"><div class="cf-tip">${info.t}</div></div>` : ''; return `<div class="cf-field"><div class="cf-fl"><span class="cf-key">${info.k}</span>${nameHtml}${q}</div>
    <input type="text" class="inp cf-in" id="${id}" value="${escapeHTML(v)}" placeholder="未设置"${numAttr}></div>${tipRow}`;
}
function fieldCheck(key, id, checked) {
  const info = FI[key] || { k: key, n: '', t: '' }; const q = info.t ? '<span class="cf-q">?</span>' : ''; const nameHtml = info.n ? `<span class="cf-name">${info.n}</span>` : ''; const tipRow = info.t ? `<div class="cf-tiprow"><div class="cf-tip">${info.t}</div></div>` : ''; return `<div class="cf-field"><div class="cf-fl"><span class="cf-key">${info.k}</span>${nameHtml}${q}</div>
    <label class="tog"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="tk"></span></label></div>${tipRow}`;
}
function gv(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
}
function sv(root, path, val) {
  const keys = path.split('.'); let cur = root; for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {}; cur = cur[keys[i]]; }
  cur[keys[keys.length - 1]] = val;
}
/* 删除叶子路径 (可选参数清空 → 删掉这一行; 只有叶子被删, 大纲容器不会被动) */
function delPath(root, path) {
  const keys = path.split('.'); let cur = root; for (let i = 0; i < keys.length - 1; i++) {
    if (!cur || !cur[keys[i]] || typeof cur[keys[i]] !== 'object') return; cur = cur[keys[i]]; }
  delete cur[keys[keys.length - 1]];
}
/* 递归收集对象叶子路径, 用于记录 "原本存在" 的字段 */
function collectPaths(o, prefix, set) {
  for (const k in o) {
    const v = o[k]; const p = prefix ? prefix + '.' + k : k; if (v && typeof v === 'object') collectPaths(v, p, set); else set.add(p); }
}

/* 渲染基础表单: 从 json 对象提取帧率档位 */
function renderBaseForm() {
  const form = document.getElementById('cf-base-form'); const obj = _baseObj; if (!form) return; if (!obj) { form.innerHTML = '<div class="empty-tip">请先选择游戏配置</div>'; return; }

  /* 记录原始值与原始存在路径 */
  _baseOrig = {}; _baseExisted = new Set(); const gpa = (obj.gpa_config && typeof obj.gpa_config === 'object') ? obj.gpa_config : {}; const tf = (obj.thermal_frame && typeof obj.thermal_frame === 'object') ? obj.thermal_frame : {}; const cpu = (obj.cpu_config && typeof obj.cpu_config === 'object') ? obj.cpu_config : {}; const gz = (obj.game_zone && typeof obj.game_zone === 'object') ? obj.game_zone : {}; collectPaths(gpa, 'gpa', _baseExisted); collectPaths(tf, 'tf', _baseExisted); collectPaths(cpu, 'cpu', _baseExisted); /* game_zone: JSON 字段 (数组/对象) 作为整叶子路径, 不递归展开下标 */
  ['white_list', 'pipeline', 'bind_list', 'system_process', 'system_server'].forEach(k => {
    if (gz[k] !== undefined) _baseExisted.add('gz.' + k); }); collectPaths(gz, 'gz', _baseExisted); if (obj.game_config && typeof obj.game_config === 'object') collectPaths(obj.game_config, 'game_config', _baseExisted); const realPath = p => p
    .replace(/^gpa\./, 'gpa_config.')
    .replace(/^tf\./, 'thermal_frame.')
    .replace(/^cpu\./, 'cpu_config.')
    .replace(/^gz\./, 'game_zone.'); _baseExisted.forEach(p => { _baseOrig[p] = gv(obj, realPath(p)); }); /* 官方配置有两种 gpa 形态: 60/90/120 帧率档, 或 ACE5/二代的全局平铺键 */
  const GPA_KEYS = ['cl', 'ch', 'sm', 'gf', 'gm', 'tl', 'th', 'core', 'es4g', 'mema']; const flatGpa = GPA_KEYS.some(k => Object.prototype.hasOwnProperty.call(gpa, k)) &&
    (gpa.cl !== undefined || gpa.es4g !== undefined || gpa.mema !== undefined); const fpsList = flatGpa ? ['__global__'] : Object.keys(gpa).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)); const firstOpen = f => f === fpsList[0] ? ' open' : ''; const fpsLabel = f => f === '__global__' ? '全局 (未分帧)' : f + 'Hz'; let html = ''; /* ── cpu_config (场景化提频; 场景由用户手动添加, 下方列出官方场景名参考) ── */
  {
    /* 官方场景名参考表 (不在表里的场景名会被直接忽略, 乱加无效) */
    const SCENE_REF = [
      ['start', '启动', '刚进游戏阶段, 官方常用 (time 1500~30000)'], ['loading', '加载', '读盘加载阶段, 官方最常见 (time 5000~14000)'], ['logging', '战斗日志', '战斗日志阶段'], ['sceneswitch', '场景切换', '大地图/副本切换 (原神/星铁, time 10000~20000)'], ['tuanzhan', '团战', '团战阶段 (王者)'], ['battle', '战斗', '战斗阶段'], ['rolefreeze', '角色冻结', '角色冻结 (原神)'], ['parachute', '跳伞', '跳伞阶段 (和平精英, time 60000)'], ['drive', '驾驶', '驾驶阶段 (和平精英)'], ['landing', '落地', '落地阶段 (和平精英, time 30000)'], ['chooserole', '选角', '选角阶段'], ['tcg', '卡牌对战', '原神七圣召唤'], ['abypass', '深渊', '原神深渊副本'], ['overload', '超载', '超载场景'], ]; const sceneNames = Object.keys(cpu).sort(); html += `<div class="cf-sec">cpu_config (场景化提频)<span style="flex:1"></span><button type="button" class="btn" data-cpu-add style="flex:none;padding:5px 12px;font-size:var(--fs-xs)">添加场景</button></div>`; html += `<div class="cf-hint">boost=各簇频率档对(8个数=4簇×(上限,下限), 空=各簇最高档) · time=持续时间(ms) · 场景由你手动添加</div>`; /* 官方场景名参考 (可折叠; 标出已添加) */
    html += `<details class="cf-gp"><summary>◈ 官方场景名参考 (手动添加用)</summary><div class="cf-gp-body">`; SCENE_REF.forEach(([n, cn, d]) => {
      const has = Object.prototype.hasOwnProperty.call(cpu, n); html += `<div class="cf-field"><div class="cf-fl"><span class="cf-key">${escapeHTML(n)}</span><span class="cf-name">${escapeHTML(cn)}</span></div>${has ? '<span class="cf-ro" style="color:#3fb950">已添加</span>' : ''}</div>
        <div class="cf-tiprow" style="display:block"><div class="cf-tip">${escapeHTML(d)}</div></div>`; }); html += `<div class="cf-hint" style="margin-top:6px">地图城/村识别 (原神): 前缀 蒙德=md 璃月=ly 稻妻=dq 须弥=xm 枫丹=fd + 后缀 city=城 / village=村, 另有 yxgvillage / cyjyvillage. 官方实际只下发 start/loading/parachute/landing/sceneswitch 几个</div>`; html += `</div></details>`; html += `<div id="cpu-add-row" style="display:none;align-items:center;gap:6px;margin:6px 0">
      <input type="text" class="inp" id="cpu-add-name" placeholder="场景名 (从上面参考表选, 仅字母/数字/_/-)" style="flex:1">
      <button type="button" class="btn" data-cpu-add-ok style="flex:none;padding:5px 12px;font-size:var(--fs-xs)">确定</button></div>`; /* 只渲染配置里实际存在的场景 */
    if (sceneNames.length) {
      sceneNames.forEach(s => {
        const sc2 = cpu[s]; if (!sc2 || typeof sc2 !== 'object') return; if (!/^[A-Za-z0-9_-]+$/.test(s)) {
          html += `<details class="cf-gp"><summary>◈ ${escapeHTML(s)}</summary><div class="cf-gp-body"><div class="cf-hint">场景名含特殊字符, 表单不支持编辑, 请用高级版文本修改</div></div></details>`; return; }
        const ref = SCENE_REF.find(([n]) => n === s); const label = ref ? ref[1] : s; html += `<details class="cf-gp"><summary>◈ ${escapeHTML(label)}${label === s ? '' : ' (' + escapeHTML(s) + ')'}</summary><div class="cf-gp-body">`; html += fieldRow('ccBoost', 'cpu.' + s + '.boost', gv(sc2, 'boost')); html += fieldRow('ccTime', 'cpu.' + s + '.time', gv(sc2, 'time')); html += `</div></details>`; }); } else {
      html += `<div class="cf-hint">暂无场景, 点"添加场景"从参考表中选择</div>`; }
  }

  /* ── gpa_config (帧率档位) ──
     可编辑: 频率上下限 + 调频算法/温控配套(官方高频键) + core + es4g 全部 + mema 全部 */
  if (fpsList.length) {
    html += `<div class="cf-sec">gpa_config (${flatGpa ? '全局配置' : '帧率档位'})</div>`; html += `<div class="cf-hint">${flatGpa ? '当前官方配置未按 60/90/120 分档, 以下为全局 GPA 参数' : '帧率档位: 60/90/120 等 · 频点索引: -1=禁用, 从 0 起对应各频点'} · 只显示核心上下限, core, es4g, mema</div>`; fpsList.forEach(fps => {
      const g = flatGpa ? gpa : (gpa[fps] || {}); const gp = flatGpa ? '' : fps + '.'; html += `<details class="cf-gp"${firstOpen(fps)}><summary>◆ ${escapeHTML(fpsLabel(fps))}</summary><div class="cf-gp-body">`; /* 仅编辑核心频率上下限 + 开关核心 */
      html += fieldRow('cl', 'gpa.' + gp + 'cl', gv(g, 'cl')); html += fieldRow('ch', 'gpa.' + gp + 'ch', gv(g, 'ch')); html += fieldRow('sm', 'gpa.' + gp + 'sm', gv(g, 'sm')); html += fieldRow('gf', 'gpa.' + gp + 'gf', gv(g, 'gf')); html += fieldRow('gm', 'gpa.' + gp + 'gm', gv(g, 'gm')); html += fieldRow('tl', 'gpa.' + gp + 'tl', gv(g, 'tl')); html += fieldRow('th', 'gpa.' + gp + 'th', gv(g, 'th')); html += fieldRow('core', 'gpa.' + gp + 'core', gv(g, 'core')); /* es4g: 没有配置也显示添加入口 */
      {
        const es4g = g.es4g && typeof g.es4g === 'object' ? g.es4g : null; html += `<div class="cf-fps">▸ es4g (蜂鸟核心隔离)<span style="flex:1"></span><button type="button" class="btn" data-gpa-add="es4g" data-gpa-fps="${escapeHTML(fps)}" style="padding:4px 10px;font-size:var(--fs-xs)">${es4g ? '已有' : '添加'}</button></div>`; if (es4g) {
          html += fieldRow('es4gIsolate', 'gpa.' + gp + 'es4g.isolate', gv(es4g, 'isolate')); html += fieldCheck('es4gState', 'gpa.' + gp + 'es4g.state', !!gv(es4g, 'state')); html += fieldRow('es4gTcount', 'gpa.' + gp + 'es4g.tcount', gv(es4g, 'tcount')); html += fieldRow('es4gClist', 'gpa.' + gp + 'es4g.clist', gv(es4g, 'clist')); html += fieldRow('es4gFps', 'gpa.' + gp + 'es4g.fps', gv(es4g, 'fps')); html += fieldRow('es4gDelay', 'gpa.' + gp + 'es4g.delay', gv(es4g, 'delay')); html += fieldCheck('es4gPartial', 'gpa.' + gp + 'es4g.partial', !!gv(es4g, 'partial')); }
      }
      /* mema: 没有配置也显示添加入口; 全局 beta/mode/tl + custom */
      {
        const mema = g.mema && typeof g.mema === 'object' ? g.mema : null; html += `<div class="cf-fps">▸ mema (内存带宽调频)<span style="flex:1"></span><button type="button" class="btn" data-gpa-add="mema" data-gpa-fps="${escapeHTML(fps)}" style="padding:4px 10px;font-size:var(--fs-xs)">${mema ? '已有' : '添加'}</button></div>`; if (mema) {
          html += `<div class="cf-fps" style="font-size:var(--fs-xs)">全局</div>`; html += fieldRow('memaBeta', 'gpa.' + gp + 'mema.beta', gv(mema, 'beta')); html += fieldRow('memaMode', 'gpa.' + gp + 'mema.mode', gv(mema, 'mode')); html += fieldRow('memaTl', 'gpa.' + gp + 'mema.tl', gv(mema, 'tl')); if (mema.custom !== undefined) {
            html += `<div class="cf-fps" style="font-size:var(--fs-xs)">custom (按簇覆盖)</div>`; html += `<div class="cf-field"><div class="cf-fl"><span class="cf-key">custom</span><span class="cf-name">按核段覆盖</span><span class="cf-q">?</span></div></div>
              <textarea class="inp cf-json" id="gpa.${gp}mema.custom" rows="4" spellcheck="false" placeholder='JSON对象, 如 {"0-1":"60,1","5-6":"60,1"}'>${escapeHTML(JSON.stringify(mema.custom, null, 1))}</textarea>`; } else {
            /* custom 需手写, 提供手动添加入口 */
            html += `<div class="cf-fps" style="font-size:var(--fs-xs)">custom (按簇覆盖)<span style="flex:1"></span><button type="button" class="btn" data-mema-custom-add data-gpa-fps="${escapeHTML(fps)}" style="padding:4px 10px;font-size:var(--fs-xs)">添加</button></div>`; }
        }
      }
      html += `</div></details>`; }); } else {
    html += `<div class="empty-tip">该配置没有 gpa_config 档位</div>`; }

  /* ── game_config (游戏期加速控制; 只可改 cht_boost_max / cht_boost_min / ctn / ctep) ── */
  {
    const gc = (obj.game_config && typeof obj.game_config === 'object') ? obj.game_config : null; const hasGc = gc && Object.keys(gc).length; html += `<div class="cf-sec">game_config (游戏期加速控制)`; if (!hasGc) {
      html += `<span style="flex:1"></span><button type="button" class="btn" data-gc-add style="flex:none;padding:5px 12px;font-size:var(--fs-xs)">添加</button></div>`; html += `<div class="cf-hint">有的游戏配置没有 game_config, 可点击添加 (只可编辑 cht_boost_max / cht_boost_min / ctn / ctep, 其余键只读保留)</div>`; } else {
      html += `</div>`; html += `<div class="cf-hint">只可编辑 cht_boost_max / cht_boost_min / ctn / ctep · 其余键只读 · 保存到 cccf 时 from_server 自动置 0</div>`; html += `<details class="cf-gp" open><summary>◈ 可编辑</summary><div class="cf-gp-body">`; html += fieldRow('gcBoostMax', 'game_config.cht_boost_max', gv(gc, 'cht_boost_max')); html += fieldRow('gcBoostMin', 'game_config.cht_boost_min', gv(gc, 'cht_boost_min')); html += fieldRow('gcCtn', 'game_config.ctn', gv(gc, 'ctn')); html += fieldRow('gcCtep', 'game_config.ctep', gv(gc, 'ctep')); html += `</div></details>`; const roKeys = Object.keys(gc).filter(k => !['cht_boost_max', 'cht_boost_min', 'ctn', 'ctep'].includes(k)).sort(); if (roKeys.length) {
        html += `<details class="cf-gp"><summary>◈ 只读 (官方参数)</summary><div class="cf-gp-body">`; roKeys.forEach(k => {
          const v = gc[k]; const vs = (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); html += `<div class="cf-field"><div class="cf-fl"><span class="cf-key">${escapeHTML(k)}</span></div><span class="cf-ro">${escapeHTML(vs)}</span></div>`; }); html += `</div></details>`; }
    }
  }

  const fstab = obj.fps_stabilizer || {}; if (fstab && Object.keys(fstab).length) {
    html += `<div class="cf-sec">fps_stabilizer (掉帧急救队)</div>`; html += fieldRow('fsBoostStep', 'fps_stabilizer.boostStep', gv(fstab, 'boostStep')); html += fieldRow('fsFreqStep', 'fps_stabilizer.freqStep', gv(fstab, 'freqStep')); html += fieldRow('fsTemp', 'fps_stabilizer.temp', gv(fstab, 'temp')); html += fieldRow('fsMode', 'fps_stabilizer.mode', gv(fstab, 'mode')); if (gv(fstab, 'boostTime') !== null) html += fieldRow('fsBoostTime', 'fps_stabilizer.boostTime', gv(fstab, 'boostTime')); if (gv(fstab, 'coldDelay') !== null) html += fieldRow('fsColdDelay', 'fps_stabilizer.coldDelay', gv(fstab, 'coldDelay')); if (gv(fstab, 'hotDelay') !== null) html += fieldRow('fsHotDelay', 'fps_stabilizer.hotDelay', gv(fstab, 'hotDelay')); }

  /* ── game_zone (关键线程识别与绑核) ── */
  if (Object.keys(gz).length) {
    html += `<div class="cf-sec">game_zone (关键线程绑定)</div>`; html += `<details class="cf-gp" open><summary>◈ 标量参数</summary><div class="cf-gp-body">`; html += fieldRow('gzRecognize', 'gz.recognize_interval', gv(gz, 'recognize_interval')); html += fieldRow('gzWakeUp', 'gz.wake_up_times', gv(gz, 'wake_up_times')); html += fieldRow('gzKeyUx', 'gz.key_thread_ux', gv(gz, 'key_thread_ux')); html += fieldRow('gzKeyWorkerUx', 'gz.key_worker_ux', gv(gz, 'key_worker_ux')); html += fieldRow('gzWhiteListUx', 'gz.white_list_ux', gv(gz, 'white_list_ux')); html += fieldRow('gzSearchWhite', 'gz.search_white_list', gv(gz, 'search_white_list')); if (gz.fixed_critical_task !== undefined) {
      if (typeof gz.fixed_critical_task === 'object') html += `<div class="cf-field"><div class="cf-fl"><span class="cf-key">fixed_critical_task</span><span class="cf-name">固定关键任务</span><span class="cf-q">?</span></div></div><textarea class="inp cf-json" id="gz.fixed_critical_task" rows="3" spellcheck="false">${escapeHTML(JSON.stringify(gz.fixed_critical_task))}</textarea>`; else html += fieldRow('gzFixedCritical', 'gz.fixed_critical_task', gz.fixed_critical_task); }
    html += fieldRow('gzBindCore', 'gz.bind_core', gv(gz, 'bind_core')); html += `</div></details>`; html += `<details class="cf-gp"><summary>◈ white_list (线程白名单)</summary><div class="cf-gp-body">`; html += `<textarea class="inp cf-json" id="gz.white_list" rows="4" spellcheck="false" placeholder='JSON数组, 如 ["tmgp.sgame","UnityChoreograp"]'>${escapeHTML(gz.white_list === undefined ? '' : JSON.stringify(gz.white_list))}</textarea>`; html += `</div></details>`; html += `<details class="cf-gp"><summary>◈ bind_list (线程绑核表)</summary><div class="cf-gp-body">`; html += `<textarea class="inp cf-json" id="gz.bind_list" rows="6" spellcheck="false" placeholder='JSON对象, 如 {"UnityMain":"g_11","Job.worker 0":"p_10"}'>${escapeHTML(gz.bind_list === undefined ? '' : JSON.stringify(gz.bind_list))}</textarea>`; html += `</div></details>`; html += `<details class="cf-gp"><summary>◈ pipeline (渲染管线)</summary><div class="cf-gp-body">`; html += `<textarea class="inp cf-json" id="gz.pipeline" rows="4" spellcheck="false" placeholder='JSON对象, 如 {"7":"UnityMain","5":"__render__"}'>${escapeHTML(gz.pipeline === undefined ? '' : JSON.stringify(gz.pipeline))}</textarea>`; html += `</div></details>`; if (gz.system_process !== undefined || gz.system_server !== undefined) {
      html += `<details class="cf-gp"><summary>◈ system (系统进程/服务)</summary><div class="cf-gp-body">`; if (gz.system_process !== undefined)
        html += `<textarea class="inp cf-json" id="gz.system_process" rows="2" spellcheck="false" placeholder='JSON数组'>${escapeHTML(JSON.stringify(gz.system_process))}</textarea>`; if (gz.system_server !== undefined)
        html += `<textarea class="inp cf-json" id="gz.system_server" rows="2" spellcheck="false" placeholder='JSON数组'>${escapeHTML(JSON.stringify(gz.system_server))}</textarea>`; html += `</div></details>`; }
  }

  /* ── thermal_frame (温控降帧) ──
     统一标准格式 { balance_nl, highperf_nl, ternary:false }: 一代格式 (tt/phase/param/mg/mgc) 的 param 会逐档压帧率下限, mg 会在高温时强制退档掉帧, 故保存时整档替换为标准 NL 曲线 (只按温度降目标帧率, 不压频率下限) */
  {
    const TF_STD = {
      60: { balance_nl: '50,45,52,30', highperf_nl: '53,45,55,30' }, 90: { balance_nl: '49,60,51,45', highperf_nl: '52,60,54,45' }, 120: { balance_nl: '48,90,50,60', highperf_nl: '51,90,53,60' }, 144: { balance_nl: '47,120,49,90', highperf_nl: '50,120,52,90' }, }; const tfFps = Object.keys(tf).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)); html += `<div class="cf-sec">thermal_frame (温控降帧)<span style="flex:1"></span><button type="button" class="btn" data-tf-reset style="flex:none;padding:5px 12px;font-size:var(--fs-xs)">重置</button></div>`; html += `<div class="cf-hint">统一标准格式: balance_nl / highperf_nl / ternary=false · NL曲线=成对(温度档,目标帧率) · 一代 tt/param/mg 格式保存时自动转换 · 重置=全部档位恢复官方默认值</div>`; const tfItems = tfFps.length ? tfFps : Object.keys(TF_STD); tfItems.forEach(fps => {
      const std = TF_STD[fps]; const cur = tf[fps] || {}; const bal = (typeof cur.balance_nl === 'string' && cur.balance_nl) ? cur.balance_nl : (std ? std.balance_nl : ''); const hi = (typeof cur.highperf_nl === 'string' && cur.highperf_nl) ? cur.highperf_nl : (std ? std.highperf_nl : ''); /* ternary 固定 false, 不可修改 (只读展示) */
      const info = FI.tfTernary || { k: 'ternary', n: '', t: '' }; html += `<details class="cf-gp"><summary>◆ ${escapeHTML(fps)}Hz</summary><div class="cf-gp-body">`; html += fieldRow('tfBalance', 'tf.' + fps + '.balance_nl', bal); html += fieldRow('tfHighperf', 'tf.' + fps + '.highperf_nl', hi); html += `<div class="cf-field"><div class="cf-fl"><span class="cf-key">${info.k}</span>${info.n ? '<span class="cf-name">' + info.n + '</span>' : ''}</div>
        <span class="cf-ro">false (固定)</span></div>`; html += `</div></details>`; }); window._tfStd = TF_STD; /* 重置按钮用 */
  }

  form.innerHTML = html;
}

/* 表单 id → 对象路径 (gpa./tf./cpu./gz. 前缀映射到真实区块名; 其余原样) */
function realIdPath(id) {
  return id
    .replace(/^gpa\.(__global__\.)?/, 'gpa_config.')
    .replace(/^tf\./, 'thermal_frame.')
    .replace(/^cpu\./, 'cpu_config.')
    .replace(/^gz\./, 'game_zone.');
}

/* 从表单收集 → 写回对象 (原字符串字段保持字符串类型; 空输入保留该键并写空串, 不删除) */
function collectBaseForm() {
  if (!_baseObj) return null; const obj = _baseObj; document.querySelectorAll('#cf-base-form input[id]').forEach(el => {
    const id = el.id; const isGpa = id.startsWith('gpa.'), isTf = id.startsWith('tf.'), isFs = id.startsWith('fps_stabilizer.'); const isCpu = id.startsWith('cpu.'), isGz = id.startsWith('gz.'), isGc = id.startsWith('game_config.'); if (!isGpa && !isTf && !isFs && !isCpu && !isGz && !isGc) return; if (el.tagName === 'TEXTAREA') return; /* JSON 域在下方 textarea 统一处理 */
    const existed = _baseExisted.has(id) || (isFs && gv(obj, id) !== null); const orig = _baseOrig[id]; let val; if (el.type === 'checkbox') {
      if (!el.checked && !existed) return; /* 未勾选且原本没有 → 不新增 */
      val = el.checked; } else {
      const t = el.value.trim(); if (t === '') {
        if (!existed) return; /* 原本没有该键 → 不新增 */
        if (orig === null) return; /* 原值为 null → 原样保留 */
        /* 可选参数为空 → 删掉这一行 (只删叶子; cpu_config/gpa_config/es4g 等大纲容器不受影响) */
        delPath(obj, realIdPath(id)); return; } else if (existed && typeof orig === 'string') val = t; /* 保持字符串 */
      else if (/^-?\d+$/.test(t)) val = parseInt(t, 10); else val = t; }
    if (isGpa) {
      const path = id.slice(4); sv(obj, 'gpa_config.' + path, val); } else if (isTf) sv(obj, 'thermal_frame.' + id.slice(3), val); else if (isCpu) sv(obj, 'cpu_config.' + id.slice(4), val); else if (isGz) sv(obj, 'game_zone.' + id.slice(3), val); else if (isGc) sv(obj, id, val); else sv(obj, id, val); /* fps_stabilizer.* — id 即对象路径 */
  }); /* JSON 编辑域 (textarea): game_zone.* / gpa.*.es4g.* / gpa.*.mema.* / tf.* 对象值等, 留空=不改动, 非空必须合法 JSON */
  document.querySelectorAll('#cf-base-form textarea[id]').forEach(el => {
    const id = el.id; const t = el.value.trim(); if (t === '') return; try { sv(obj, realIdPath(id), JSON.parse(t)); }
    catch (e) {
      if (e instanceof SyntaxError) throw new Error(id + ' 不是合法JSON: ' + e.message); throw e; }
  }); /* thermal_frame 标准化: 一律替换为 { balance_nl, highperf_nl, ternary:false } 三键格式
     (丢弃 tt/phase/param/mg/mgc 等旧写法 — 一代格式会压帧率下限/高温强制退档掉帧); ternary 固定 false 不可修改; 两曲线都为空且无官方默认的档位不落盘 */
  if (obj.thermal_frame === undefined || obj.thermal_frame === null || typeof obj.thermal_frame !== 'object') obj.thermal_frame = {}; const std = window._tfStd || {}; const newTf = {}; document.querySelectorAll('#cf-base-form input[id^="tf."], #cf-base-form textarea[id^="tf."]').forEach(el => {
    const m = el.id.match(/^tf\.([^.]+)\.(balance_nl|highperf_nl)$/); /* [^.]+: 165 等非标档位不丢 */
    if (!m) return; const fps = m[1], key = m[2]; const t = el.value.trim(); const d = (std[fps] || {})[key]; const v = t !== '' ? t : (d || ''); if (v === '') return; newTf[fps] = newTf[fps] || { ternary: false }; newTf[fps][key] = v; }); if (Object.keys(newTf).length) obj.thermal_frame = newTf; /* cpu_config 场景清理: boost 为空的场景没有意义 → 删掉该场景; 场景全没了 → cpu_config 置空
     (只改场景与 cpu_config 本身, 不碰其它大纲结构) */
  if (obj.cpu_config && typeof obj.cpu_config === 'object') {
    Object.keys(obj.cpu_config).forEach(s => {
      const sc = obj.cpu_config[s]; if (!sc || typeof sc !== 'object') return; /* 非对象值不动 */
      const b = sc.boost; if (b === undefined || b === null || String(b).trim() === '') delete obj.cpu_config[s]; }); if (!Object.keys(obj.cpu_config).length) obj.cpu_config = ''; }
  return obj;
}
