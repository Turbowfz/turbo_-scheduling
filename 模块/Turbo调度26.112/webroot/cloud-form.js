/* ── 云控页 · 基础版表单层: 参数注释表 / 表单渲染 / 表单收集 ──
   依赖 core.js (escapeHTML); 依赖 cloud-io.js 的运行期存在 (_baseObj 挂 window)
   参数依据: 6.1云控配置参数解析.jsonc (骁龙8Gen3/ACE3Pro) + 全机型官方云控配置普查 */

/* 状态挂 window: 经典 script 全局词法绑定与 window 属性互通, 便于跨脚本/测试访问 */
window._baseObj = null; /* 基础版当前编辑的游戏配置对象 */
window._baseOrig = {}; /* id -> 原始值 (类型保持) */
window._baseExisted = new Set(); /* 配置里原本就存在的字段路径 */

/* ═══════════ 参数注释表 ═══════════
   依据: 6.1云控配置参数解析.jsonc (骁龙8Gen3/ACE3Pro) —— 反编译实锤 + 全机型官方云控普查
   簇的顺序(全文通用): 小核=CPU0-1 · 大核=CPU2-4 · 中核=CPU5-6 · 超大核=CPU7
   档位(全文通用): 该簇频率表的下标(从 0 起, 由低到高), -1 通常=自动/不限制
   命名口诀: s=小核 c=大核 t=中核 g=超大核; l/f=下限 h/m=上限                        */
const FI = {
  /* ── gpa_config 频率围栏 (调频大脑按"目标负载"算频, 这里给它套上下限围栏) ── */
  cl: { k: 'cl', n: '大核频率下限', t: '大核(CPU2-4)保底档: 游戏突然闲下来也不许掉到它以下, 防"刚降频就又来活"的第一波卡顿. -1=不保底, 数越小越省电越容易卡' },
  ch: { k: 'ch', n: '大核频率上限', t: '大核(2-4)封顶档: 再忙也不许冲过它, 用来控功耗控发热. -1=不封顶' },
  sm: { k: 'sm', n: '小核频率上限', t: '小核(0-1)单独封顶: 小核干不了重活, 压低它纯省电 (小核共18档 0~17, 官方常用 12)' },
  gf: { k: 'gf', n: '超大核频率下限', t: '超大核(CPU7)保底档: 防止"活都派给大核、超大核在旁边躺平", 抬底频让单核爆发更稳 (官方常用 7)' },
  gm: { k: 'gm', n: '超大核频率上限', t: '超大核(7)封顶档 (共35档 0~34). 超大核最费电, 温度高时优先压这里' },
  tl: { k: 'tl', n: '中核频率下限', t: '中核(5-6)保底档: 中核是主力核, 抬底频对稳定感最明显. -1=自动 (共32档 0~31)' },
  th: { k: 'th', n: '中核频率上限', t: '中核(5-6)封顶档: 中核一般跑系统杂活, 压低它不影响游戏主体' },
  core: { k: 'core', n: '核心参与表', t: '逗号 8 值对应 8 颗核: 1=这颗核允许参与关键任务调度, -1=不限制/默认 (解析默认全 -1)' },
  /* ── gpa_config.es4g 关键线程隔离 (给游戏最要命的几个线程圈专属包厢) ── */
  es4gState: { k: 'es4g state', n: '蜂鸟总开关', t: 'true=进游戏启用关键线程隔离, 本块其它设置随之生效' },
  es4gIsolate: { k: 'es4g isolate', n: '隔离核表', t: '10 进制掩码, 第 N 位=CPU N, 如 144=0b10010000=CPU4+CPU7. 最多 3 个值, 强度递增: ①核上有任务也照抢 ②高优先任务来抢时才隔离 ③绝对隔离(闲着也不给别人)' },
  es4gClist: { k: 'es4g clist', n: '关键线程选核顺序', t: '选核顺序表(最多 8 位): 关键线程在清单里排第几, 就取这里第几个核, 如 "4,7,3,2"' },
  es4gTcount: { k: 'es4g tcount', n: '隔离线程数', t: '要隔离的关键线程个数 (解析另有 taskCount 同义字段), 官方值 4' },
  es4gFps: { k: 'es4g fps', n: '生效帧率', t: '这段隔离策略只在游戏跑这个帧率时生效 (填 60/90/120 等)' },
  es4gDelay: { k: 'es4g delay', n: '延迟启用(ms)', t: '进游戏先别圈地, 等加载完、线程都冒头了再生效 (官方 30000=30 秒)' },
  es4gPartial: { k: 'es4g partial', n: '允许外迁', t: 'true=区外线程可迁到别的核(动态腾地方); false=死守隔离区' },
  /* ── gpa_config.mema (multi-ema 调频大脑: EMA 平滑负载毛刺后再换算频率) ── */
  memaBeta: { k: 'mema beta', n: 'EMA 平滑系数', t: '决定"新采样"和"历史平均"各占多大权重, 官方默认 45; custom 里可按核段单独覆盖' },
  memaMode: { k: 'mema mode', n: '簇内负载合并', t: '一簇多核怎么合成一个数: 0=取最大(一颗忙就当整簇忙, 最激进) 1=取平均 2=取中位数(抗个别核抽风, 最稳). 官方 2' },
  memaTl: { k: 'mema tl', n: '目标负载表', t: '每两个数一组=(util 分段点 0..1024 递增, 该段目标负载%), 官方 "0,80,300,90". 目标负载越低=要求留的余量越大=算出的频率越高=越流畅越费电' },
  /* ── game_config 关键/重任务提频 (CHTB; 触发后真正把频率抬起来的是 min 不是 max) ── */
  gcBoostMax: { k: 'cht_boost_max', n: '提频天花板(只解封)', t: '(CPU号,档位)对, 如 "0,17,4,24,5,19,7,30". 内核只把它进 FREQ_QOS_MAX 且取 max(原上限,它) —— 作用是把被 GPA/温控压低的封顶抬起来, 它自己不会让频率跳' },
  gcBoostMin: { k: 'cht_boost_min', n: '提频地板(真提频)', t: '(CPU号,档位)对, 与 max 配套. 内核进 FREQ_QOS_MIN 且 final_min=max(原下限,它) —— 触发后频率"跳上去"靠的是它; 两个一起生效=给该 CPU 一个频率窗口[min, max(原上限,max)]' },
  gcCtn: { k: 'ctn', n: '关键线程名单', t: '线程名, 多个用空格隔开 → critical_task_name, 命中即当关键线程照顾' },
  gcCtep: { k: 'ctep', n: '触发阈值(%)', t: '关键线程的 CPU 时间占比超过它才出手提频 → expire_time_percentage, 官方 90; 调低=更容易触发=更激进' },
  /* ── thermal_frame 温控降帧 (每个帧率档一条策略; _nl=温度→帧率折线, 温度是直接 °C) ── */
  tfBalance: { k: 'balance_nl', n: '均衡NL曲线', t: '均衡档"温度→帧率"折线, 成对写(温度°C, 目标帧率): "44,90,46,60"=44°C 还有 90 帧、46°C 就只给 60 帧' },
  tfHighperf: { k: 'highperf_nl', n: '高性能NL曲线', t: '高性能档折线, 能撑到更高温才开始降, 如 "48,55,49,50,50,45,51,35"' },
  tfTernary: { k: 'ternary', n: '三段式降帧', t: '官方解析默认 1(把降温过程分三段走更平顺); 本工具固定 false —— 一代 tt/param/mg 格式会逐档压帧率下限, 关掉更温和' },
  /* ── fps_stabilizer 帧率稳定器 (温度过线后按阶梯一级级加压; earlyDetect 提前救帧) ── */
  fsBoostStep: { k: 'boostStep', n: '提频倍数阶梯', t: '先按 1.1 倍帧预算提频, 不够再 1.3、1.5, 一级一级加码, 官方 "1.1,1.3,1.5"' },
  fsFreqStep: { k: 'freqStep', n: '各簇档位阶梯', t: '与 boostStep 配套: 进第几级提速就套用对应那一组各簇的(上限档,下限档)对; 8G3 常为 3 级×4 簇=24 个数, 个数不对整条不生效' },
  fsTemp: { k: 'temp', n: '介入温度', t: '×10 (500=50.0°C): 到这个温度才开始靠提频救帧, 解析默认 500' },
  fsBoostTime: { k: 'boostTime', n: '单级保持(秒)', t: '每级 boost 保持多久, 到点自动回落 (官方 70)' },
  fsMode: { k: 'mode', n: '推进模式', t: '"ddl"=按帧 Deadline 推进(快超时就加码, 解析默认) / "step"=纯步进' },
  fsColdDelay: { k: 'coldDelay', n: '冷启动延迟(秒)', t: '冷启动阶段的延迟参数 (解析默认 0)' },
  fsHotDelay: { k: 'hotDelay', n: '热状态延迟(秒)', t: '热状态下延迟多久再动作 (官方 20)' },
  /* ── cpu_config 场景化提频 (加载/跳伞这类"大家都知道会卡"的瞬间按围栏钉一段时间) ── */
  ccBoost: { k: 'boost', n: '频率围栏串', t: '8 个数两两一组=(上限档,下限档), 按 小核→大核→中核→超大核 套用: "12,6,23,5,16,5,25,7"=小核[6..12] 大核[5..23] 中核[5..16] 超大核[7..25]; 空=这个场景用系统默认提速, 不围栏' },
  ccTime: { k: 'time', n: '围栏保持(ms)', t: '到点自动撤销还给 gpa_config; 太短没效果, 太长费电 (官方常用 10000~60000)' },
  /* ── game_zone 关键线程点名册 (每 8 秒扫一遍线程, 认出来就提权/绑核) ── */
  gzRecognize: { k: 'recognize_interval', n: '识别周期(ms)', t: '每 8 秒(8000)重扫一遍线程名单; 调小反应快, 调大省开销' },
  gzWakeUp: { k: 'wake_up_times', n: '唤醒次数门槛', t: '一段时间内醒来至少这么多次的线程才值得优待; 不写时按 alive 周期自动换算 (10×周期秒/1000)' },
  gzKeyUx: { k: 'key_thread_ux', n: '关键线程UX', t: '认出来的关键线程打几级 ux 标签(等级越高调度器越偏心: 优先派核、优先提频), 官方常用 2, 解析默认 -1' },
  gzKeyWorkerUx: { k: 'key_worker_ux', n: 'worker线程UX', t: '线程池 worker 类关键线程的 ux 等级, 官方常用 2' },
  gzWhiteListUx: { k: 'white_list_ux', n: '白名单线程UX', t: 'white_list 命中线程的 ux 等级, 官方常用 2' },
  gzSearchWhite: { k: 'search_white_list', n: '白名单匹配强度', t: '白名单匹配深度/数量一类, 官方常用 25, 解析默认 8' },
  gzFixedCritical: { k: 'fixed_critical_task', n: '固定关键任务', t: '名单上的直接当关键线程(不用等识别打分); n_ 前缀=按名字模糊匹配, 如 ["n___render__","n_Thread-"]' },
  gzBindCore: { k: 'bind_core', n: '绑核配置', t: '绑核配置串, 官方多为空; 配套开关见 bind_main(游戏主线程也参与绑核) / bind_extend(扩展策略代号)' },
  gzWhiteList: { k: 'white_list', n: '线程白名单', t: 'JSON数组: 名单上的线程名无条件优待(不用等识别)' },
  gzBindList: { k: 'bind_list', n: '绑核表', t: '线程名→核组编号. 8G3 实测: g_1:0-1小核 g_2:2-4大核 g_3:5-6中核 g_4:7超大核 g_5:2-4+7 g_6:2-6 g_7:5-7 g_8:0-1+5-6 g_9:2-7; p_ 十六进制掩码(p_1c=CPU2-4), 与 g_ 写法等价' },
  gzPipeline: { k: 'pipeline', n: '渲染管线', t: 'JSON对象 核号→线程名前缀: 匹配上的线程直接安置到这颗核, 如 {"7":"Thread-","4":"__render__"}; 解析器还认识预设槽名 NativeThread/AudioTrack/UnityChoreograp/UnityMultiRende/CoreThread/Compute/TaskGraph/PoolThread' },
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
      ['start', '点图标启动', '点图标冷启动阶段, 官方常用 (time 1500~30000)'], ['loading', '加载', '读盘加载阶段, 官方最常见 (time 5000~14000)'], ['logging', '战斗日志', '战斗日志阶段〔支〕'], ['sceneswitch', '进出对局/传送', '进出对局、传送读图 (原神/星铁, time 10000~20000)'], ['tuanzhan', '团战', '团战阶段 (王者)'], ['battle', '战斗', '战斗阶段'], ['rolefreeze', '选人定格', '选人/选角色时定格 (原神)'], ['parachute', '开伞滑翔', '开伞滑翔阶段 (和平精英, time 60000)'], ['drive', '开车', '驾驶阶段 (和平精英)'], ['landing', '跳伞落地', '跳伞/落地瞬间, 人最多最容易卡 (和平精英, time 30000)'], ['chooserole', '选角色', '选角色阶段'], ['tcg', '卡牌对战', '原神七圣召唤'], ['abypass', '深渊', '原神深渊副本'], ['overload', '过载', '过载场景'], ]; const sceneNames = Object.keys(cpu).sort(); html += `<div class="cf-sec">cpu_config (场景化提频)<span style="flex:1"></span><button type="button" class="btn" data-cpu-add style="flex:none;padding:5px 12px;font-size:var(--fs-xs)">添加场景</button></div>`; html += `<div class="cf-hint">boost=频率围栏 (8 个数两两一组=(上限档,下限档), 按 小核→大核→中核→超大核; 空=这个场景用系统默认提速, 不围栏) · time=围栏保持(ms), 到点自动撤销还给 gpa_config · 场景由你手动添加</div>`; /* 官方场景名参考 (可折叠; 标出已添加) */
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
    html += `<div class="cf-sec">gpa_config (${flatGpa ? '全局配置' : '帧率档位'})</div>`; html += `<div class="cf-hint">${flatGpa ? '当前官方配置未按 60/90/120 分档, 以下为全局 GPA 参数' : '帧率档位: 60/90/120 等 · 档位=该簇频率表下标(从 0 起, 由低到高), -1=自动/不限'} · 只显示核心上下限, core, es4g, mema</div>`; fpsList.forEach(fps => {
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
      html += `<span style="flex:1"></span><button type="button" class="btn" data-gc-add style="flex:none;padding:5px 12px;font-size:var(--fs-xs)">添加</button></div>`; html += `<div class="cf-hint">有的游戏配置没有 game_config, 可点击添加 (只可编辑 cht_boost_max / cht_boost_min / ctn / ctep, 其余键只读保留; 真正把频率抬起来的是 cht_boost_min, max 只解封天花板)</div>`; } else {
      html += `</div>`; html += `<div class="cf-hint">只可编辑 cht_boost_max / cht_boost_min / ctn / ctep · 其余键只读 · 真正把频率抬起来的是 min, max 只解封被压低的封顶 · 保存到 cccf 时 from_server 自动置 0</div>`; html += `<details class="cf-gp" open><summary>◈ 可编辑</summary><div class="cf-gp-body">`; html += fieldRow('gcBoostMax', 'game_config.cht_boost_max', gv(gc, 'cht_boost_max')); html += fieldRow('gcBoostMin', 'game_config.cht_boost_min', gv(gc, 'cht_boost_min')); html += fieldRow('gcCtn', 'game_config.ctn', gv(gc, 'ctn')); html += fieldRow('gcCtep', 'game_config.ctep', gv(gc, 'ctep')); html += `</div></details>`; const roKeys = Object.keys(gc).filter(k => !['cht_boost_max', 'cht_boost_min', 'ctn', 'ctep'].includes(k)).sort(); if (roKeys.length) {
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
    html += fieldRow('gzBindCore', 'gz.bind_core', gv(gz, 'bind_core')); html += `</div></details>`; html += `<details class="cf-gp"><summary>◈ white_list (线程白名单)</summary><div class="cf-gp-body">`;
    html += `<div class="cf-hint">${escapeHTML(FI.gzWhiteList.t)}</div>`; html += `<textarea class="inp cf-json" id="gz.white_list" rows="4" spellcheck="false" placeholder='JSON数组, 如 ["tmgp.sgame","UnityChoreograp"]'>${escapeHTML(gz.white_list === undefined ? '' : JSON.stringify(gz.white_list))}</textarea>`; html += `</div></details>`; html += `<details class="cf-gp"><summary>◈ bind_list (线程绑核表)</summary><div class="cf-gp-body">`;
    html += `<div class="cf-hint">${escapeHTML(FI.gzBindList.t)}</div>`; html += `<textarea class="inp cf-json" id="gz.bind_list" rows="6" spellcheck="false" placeholder='JSON对象, 如 {"UnityMain":"g_11","Job.worker 0":"p_10"}'>${escapeHTML(gz.bind_list === undefined ? '' : JSON.stringify(gz.bind_list))}</textarea>`; html += `</div></details>`; html += `<details class="cf-gp"><summary>◈ pipeline (渲染管线)</summary><div class="cf-gp-body">`;
    html += `<div class="cf-hint">${escapeHTML(FI.gzPipeline.t)}</div>`; html += `<textarea class="inp cf-json" id="gz.pipeline" rows="4" spellcheck="false" placeholder='JSON对象, 如 {"7":"UnityMain","5":"__render__"}'>${escapeHTML(gz.pipeline === undefined ? '' : JSON.stringify(gz.pipeline))}</textarea>`; html += `</div></details>`; if (gz.system_process !== undefined || gz.system_server !== undefined) {
      html += `<details class="cf-gp"><summary>◈ system (系统进程/服务)</summary><div class="cf-gp-body">`; if (gz.system_process !== undefined)
        html += `<textarea class="inp cf-json" id="gz.system_process" rows="2" spellcheck="false" placeholder='JSON数组'>${escapeHTML(JSON.stringify(gz.system_process))}</textarea>`; if (gz.system_server !== undefined)
        html += `<textarea class="inp cf-json" id="gz.system_server" rows="2" spellcheck="false" placeholder='JSON数组'>${escapeHTML(JSON.stringify(gz.system_server))}</textarea>`; html += `</div></details>`; }
  }

  /* ── thermal_frame (温控降帧) ──
     统一标准格式 { balance_nl, highperf_nl, ternary:false }: 一代格式 (tt/phase/param/mg/mgc) 的 param 会逐档压帧率下限, mg 会在高温时强制退档掉帧, 故保存时整档替换为标准 NL 曲线 (只按温度降目标帧率, 不压频率下限) */
  {
    const TF_STD = {
      60: { balance_nl: '50,45,52,30', highperf_nl: '53,45,55,30' }, 90: { balance_nl: '49,60,51,45', highperf_nl: '52,60,54,45' }, 120: { balance_nl: '48,90,50,60', highperf_nl: '51,90,53,60' }, 144: { balance_nl: '47,120,49,90', highperf_nl: '50,120,52,90' }, }; const tfFps = Object.keys(tf).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)); html += `<div class="cf-sec">thermal_frame (温控降帧)<span style="flex:1"></span><button type="button" class="btn" data-tf-reset style="flex:none;padding:5px 12px;font-size:var(--fs-xs)">重置</button></div>`; html += `<div class="cf-hint">统一标准格式: balance_nl / highperf_nl / ternary=false · NL曲线=成对(温度°C, 目标帧率), "44,90,46,60"=44°C 还有 90 帧、46°C 只给 60 帧 (温度就是 °C, 不是 ×10) · 一代 tt/param/mg 格式保存时自动转换 · 重置=全部档位恢复官方默认值</div>`; const tfItems = tfFps.length ? tfFps : Object.keys(TF_STD); tfItems.forEach(fps => {
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
