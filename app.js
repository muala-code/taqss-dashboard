(() => {
  "use strict";
  const cfg = window.TAQSS_CONFIG || {};
  function cloneMarkets(items) {
    return (Array.isArray(items) ? items : []).map(x => ({
      symbol: String(x?.symbol || "").trim(),
      name: String(x?.name || "").trim(),
      category: String(x?.category || "stock").trim(),
      enabled: x?.enabled !== false
    })).filter(x => x.symbol && x.name);
  }
  function initialMarkets() {
    return cloneMarkets(window.TAQSS_MARKETS || []);
  }
  let marketsCfg = initialMarkets();
  const activeMarkets = () => marketsCfg.filter(x => x.enabled !== false);
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let chart = null;
  let chartLoadVersion = 0;
  const loaded = new Set();
  const chartState = { monthYear: null, month: null, year: null };
  let selectedChartKind = "today-temp";
  const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

  const stationBase = () => String(cfg.stationApiBase || "").replace(/\/$/, "");
  const dashboardBase = () => String(cfg.dashboardApiBase || "").replace(/\/$/, "");
  const api = path => `${stationBase()}${path}`;

  function finite(v) { if(v===null||v===undefined||v==="")return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  function fmt(v, digits = 1) {
    const n = finite(v); return n === null ? "—" : n.toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }
  function marketCurrency(code) {
    if (code === "SAR") return "ر.س";
    if (code === "USD") return "$";
    return code || "";
  }
  function temperatureBand(value) {
    const n = finite(value);
    if (n === null) return "temp-neutral";
    if (n >= 40) return "temp-very-hot";
    if (n >= 35) return "temp-hot";
    if (n >= 22) return "temp-mild";
    return "temp-cold";
  }
  let lastCurrentTemperature = null;
  function styleCurrentTemperature(row, value) {
    if (!row) return;
    const dd = row.querySelector("dd");
    const band = temperatureBand(value);
    row.classList.add("current-temperature-row", band);
    if (dd) dd.classList.add("current-temperature-value");
    const n = finite(value);
    if (n !== null && lastCurrentTemperature !== null && Math.abs(n - lastCurrentTemperature) >= 0.05) {
      row.classList.add(n > lastCurrentTemperature ? "temperature-rise" : "temperature-fall");
    }
    lastCurrentTemperature = n;
  }
  function formatUpdateTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timeZone || "Asia/Riyadh",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(d);
    const o = {}; parts.forEach(p => { if (p.type !== "literal") o[p.type] = p.value; });
    return `${o.day}-${o.month}-${o.year}، ${o.hour}:${o.minute}`;
  }
  function dirName(deg) {
    const n = finite(deg); if (n === null) return "—";
    const dirs = ["شمال", "شمال شرقي", "شرق", "جنوب شرقي", "جنوب", "جنوب غربي", "غرب", "شمال غربي"];
    return dirs[Math.round((((n % 360) + 360) % 360) / 45) % 8];
  }
  function providerCondition(d) {
    const raw = d?.rawObservation || {};
    const c = d?.condition;
    const candidates = [
      typeof c === "string" ? c : null,
      c?.label, c?.phrase, c?.text,
      d?.wxPhraseLong, d?.wxPhraseMedium, d?.weatherPhrase,
      raw?.wxPhraseLong, raw?.wxPhraseMedium, raw?.weatherPhrase
    ];
    const value = candidates.find(v => typeof v === "string" && v.trim());
    if (!value) return "";
    const text = value.trim();
    const low = text.toLowerCase();
    const mappings = [
      [/thunder|storm/, "عواصف رعدية"],
      [/shower|rain/, "أمطار"],
      [/dust|sand/, "غبار"],
      [/fog|mist/, "ضباب"],
      [/wind/, "رياح"],
      [/partly cloudy|partly sunny/, "غائم جزئيًا"],
      [/mostly cloudy/, "غائم غالبًا"],
      [/cloudy|overcast/, "غائم"],
      [/clear|sunny|fair/, "صحو"]
    ];
    for (const [re, ar] of mappings) if (re.test(low)) return ar;
    return text;
  }
  function derivedCondition(d) {
    const temp = finite(d?.temperature);
    const wind = finite(d?.windSpeed);
    const gust = finite(d?.windGust);
    const raw = d?.rawObservation || {};
    const precipRate = finite(raw?.metric?.precipRate ?? raw?.imperial?.precipRate ?? d?.precipRate);
    const rain = finite(d?.rain);
    if ((precipRate !== null && precipRate > 0) || (rain !== null && rain > 0)) return "أمطار";
    if ((gust !== null && gust >= 50) || (wind !== null && wind >= 30)) return "رياح قوية";
    if (temp !== null) {
      if (temp >= 45) return "حار جدًا";
      if (temp >= 38) return "حار";
      if (temp <= 5) return "بارد جدًا";
      if (temp <= 14) return "بارد";
      if (temp >= 20 && temp <= 32) return "معتدل";
    }
    return "";
  }
  function weatherCondition(d) { return providerCondition(d) || derivedCondition(d); }
  function calculatedFeelsLike(d) {
    const direct = finite(d?.feelsLike);
    if (direct !== null) return direct;
    const t = finite(d?.temperature);
    const rh = finite(d?.humidity);
    const windKmh = finite(d?.windSpeed);
    if (t === null) return null;

    // Heat Index (Rothfusz/NWS) when conditions are warm enough.
    if (t >= 27 && rh !== null) {
      const f = t * 9 / 5 + 32;
      let hi = -42.379 + 2.04901523*f + 10.14333127*rh
        - 0.22475541*f*rh - 0.00683783*f*f - 0.05481717*rh*rh
        + 0.00122874*f*f*rh + 0.00085282*f*rh*rh
        - 0.00000199*f*f*rh*rh;
      if (rh < 13 && f >= 80 && f <= 112) {
        hi -= ((13-rh)/4) * Math.sqrt((17-Math.abs(f-95))/17);
      } else if (rh > 85 && f >= 80 && f <= 87) {
        hi += ((rh-85)/10) * ((87-f)/5);
      }
      const hiC = (hi - 32) * 5 / 9;
      if (Number.isFinite(hiC)) return hiC;
    }

    // Wind Chill (Environment Canada/NWS form) for cold, windy conditions.
    if (t <= 10 && windKmh !== null && windKmh >= 4.8) {
      const v16 = Math.pow(windKmh, 0.16);
      const wc = 13.12 + 0.6215*t - 11.37*v16 + 0.3965*t*v16;
      if (Number.isFinite(wc)) return wc;
    }
    return t;
  }
  function riyadhNowParts() {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timeZone || "Asia/Riyadh", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
    const o = {}; parts.forEach(p => { if (p.type !== "literal") o[p.type] = p.value; });
    return { year:Number(o.year), month:Number(o.month), day:Number(o.day) };
  }
  function stationStartParts() {
    const m = String(cfg.stationStartDate || "2026-06-05").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { year:Number(m[1]), month:Number(m[2]), day:Number(m[3]) } : { year:2026, month:6, day:5 };
  }
  function ensureChartState() {
    const now = riyadhNowParts();
    if (chartState.monthYear === null) chartState.monthYear = now.year;
    if (chartState.month === null) chartState.month = now.month;
    if (chartState.year === null) chartState.year = now.year;
  }
  function compareYearMonth(aYear, aMonth, bYear, bMonth) {
    return (aYear * 12 + aMonth) - (bYear * 12 + bMonth);
  }
  function periodType(kind) {
    if (kind.startsWith("month-")) return "month";
    if (kind.startsWith("year-")) return "year";
    return "none";
  }
  function updatePeriodNav(kind) {
    ensureChartState();
    const nav = $("#chartPeriodNav"), label = $("#chartPeriodLabel");
    const prev = $("#chartPrev"), next = $("#chartNext");
    const type = periodType(kind);
    if (type === "none") { nav.hidden = true; return; }
    nav.hidden = false;
    const now = riyadhNowParts(), start = stationStartParts();
    if (type === "month") {
      label.textContent = `${monthNames[chartState.month - 1]} ${chartState.monthYear}`;
      prev.disabled = compareYearMonth(chartState.monthYear, chartState.month, start.year, start.month) <= 0;
      next.disabled = compareYearMonth(chartState.monthYear, chartState.month, now.year, now.month) >= 0;
    } else {
      label.textContent = String(chartState.year);
      prev.disabled = chartState.year <= start.year;
      next.disabled = chartState.year >= now.year;
    }
  }
  function moveChartPeriod(delta) {
    const kind = selectedChartKind;
    const type = periodType(kind);
    ensureChartState();
    if (type === "month") {
      let y = chartState.monthYear, m = chartState.month + delta;
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
      chartState.monthYear = y; chartState.month = m;
    } else if (type === "year") {
      chartState.year += delta;
    }
    updatePeriodNav(kind);
    loadChart(kind);
  }
  async function getJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  }

  function updateStickyOffsets() {
    const tabs = document.querySelector(".tabs");
    const height = tabs ? Math.ceil(tabs.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--tabs-height", `${height}px`);
    // The prayer title is fixed, so size it against the visible panel's content box.
    const panel = document.querySelector("#panel-prayer");
    if (panel && !panel.hidden) {
      const rect = panel.getBoundingClientRect();
      document.documentElement.style.setProperty("--prayer-heading-left", `${rect.left}px`);
      document.documentElement.style.setProperty("--prayer-heading-width", `${rect.width}px`);
      const heading = document.querySelector(".prayer-secondary-sticky");
      if (heading) {
        document.documentElement.style.setProperty("--prayer-heading-height", `${Math.ceil(heading.getBoundingClientRect().height)}px`);
      }
    }
  }

  function addRow(dl, label, value) {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label; dd.textContent = value ?? "—";
    div.append(dt, dd); dl.appendChild(div);
    return div;
  }

  const labels = {
    stationID:"كود المحطة", obsTimeLocal:"وقت القراءة المحلي", obsTimeUtc:"وقت القراءة UTC", neighborhood:"الموقع في WU",
    softwareType:"نوع البرنامج/الجهاز", country:"الدولة", solarRadiation:"الإشعاع الشمسي", uv:"UV", winddir:"اتجاه الرياح",
    humidity:"الرطوبة", qcStatus:"حالة الجودة", realtimeFrequency:"تردد القراءة", lat:"خط العرض", lon:"خط الطول", epoch:"Epoch",
    temp:"الحرارة", heatIndex:"مؤشر الحرارة", windChill:"برودة الرياح", dewpt:"نقطة الندى", dewPoint:"نقطة الندى",
    windSpeed:"سرعة الرياح", windGust:"هبات الرياح", pressure:"الضغط", precipRate:"معدل المطر", precipTotal:"إجمالي المطر",
    elev:"الارتفاع"
  };
  const units = {
    temp:"°C", heatIndex:"°C", windChill:"°C", dewpt:"°C", dewPoint:"°C", windSpeed:" كم/س", windGust:" كم/س",
    pressure:" hPa", precipRate:" مم/س", precipTotal:" مم", humidity:"%", solarRadiation:" W/m²", uv:"", elev:" م"
  };
  function flatten(obj, prefix = "") {
    const out = [];
    if (!obj || typeof obj !== "object") return out;
    for (const [k,v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flatten(v, path));
      else if (!Array.isArray(v)) out.push([path, v]);
    }
    return out;
  }
  function labelFor(path) {
    const key = path.split(".").pop();
    if (path.startsWith("metric.")) return labels[key] || key;
    return labels[path] || labels[key] || path;
  }
  function valueFor(path, value) {
    if (value === null || value === undefined || value === "") return "—";
    const key = path.split(".").pop();
    if (key === "winddir") return `${fmt(value,0)}° · ${dirName(value)}`;
    if (typeof value === "number") return `${fmt(value, 2)}${units[key] || ""}`;
    return String(value);
  }

  let weatherRequest = null;
  let weatherLastAttempt = 0;
  async function loadWeather({silent = false} = {}) {
    if (weatherRequest) return weatherRequest;
    weatherLastAttempt = Date.now();
    weatherRequest = (async () => {
    const status = $("#weatherStatus"), dl = $("#weatherData"), connection = $("#stationConnection");
    $("#stationLocation").textContent = cfg.stationLocation || "—";
    if (!silent) {
      status.hidden = true; status.textContent = ""; dl.innerHTML = "";
      connection.className = "station-connection loading";
      connection.querySelector(".connection-text").textContent = "جارٍ التحقق من اتصال المحطة…";
    }
    try {
      const d = await getJson(api("/api/weather"));
      // Keep the existing readings visible until a successful replacement is ready.
      dl.replaceChildren();
      status.hidden = true; status.textContent = "";
      const connected = d.stationConnected !== false;
      const readAt = d.observedAt ? formatUpdateTime(d.observedAt) : "—";
      connection.className = `station-connection ${connected ? "connected" : "disconnected"}`;
      connection.querySelector(".connection-text").innerHTML = `${connected ? "المحطة متصلة" : "المحطة غير متصلة"} · <span class="connection-read-time">آخر قراءة: <span class="connection-read-time-value">${readAt}</span></span>`;

      // ترتيب منطقي سريع القراءة على الجوال.
      const condition = weatherCondition(d) || "—";
      addRow(dl, "🌤️ حالة الطقس الآن", condition);
      const currentTempRow = addRow(dl, "🌡️ الحرارة الحالية", `${fmt(d.temperature)} °C`);
      styleCurrentTemperature(currentTempRow, d.temperature);
      addRow(dl, "🌡️ المحسوسة", `${fmt(calculatedFeelsLike(d))} °C`);
      addRow(dl, "⬆️ العظمى اليوم", `${fmt(d.dayMax)} °C`);
      addRow(dl, "⬇️ الصغرى اليوم", `${fmt(d.dayMin)} °C`);
      addRow(dl, "🌫️ نقطة الندى", `${fmt(d.dewPoint)} °C`);
      addRow(dl, "💧 الرطوبة", `${fmt(d.humidity,0)}%`);
      addRow(dl, "🌡️ الضغط الجوي", `${fmt(d.pressure,1)} hPa`);
      const rainRow = addRow(dl, "🌧️ المطر", `${fmt(d.rain,2)} مم`);
      rainRow.classList.add("rain-row");
      addRow(dl, "💨 سرعة الرياح", `${fmt(d.windSpeed)} كم/س`);
      addRow(dl, "🌬️ الهبات", `${fmt(d.windGust)} كم/س`);
      addRow(dl, "🧭 اتجاه الرياح", d.windDirection === null || d.windDirection === undefined ? "—" : `${dirName(d.windDirection)} (${fmt(d.windDirection,0)}°)`);
      addRow(dl, "☀️ الإشعاع الشمسي", `${fmt(d.solarRadiation,0)} W/m²`);
      addRow(dl, "🟣 الأشعة فوق البنفسجية (UV)", fmt(d.uv,1));

      // إذا كان العامل يعيد حقول WU خامًا إضافية غير القائمة الأساسية، نعرض فقط الحقول غير المكررة.
      const raw = d.rawObservation;
      if (raw) {
        const skipKeys = new Set([
          "stationID","temp","heatIndex","windChill","dewpt","dewPoint","humidity","pressure",
          "windSpeed","windGust","winddir","precipRate","precipTotal","solarRadiation","uv"
        ]);
        for (const [path, value] of flatten(raw)) {
          const key = path.split(".").pop();
          if (skipKeys.has(key)) continue;
          if (["obsTimeLocal","obsTimeUtc","neighborhood","softwareType","country","qcStatus","realtimeFrequency","lat","lon","epoch","elev"].includes(key)) {
            addRow(dl, labelFor(path), valueFor(path, value));
          }
        }
      }
    } catch (e) {
      if (!silent || !dl.children.length) {
        connection.className = "station-connection disconnected";
        connection.querySelector(".connection-text").textContent = "تعذر التحقق من اتصال المحطة";
      }
      status.hidden = false;
      status.textContent = `تعذر جلب بيانات الطقس: ${e.message}`;
      if (selectedWeatherView !== "current") status.hidden = true;
    }
    })();
    try { return await weatherRequest; } finally { weatherRequest = null; }
  }

  // v0.20: two views within the existing weather tab; Current is always the default.
  let selectedWeatherView = "current";
  let forecastCache = null;
  let forecastFetchedAt = 0;
  let forecastRequest = null;
  function forecastDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
      timeZone: cfg.timeZone || "Asia/Riyadh", day: "2-digit", month: "2-digit", year: "numeric"
    }).format(date).replaceAll("/", "-");
  }
  function safeForecastNumber(value) {
    return value === null || value === undefined || value === "" ? null : finite(value);
  }
  function appendForecastDay(container, day, index) {
    const row = document.createElement("article");
    row.className = "forecast-day";
    const heading = document.createElement("div");
    heading.className = "forecast-heading";
    const title = document.createElement("strong");
    title.textContent = index === 0 ? "اليوم" : index === 1 ? "غدًا" : (day.day || `اليوم ${index + 1}`);
    const date = document.createElement("span");
    date.className = "forecast-date";
    date.textContent = forecastDate(day.validTime);
    heading.append(title, date);
    const phrase = document.createElement("div");
    phrase.className = "forecast-phrase";
    phrase.textContent = day.phrase || "—";
    const temp = document.createElement("div");
    temp.className = "forecast-temperatures";
    const high = document.createElement("span");
    high.className = "forecast-high";
    high.textContent = `↑ ${safeForecastNumber(day.max) === null ? "—" : fmt(day.max)} °C`;
    const low = document.createElement("span");
    low.className = "forecast-low";
    low.textContent = `↓ ${safeForecastNumber(day.min) === null ? "—" : fmt(day.min)} °C`;
    temp.append(high, low);
    row.append(heading, phrase);
    const chance = safeForecastNumber(day.precipChance);
    if (chance !== null) {
      const rain = document.createElement("span");
      rain.className = chance >= 40 ? "forecast-rain strong" : "forecast-rain soft";
      rain.textContent = `فرصة المطر: ${fmt(chance, 0)}% 🌧️`;
      rain.setAttribute("aria-label", `فرصة المطر ${fmt(chance, 0)} بالمئة`);
      temp.append(rain);
    }
    row.append(temp);
    container.append(row);
  }
  function renderForecast(data) {
    const list = $("#forecastData");
    const status = $("#forecastStatus");
    list.replaceChildren();
    if (!data?.enabled || !Array.isArray(data.days) || !data.days.length) {
      status.textContent = data?.message || "لا تتوفر بيانات التوقعات حاليًا.";
      return;
    }
    status.textContent = "";
    data.days.slice(0, 5).forEach((day, index) => appendForecastDay(list, day, index));
  }
  async function loadForecast() {
    if (forecastCache && Date.now() - forecastFetchedAt < 30 * 60 * 1000) { renderForecast(forecastCache); return; }
    if (forecastRequest) return forecastRequest;
    $("#forecastStatus").textContent = "جارٍ جلب التوقعات…";
    forecastRequest = (async () => {
      try {
        const data = await getJson(api("/api/forecast?lang=ar-SA"));
        forecastCache = data;
        forecastFetchedAt = Date.now();
        if (selectedWeatherView === "forecast") renderForecast(data);
      } catch (error) {
        $("#forecastStatus").textContent = `تعذر جلب التوقعات: ${error.message}`;
      } finally {
        forecastRequest = null;
      }
    })();
    return forecastRequest;
  }
  function selectWeatherView(view) {
    selectedWeatherView = view === "forecast" ? "forecast" : "current";
    const isCurrent = selectedWeatherView === "current";
    $("#weatherCurrentView").hidden = !isCurrent;
    $("#weatherForecastView").hidden = isCurrent;
    $("#stationConnection").hidden = false;
    $("#weatherStatus").hidden = !isCurrent || !$("#weatherStatus").textContent;
    for (const [button, active] of [
      [$("#weatherCurrentButton"), isCurrent],
      [$("#weatherForecastButton"), !isCurrent]
    ]) {
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (!isCurrent) loadForecast();
    syncWeatherRefresh();
  }
  function destroyChart() { if (chart) { chart.destroy(); chart = null; } }
  function chartValues(values) { return values.map(finite).filter(v => v !== null); }
  function paddedRange(values, minPad = 1) {
    const nums = chartValues(values);
    if (!nums.length) return {};
    const lo = Math.min(...nums), hi = Math.max(...nums);
    const span = Math.max(hi - lo, 1);
    const pad = Math.max(minPad, span * 0.12);
    return { suggestedMin: Math.floor((lo - pad) * 2) / 2, suggestedMax: Math.ceil((hi + pad) * 2) / 2 };
  }
  function baseChartOptions(maxTicks = 7) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      locale: "ar-SA",
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", rtl: true, labels: { boxWidth: 12, boxHeight: 12, padding: 12, usePointStyle: true } },
        tooltip: { rtl: true, textDirection: "rtl" }
      },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: maxTicks, maxRotation: 0, minRotation: 0 } }
      }
    };
  }
  async function loadChart(kind) {
    const requestVersion=++chartLoadVersion;
    ensureChartState();
    updatePeriodNav(kind);
    const status = $("#chartStatus");
    const canvas = $("#historyChart");
    status.textContent = "جارٍ جلب البيانات…";
    destroyChart();
    canvas.parentElement.hidden = kind === "year-stats";
    $("#historyStats").hidden = kind !== "year-stats";
    const now = riyadhNowParts();
    try {
      let data, spec;
      if (kind === "year-stats") {
        data = await getJson(`${String(cfg.enrichmentApiBase || dashboardBase()).replace(/\/$/, "")}/api/history/stats?year=${chartState.year}`);
        if(requestVersion!==chartLoadVersion)return;
        const box = $("#historyStats tbody"); box.replaceChildren();
        for (const row of data.stats || []) {
          const item=document.createElement('tr'), label=document.createElement('th'), value=document.createElement('td'), date=document.createElement('td');
          label.scope='row'; label.textContent=row.label==='أعلى مطر يومي'?'أعلى مطر':row.label;
          if(label.textContent.includes('مطر'))item.className='stats-rain';
          if(label.textContent==='أعلى مطر')label.title='أعلى كمية مطر مسجلة في يوم واحد';
          const n=finite(row.value);
          value.textContent=n===null ? '—' : `${row.unit==='يوم'?Math.round(n):n.toFixed(1)} ${row.unit || ''}`;
          date.textContent=row.date ? new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Riyadh'}).format(new Date(row.date+'T12:00:00Z')) : '—';
          date.className='stats-date';
          item.append(label,value,date);box.append(item);
        }
        status.textContent = `${chartState.year} — ${data.coverage || ''}`; return;
      } else if (kind.startsWith("today-")) {
        data = await getJson(api("/api/history/today"));
        if(requestVersion!==chartLoadVersion)return;
        const pts = (data.points || [])
          .filter(p => p?.observedAt && finite(p.temperature) !== null)
          .sort((a,b) => new Date(a.observedAt) - new Date(b.observedAt));
        const temps = pts.map(p => finite(p.temperature));
        const options = baseChartOptions(6);
        options.scales.y = {
          ...paddedRange(temps, 1),
          title: { display: true, text: "°C" },
          ticks: { maxTicksLimit: 6 }
        };
        const fields = kind === 'today-dew' ? [['temperature','الحرارة','#ea8b2c'],['dewPoint','نقطة الندى','#258a74']] : kind === 'today-wind' ? [['windSpeed','الرياح','#3487c5'],['windGust','الهبات','#c77045']] : kind === 'today-humidity' ? [['humidity','الرطوبة','#3487c5']] : kind === 'today-pressure' ? [['pressure','الضغط','#916bc2']] : [['temperature','الحرارة','#ea8b2c']];
        const values = pts.flatMap(p=>fields.map(f=>finite(p[f[0]]))).filter(v=>v!==null);
        options.scales.y = {...paddedRange(values,1), title:{display:true,text:kind==='today-humidity'?'%':kind==='today-wind'?'كم/س':kind==='today-pressure'?'hPa':'°C'}};
        spec = {
          type: "line",
          data: {
            labels: pts.map(p => new Date(p.observedAt).toLocaleTimeString("ar-SA-u-nu-latn", { timeZone: cfg.timeZone || "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false })),
            datasets: fields.map(([key,label,color])=>({label,data:pts.map(p=>finite(p[key])),borderColor:color,borderWidth:2,pointRadius:0,pointHitRadius:12,tension:.22,spanGaps:false}))
          },
          options
        };
        status.textContent = pts.length ? `قراءات اليوم: ${pts.length}` : "لا توجد بيانات كافية لليوم.";
      } else if (kind.startsWith("year-")) {
        const selectedYear = chartState.year;
        data = await getJson(api(`/api/history/year?year=${selectedYear}`));
        if(requestVersion!==chartLoadVersion)return;
        const pts = (data.points || []).slice().sort((a,b) => Number(a.month) - Number(b.month));
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const highs = pts.map(p => finite(p.tempHigh));
        const lows = pts.map(p => finite(p.tempLow));
        const options = baseChartOptions(12);
        options.scales.temp = {
          type: "linear",
          position: "right",
          beginAtZero: true,
          title: { display: true, text: "°C" },
          ticks: { maxTicksLimit: 6 }
        };
        options.scales.rain = {
          type: "linear",
          position: "left",
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          title: { display: true, text: "مم" },
          ticks: { maxTicksLimit: 5 }
        };
        spec = {
          type: "bar",
          data: {
            labels: pts.map(p => months[Number(p.month)-1] || String(p.month)),
            datasets: [
              { label: "العظمى", data: highs, yAxisID: "temp", backgroundColor: "#ea8b2c", grouped:true },
              { label: "الصغرى", data: lows, yAxisID: "temp", backgroundColor: "#3487c5", grouped:true },
              { label: "المطر", data: pts.map(p => finite(p.rain)), yAxisID: "rain", backgroundColor: "#258a74", grouped:true }

            ]
          },
          options
        };
        status.textContent = `${selectedYear} — العظمى والصغرى شهريًا، والمطر مجموع كل شهر.`;
      } else {
        const selectedYear = chartState.monthYear;
        const selectedMonth = chartState.month;
        data = await getJson(api(`/api/history/month?year=${selectedYear}&month=${selectedMonth}`));
        if(requestVersion!==chartLoadVersion)return;
        const raw = new Map((data.points || []).map(p=>[Number(p.day || p.date.slice(8,10)),p]));
        const lastDay=selectedYear===now.year&&selectedMonth===now.month?now.day:new Date(selectedYear,selectedMonth,0).getDate();
        const pts = Array.from({length:lastDay},(_,i)=>raw.get(i+1)||{day:i+1,tempAvg:null,dewPoint:null,tempHigh:null,tempLow:null});
        data.points=pts;
        const temps = pts.map(p => finite(p.tempAvg));
        const dews = pts.map(p => finite(p.dewPoint ?? p.dewPointAvg ?? p.dewptAvg));
        const options = baseChartOptions(8);
        options.scales.temp = {
          type: "linear",
          position: "right",
          ...paddedRange([...temps, ...dews], 1.5),
          title: { display: true, text: "°C" },
          ticks: { maxTicksLimit: 6 }
        };
        spec = {
          type: "line",
          data: {
            labels: pts.map(p => String(p.day || Number(String(p.date).slice(8,10)))),
            datasets: [
              { label: "متوسط الحرارة", data: temps, yAxisID: "temp", borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: .22, spanGaps: false },
              { label: "نقطة الندى", data: dews, yAxisID: "temp", borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: .22, spanGaps: false }
            ]
          },
          options
        };
        status.textContent = `${monthNames[selectedMonth - 1]} ${selectedYear} — متوسط الحرارة ونقطة الندى لكل يوم.`;
      }
      if (kind === 'month-range') {
        const pts = data.points || [];
        spec.type = 'bar';
        spec.data.labels = pts.map(p=>String(p.day || Number(p.date.slice(8,10))));
        spec.data.datasets = [{label:'الصغرى — العظمى',data:pts.map(p=>finite(p.tempLow)!==null && finite(p.tempHigh)!==null ? [Number(p.tempLow),Number(p.tempHigh)] : null),backgroundColor:'#ea8b2c',yAxisID:'temp'}];
        spec.options.scales.temp = {type:'linear',title:{display:true,text:'°C'}};
        status.textContent = `${monthNames[chartState.month-1]} ${chartState.monthYear} — المدى الحراري لكل يوم.`;
      }
      if(requestVersion!==chartLoadVersion)return;
      chart = new Chart(canvas, spec);
    } catch (e) {
      if(requestVersion!==chartLoadVersion)return;
      status.textContent = `تعذر جلب الشارت: ${e.message}`;
    }
  }

  const previousMarketPrices = new Map();
  let marketsLoading = false;
  let openMarketSymbol = null;

  function marketDirection(q) {
    const pct = finite(q?.changePercent);
    if (pct !== null && Math.abs(pct) >= 0.005) return pct > 0 ? "up" : "down";
    const change = finite(q?.change);
    if (change !== null && Math.abs(change) >= 0.005) return change > 0 ? "up" : "down";
    return "";
  }
  function marketSigned(value, suffix = "", digits = 2) {
    const n = finite(value);
    if (n === null) return "—";
    const clean = Math.abs(n) < 0.005 ? 0 : n;
    return `${clean > 0 ? "+" : ""}${fmt(clean, digits)}${suffix}`;
  }
  function marketFixed(value) {
    const n = value === null || value === undefined || value === "" ? null : finite(value);
    return n === null ? "—" : n.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function marketSignedFixed(value) {
    const n = value === null || value === undefined || value === "" ? null : finite(value);
    if (n === null) return "—";
    const clean = Math.abs(n) < 0.005 ? 0 : n;
    return `${clean > 0 ? "+" : ""}${marketFixed(clean)}`;
  }
  function compactVolume(value) {
    const n = finite(value);
    if (n === null) return "—";
    return n.toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 0 });
  }
  function buildMarketHeader(title) {
    const head = document.createElement("div"); head.className = "market-group-heading";
    const h = document.createElement("h3"); h.textContent = title; head.appendChild(h);
    const wrap = document.createElement("span"); wrap.className = "info-wrap";
    const button = document.createElement("button"); button.type = "button"; button.className = "info-button";
    button.textContent = "ⓘ"; button.setAttribute("aria-label", "معلومات تأخر الأسعار"); button.setAttribute("aria-expanded", "false");
    const bubble = document.createElement("span"); bubble.className = "info-bubble market-delay-info"; bubble.hidden = true;
    bubble.textContent = "الأسعار قد تكون متأخرة؛ مدة التأخير بالدقائق غير محددة من المصدر.";
    bubble.setAttribute("role", "status");
    button.addEventListener("click", event => { event.stopPropagation(); bubble.hidden = !bubble.hidden; button.setAttribute("aria-expanded", String(!bubble.hidden)); });
    wrap.addEventListener("keydown", event => { if (event.key === "Escape") { bubble.hidden = true; button.setAttribute("aria-expanded", "false"); button.focus(); } });
    head.addEventListener("focusout", event => { if (!head.contains(event.relatedTarget)) { bubble.hidden = true; button.setAttribute("aria-expanded", "false"); } });
    wrap.append(button, bubble); head.appendChild(wrap);
    return head;
  }
  function buildMarketDetails(q) {
    const details = document.createElement("div"); details.className = "market-details"; details.hidden = true;
    const fields = [
      ["الإغلاق السابق", q.previousClose, 2], ["الافتتاح", q.open, 2],
      ["الأعلى", q.high, 2], ["الأدنى", q.low, 2],
      ["التغير", q.change, 2]
    ];
    for (const [label, value, digits] of fields) {
      const cell = document.createElement("span");
      const shown = label === "التغير" ? marketSignedFixed(value) : marketFixed(value);
      cell.innerHTML = `<small>${label}:</small><strong>${shown}</strong>`;
    if (label === "التغير") {
  const direction = marketDirection(q);
  if (direction) cell.classList.add(direction);
}
      details.appendChild(cell);
    }
    const vol = document.createElement("span"); vol.innerHTML = `<small>حجم التداول:</small><strong>${compactVolume(q.volume)}</strong>`; details.appendChild(vol);
    if (q.corporateAction) {
      const note = document.createElement("p"); note.className = "market-action-note"; note.textContent = "تم تعديل مرجع التغير لإجراء على السهم."; details.appendChild(note);
    }
    return details;
  }
  function addMarketFlash(row, symbol, price) {
    const n = finite(price), prev = previousMarketPrices.get(symbol);
    if (n !== null && prev !== undefined && Math.abs(n - prev) >= 0.0001) row.classList.add(n > prev ? "flash-up" : "flash-down");
    if (n !== null) previousMarketPrices.set(symbol, n);
  }

  let tickerController=null;
  function buildIndexTicker(indices, bySymbol) {
    const prior=tickerController?.position()||0;
    tickerController?.dispose();
    const area=document.createElement("section");area.className="index-ticker";
    area.setAttribute("aria-label","المؤشرات والسلع والمعادن");
    const label=document.createElement("strong");label.className="index-ticker-label";label.textContent="مؤشرات:";
    const viewport=document.createElement("div");viewport.className="index-ticker-viewport";viewport.tabIndex=0;
    viewport.setAttribute("aria-label","شريط المؤشرات؛ اسحب في الاتجاهين أو استخدم الأسهم");
    const track=document.createElement("div");track.className="index-ticker-track";
    for(let copy=0;copy<3;copy++){
      const set=document.createElement("div");set.className="index-ticker-set";
      if(copy!==1)set.setAttribute("aria-hidden","true");
      for(const item of [...indices].reverse()){
        const q=bySymbol.get(item.symbol)||{}, direction=marketDirection(q), pct=finite(q.changePercent);
        const segment=document.createElement("span");segment.className="index-ticker-item";
        const name=document.createElement("strong");name.textContent=item.name;
        const price=document.createElement("span");price.className=`index-ticker-value ${direction}`;price.textContent=fmt(q.price,2);
        const change=document.createElement("span");change.className=`index-ticker-change ${direction}`;change.textContent=pct===null?"—":marketSigned(pct,"%");
        segment.append(name,price,change);set.append(segment);
      }
      track.append(set);
    }
    viewport.append(track);area.append(label,viewport);
    let frame=null,last=0,width=0,pauseUntil=0,drag=null,hover=false,disposed=false,autoOffset=null;
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const pause=()=>{pauseUntil=performance.now()+3500;};
    const wrap=()=>{if(width>0){while(viewport.scrollLeft<width*.5)viewport.scrollLeft+=width;while(viewport.scrollLeft>width*1.5)viewport.scrollLeft-=width;}};
    const step=amount=>{pause();viewport.scrollLeft+=amount;wrap();};
    for(const [arrow,amount,title] of [['‹',-180,'تحريك الشريط إلى اليسار'],['›',180,'تحريك الشريط إلى اليمين']]){
      const button=document.createElement('button');button.type='button';button.className='index-ticker-arrow';button.textContent=arrow;button.setAttribute('aria-label',title);button.title=title;
      button.addEventListener('click',()=>step(amount));area.append(button);
    }
    viewport.addEventListener('pointerenter',()=>{hover=true;});
    viewport.addEventListener('pointerleave',()=>{hover=false;});
    viewport.addEventListener('pointerdown',event=>{
      pause();if(event.pointerType!=='mouse'||event.button!==0)return;
      drag={id:event.pointerId,x:event.clientX,offset:viewport.scrollLeft};viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-dragging');
    });
    viewport.addEventListener('pointermove',event=>{if(drag){viewport.scrollLeft=drag.offset+drag.x-event.clientX;pause();}});
    const release=()=>{drag=null;viewport.classList.remove('is-dragging');wrap();pause();};
    viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);
    viewport.addEventListener('touchstart',event=>{event.stopPropagation();pause();},{passive:true});
    viewport.addEventListener('touchend',event=>{event.stopPropagation();pause();},{passive:true});
    viewport.addEventListener('scroll',()=>{if(autoOffset===null||Math.abs(viewport.scrollLeft-autoOffset)>=2)pause();},{passive:true});
    viewport.addEventListener('wheel',event=>{if(event.deltaX||event.shiftKey){event.preventDefault();step(event.deltaX||event.deltaY);}},{passive:false});
    viewport.addEventListener('keydown',event=>{
      if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();step(event.key==='ArrowLeft'?-180:180);}
    });
    const tick=now=>{
      if(disposed)return;
      if(area.isConnected&&viewport.clientWidth&&track.firstElementChild.offsetWidth){
        const newWidth=track.firstElementChild.offsetWidth;
        if(!width){width=newWidth;viewport.scrollLeft=width+Math.min(prior,width-1);autoOffset=viewport.scrollLeft;}
        else if(width!==newWidth){const offset=viewport.scrollLeft-width;width=newWidth;viewport.scrollLeft=width+offset;}
        if(!motion.matches&&!document.hidden&&!$('#panel-markets').hidden&&!drag&&!hover&&!area.contains(document.activeElement)&&now>pauseUntil){
          viewport.scrollLeft+=Math.min(now-last||0,50)*.035;wrap();autoOffset=viewport.scrollLeft;
        }
      }
      last=now;frame=requestAnimationFrame(tick);
    };
    tickerController={position:()=>width?((viewport.scrollLeft-width)%width+width)%width:prior,dispose:()=>{disposed=true;cancelAnimationFrame(frame);}};
    frame=requestAnimationFrame(tick);return area;
  }

  async function loadMarkets({silent=false} = {}) {
    const status = $("#marketsStatus"), root = $("#marketsData");
    if (marketsLoading) return;
    const base = dashboardBase();
    if (!base) { status.textContent = "الأسعار تحتاج عامل API مفعّل."; return; }
    marketsLoading = true;
    if (!silent && !root.children.length) status.textContent = "جارٍ جلب الأسعار…";
    try {
      const visible = activeMarkets();
      const symbols = visible.map(x => x.symbol).join(",");
      const d = await getJson(`${base}/api/markets?symbols=${encodeURIComponent(symbols)}`);
      const bySymbol = new Map((d.items || []).map(x => [x.symbol, x]));
      const frag = document.createDocumentFragment();
      const referenceItems = visible.filter(x => x.category === "index" || x.category === "commodity");
      if (referenceItems.length) frag.appendChild(buildIndexTicker(referenceItems, bySymbol));
      const groups = [["stock","الأسهم"]];
      for (const [key,title] of groups) {
        const section = document.createElement("section"); section.className="market-group";
        section.appendChild(buildMarketHeader(title));
        for (const item of visible.filter(x=>x.category===key)) {
          const q = bySymbol.get(item.symbol) || {};
          const cls = marketDirection(q);
          const pct = finite(q.changePercent);
          const change = finite(q.change);
          const itemWrap = document.createElement("div"); itemWrap.className = "market-item";
          const row = document.createElement("div"); row.className = `market-row ${key === "index" ? "index-row" : ""}`.trim();
          if (key === "index") {
            row.innerHTML = `<span class="market-name">${item.name}</span><span class="num market-index-value ${cls}">${fmt(q.price,2)}</span><span class="num ${cls}">${pct === null ? "—" : marketSigned(pct,"%")}</span>`;
          } else {
            // Three columns only: name | last price | colored percent.
            row.innerHTML = `<span class="market-name">${item.name}</span><span class="num">${marketFixed(q.price)}</span><span class="num ${cls}">${pct === null ? "—" : marketSigned(pct,"%")}</span>`;
            if (key === "stock" || key === "commodity") {
              row.classList.add("stock-row", "market-expandable-row");
              row.tabIndex = 0; row.setAttribute("role", "button");
              row.setAttribute("aria-label", `${item.name}، عرض التفاصيل`);
              const details = buildMarketDetails(q);
              const isOpen = openMarketSymbol === item.symbol;
              details.hidden = !isOpen;
              row.setAttribute("aria-expanded", isOpen ? "true" : "false");
              itemWrap.append(row, details);
              const toggle = () => {
                const willOpen = details.hidden;
                root.querySelectorAll(".market-details").forEach(el => { el.hidden = true; });
                root.querySelectorAll(".market-expandable-row[aria-expanded=\"true\"]").forEach(el => el.setAttribute("aria-expanded", "false"));
                if (willOpen) {
                  details.hidden = false;
                  row.setAttribute("aria-expanded", "true");
                  openMarketSymbol = item.symbol;
                } else {
                  openMarketSymbol = null;
                }
              };
              row.addEventListener("click", toggle);
              row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
              addMarketFlash(row, item.symbol, q.price);
              section.appendChild(itemWrap);
              continue;
            }
          }
          addMarketFlash(row, item.symbol, q.price);
          itemWrap.appendChild(row); section.appendChild(itemWrap);
        }
        frag.appendChild(section);
      }
      root.replaceChildren(frag);
      status.textContent = d.updatedAt ? `آخر تحديث: ${formatUpdateTime(d.updatedAt)}` : "";
    } catch (e) { status.textContent = `تعذر جلب الأسعار: ${e.message}`; }
    finally { marketsLoading = false; }
  }

  let marketsTimer = null;
  function stopMarketsRefresh() {
    if (marketsTimer) clearInterval(marketsTimer);
    marketsTimer = null;
  }
  function startMarketsRefresh() {
    stopMarketsRefresh();
    const ms = Math.max(30000, Number(cfg.marketsRefreshMs) || 60000);
    marketsTimer = setInterval(() => {
      const panel = $("#panel-markets");
      if (panel && !panel.hidden && document.visibilityState === "visible") loadMarkets({silent:true});
    }, ms);
  }

  function cleanHijriParts(value) {
    const text = String(value || "").trim().replace(/\s*هـ\s*$/u, "");
    const m = text.match(/^(\d{1,2})\s+(.+?)\s+(\d{4})$/u);
    if (!m) return text || "—";

    const monthName = m[2].trim().replace(/\s+/g, " ");
    const hijriMonths = new Map([
      ["محرم", 1], ["صفر", 2], ["ربيع الأول", 3],
      ["ربيع الثاني", 4], ["ربيع الآخر", 4],
      ["جمادى الأولى", 5], ["جمادى الاولى", 5],
      ["جمادى الآخرة", 6], ["جمادى الثانية", 6], ["جمادى الاخرة", 6],
      ["رجب", 7], ["شعبان", 8], ["رمضان", 9], ["شوال", 10],
      ["ذو القعدة", 11], ["ذو الحجة", 12]
    ]);
    const numericMonth = /^\d{1,2}$/.test(monthName) ? Number(monthName) : hijriMonths.get(monthName);
    if (!numericMonth) return `${m[1]}-${monthName}-${m[3]} هـ`;
    return `${String(m[1]).padStart(2, "0")}-${String(numericMonth).padStart(2, "0")}-${m[3]} هـ`;
  }

  function gregorianHyphenArabic(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timeZone || "Asia/Riyadh",
      day: "2-digit", month: "2-digit", year: "numeric"
    }).formatToParts(date);
    const o = {};
    parts.forEach(p => { if (p.type !== "literal") o[p.type] = p.value; });
    return `${o.day}-${o.month}-${o.year} م`;
  }

  function riyadhWeekday(date = new Date()) {
    return new Intl.DateTimeFormat("ar-SA", {
      timeZone: cfg.timeZone || "Asia/Riyadh", weekday: "long"
    }).format(date);
  }

  function approximateMoonPhase(date = new Date()) {
    const synodicMonth = 29.530588853;
    const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
    const ageDays = (((date.getTime() - knownNewMoon) / 86400000) % synodicMonth + synodicMonth) % synodicMonth;
    if (ageDays < 1.84566 || ageDays >= 27.68493) return "محاق";
    if (ageDays < 5.53699) return "هلال متزايد";
    if (ageDays < 9.22831) return "التربيع الأول";
    if (ageDays < 12.91963) return "أحدب متزايد";
    if (ageDays < 16.61096) return "بدر";
    if (ageDays < 20.30228) return "أحدب متناقص";
    if (ageDays < 23.99361) return "التربيع الأخير";
    return "هلال متناقص";
  }

  function moonPhaseIcon(phase) {
    const p = String(phase || "");
    if (p.includes("محاق")) return "🌑";
    if (p.includes("هلال متزايد")) return "🌒";
    if (p.includes("التربيع الأول")) return "🌓";
    if (p.includes("أحدب متزايد")) return "🌔";
    if (p.includes("بدر")) return "🌕";
    if (p.includes("أحدب متناقص")) return "🌖";
    if (p.includes("التربيع الأخير")) return "🌗";
    if (p.includes("هلال متناقص")) return "🌘";
    return "🌙";
  }

  function currentRiyadhMinutes(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timeZone || "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const o = {};
    parts.forEach(p => { if (p.type !== "literal") o[p.type] = p.value; });
    return Number(o.hour) * 60 + Number(o.minute);
  }

  function timeToMinutes(value) {
    const m = String(value || "").match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function nextPrayerKey(times, now = new Date()) {
    const prayerKeys = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
    const current = currentRiyadhMinutes(now);
    for (const key of prayerKeys) {
      const minutes = timeToMinutes(times?.[key]);
      if (minutes !== null && minutes > current) return key;
    }
    return "fajr";
  }

  let prayerCountdownTimer = null;
  let prayerCountdownTimes = null;

  function prayerPeriodState(times, now = new Date()) {
    const events = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
    const current = currentRiyadhMinutes(now);
    const mins = Object.fromEntries(events.map(k => [k, timeToMinutes(times?.[k])]));
    if (events.some(k => mins[k] === null)) return null;
    let currentKey = "isha", nextEventKey = "fajr", start = mins.isha - 1440, target = mins.fajr;
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i], b = events[i + 1];
      if (current >= mins[a] && current < mins[b]) { currentKey = a; nextEventKey = b; start = mins[a]; target = mins[b]; break; }
    }
    if (current >= mins.isha) { currentKey = "isha"; nextEventKey = "fajr"; start = mins.isha; target = mins.fajr + 1440; }
    else if (current < mins.fajr) { currentKey = "isha"; nextEventKey = "fajr"; start = mins.isha - 1440; target = mins.fajr; }
    const span = Math.max(1, target - start);
    const remaining = Math.max(0, target - current);
    const ratio = Math.max(0, Math.min(1, remaining / span));
    return { currentKey, nextEventKey, nextPrayerKey: nextPrayerKey(times, now), ratio, remaining };
  }

  function updatePrayerCountdown() {
    if (!prayerCountdownTimes) return;
    const state = prayerPeriodState(prayerCountdownTimes, new Date());
    if (!state) return;
    const names={fajr:"الفجر",sunrise:"الشروق",dhuhr:"الظهر",asr:"العصر",maghrib:"المغرب",isha:"العشاء"};
    const dl = $("#prayerData");
    dl?.querySelectorAll("[data-prayer-key]").forEach(row => {
      row.classList.remove("next-prayer", "current-period");
      row.removeAttribute("aria-label");
    });
    dl?.querySelectorAll(".prayer-countdown").forEach(el => el.remove());

    const focus = $("#prayerCurrent");
    if (!focus) return;
    focus.replaceChildren(); focus.hidden = true;
    dl?.querySelectorAll("[data-prayer-key]").forEach(row => { row.hidden = false; });
    // Sunrise remains a timetable entry, with no focused prayer until Dhuhr.
    if (state.currentKey === "sunrise") return;
    const sourceRow = $(`#prayerData [data-prayer-key="${state.currentKey}"]`);
    if (!sourceRow) return;
    const currentRow = sourceRow.cloneNode(true);
    currentRow.hidden = false;
    currentRow.classList.add("current-period");
    currentRow.setAttribute("aria-label", `الصلاة الحالية: ${names[state.currentKey]}`);
    sourceRow.hidden = true;
    focus.appendChild(currentRow); focus.hidden = false;
    const meter = document.createElement("span");
    meter.className = "prayer-countdown";
    if (state.ratio <= .10) meter.classList.add("is-danger");
    else if (state.ratio <= .25) meter.classList.add("is-warning");
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-valuenow", String(Math.round(state.ratio * 100)));
    meter.setAttribute("aria-label", `الوقت المتبقي من فترة ${names[state.currentKey]} حتى ${names[state.nextEventKey]}`);
    const fill = document.createElement("span");
    fill.className = "prayer-countdown-fill";
    fill.style.width = `${(state.ratio * 100).toFixed(1)}%`;
    meter.appendChild(fill);
    const dd = currentRow.querySelector("dd");
    currentRow.insertBefore(meter, dd || null);
  }

  function startPrayerCountdown(times) {
    prayerCountdownTimes = times || null;
    if (prayerCountdownTimer) clearInterval(prayerCountdownTimer);
    updatePrayerCountdown();
    prayerCountdownTimer = setInterval(updatePrayerCountdown, 30000);
  }

  async function loadPrayer() {
    const status = $("#prayerStatus");
    const dl = $("#prayerData");
    const moonDl = $("#moonData");
    const dateSummary = $("#prayerDateSummary");
    const moonPhaseEl = $("#moonPhase");

    // Guard against a stale HTML/JS pair from browser cache.
    if (!status || !dl || !moonDl || !dateSummary || !moonPhaseEl) {
      console.warn("Prayer UI is not in sync with app.js; reload the page without cache.");
      return;
    }

    dl.innerHTML=""; moonDl.innerHTML="";
    const prayerFocus = $("#prayerCurrent");
    if (prayerFocus) { prayerFocus.replaceChildren(); prayerFocus.hidden = true; }
    const now=new Date();
    dateSummary.textContent = `${riyadhWeekday(now)} · — · الموافق ${gregorianHyphenArabic(now)}`;
    try {
      const d=await getJson(api("/api/prayer"));
      const hijri = cleanHijriParts(d.hijriDate);
      dateSummary.textContent = `${riyadhWeekday(now)} ${hijri} · الموافق ${gregorianHyphenArabic(now)}`;
      const names={fajr:"الفجر",sunrise:"الشروق",dhuhr:"الظهر",asr:"العصر",maghrib:"المغرب",isha:"العشاء"};
      for (const key of ["fajr","sunrise","dhuhr","asr","maghrib","isha"]) {
        const row = addRow(dl, names[key], d.times?.[key] || "—");
        row.dataset.prayerKey = key;
      }
      startPrayerCountdown(d.times);

      const moonPhase = d.moon?.phase || approximateMoonPhase(now);
      moonPhaseEl.textContent = moonPhaseIcon(moonPhase);
      moonPhaseEl.removeAttribute("title");
      addRow(moonDl, "شكل القمر", moonPhase);
      addRow(moonDl, "الظهور", d.moon?.rise || "—");
      addRow(moonDl, "الغروب", d.moon?.set || "—");

      status.textContent = "";
    } catch(e){
      prayerCountdownTimes = null;
      if (prayerCountdownTimer) clearInterval(prayerCountdownTimer);
      prayerCountdownTimer = null;
      status.textContent=`تعذر جلب أوقات الصلاة: ${e.message}`;
      moonPhaseEl.textContent = "🌙";
      addRow(moonDl, "شكل القمر", "—");
      addRow(moonDl, "الظهور", "—");
      addRow(moonDl, "الغروب", "—");
    }
  }

  function setupInfoToggle(buttonSelector, bubbleSelector) {
    const button = $(buttonSelector), bubble = $(bubbleSelector);
    if (!button || !bubble) return;
    const close = () => { bubble.hidden = true; button.setAttribute("aria-expanded", "false"); };
    button.addEventListener("click", e => {
      e.stopPropagation();
      const willOpen = bubble.hidden;
      bubble.hidden = !willOpen;
      button.setAttribute("aria-expanded", String(willOpen));
    });
    bubble.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", close);
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }
  function closeChartPicker() {
    const menu = $("#chartPickerMenu");
    const button = $("#chartPickerButton");
    if (!menu || !button) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function selectChart(kind, label) {
    const now = riyadhNowParts();
    selectedChartKind = kind;
    if (kind.startsWith("month-")) { chartState.monthYear = now.year; chartState.month = now.month; }
    if (kind.startsWith("year-")) chartState.year = now.year;
    const text = $("#chartPickerText");
    if (text) text.textContent = label;
    $("#chartPickerMenu")?.querySelectorAll("[data-chart]").forEach(option => {
      option.setAttribute("aria-selected", option.dataset.chart === kind ? "true" : "false");
    });
    closeChartPicker();
    loadChart(kind);
  }

  function setupChartPicker() {
    const picker = $("#chartPicker");
    const button = $("#chartPickerButton");
    const menu = $("#chartPickerMenu");
    if (!picker || !button || !menu) return;
    button.addEventListener("click", () => {
      const opening = menu.hidden;
      menu.hidden = !opening;
      button.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    menu.querySelectorAll("[data-chart]").forEach(option => option.addEventListener("click", () => {
      selectChart(option.dataset.chart, option.textContent.trim());
    }));
    document.addEventListener("click", e => { if (!picker.contains(e.target)) closeChartPicker(); });
    picker.addEventListener("keydown", e => { if (e.key === "Escape") { closeChartPicker(); button.focus(); } });
  }

  function setupPrayerInfo() { setupInfoToggle("#prayerInfoButton", "#prayerInfoBubble"); }
  function setupWeatherInfo() { setupInfoToggle("#weatherInfoButton", "#weatherInfoBubble"); }

  // Refresh only while the current weather panel is actually in view.
  const WEATHER_REFRESH_MS = 60 * 1000;
  let weatherTimer = null;
  function weatherIsActive() {
    return document.visibilityState === "visible" &&
      !document.querySelector("#panel-weather").hidden &&
      selectedWeatherView === "current";
  }
  function refreshVisibleWeather(force = false) {
    if (weatherIsActive() && (force || Date.now() - weatherLastAttempt >= WEATHER_REFRESH_MS)) {
      return loadWeather({silent: loaded.has("weather")});
    }
  }
  function syncWeatherRefresh() {
    if (weatherTimer !== null) clearInterval(weatherTimer);
    weatherTimer = null;
    if (!weatherIsActive()) return;
    refreshVisibleWeather();
    weatherTimer = setInterval(() => refreshVisibleWeather(), WEATHER_REFRESH_MS);
  }
  document.addEventListener("visibilitychange", syncWeatherRefresh);
  window.addEventListener("focus", syncWeatherRefresh);
  window.addEventListener("blur", () => {
    // Visibility can remain 'visible' on some TVs; suspend during window blur.
    if (weatherTimer !== null) clearInterval(weatherTimer);
    weatherTimer = null;
  });

  function showTab(name) {
    document.dispatchEvent(new CustomEvent("taqss:tab-change", {detail: name}));
    if (name !== "radar") document.dispatchEvent(new CustomEvent("taqss:radar-close"));
    if (name !== "markets") stopMarketsRefresh();
    $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
    $$(".panel").forEach(p=>{ const active=p.id===`panel-${name}`; p.hidden=!active; p.classList.toggle("active",active); });
    history.replaceState(null,"",`#${name}`);
    if (!loaded.has(name)) {
      loaded.add(name);
      if (name==="weather") loadWeather();
      if (name==="history") loadChart(selectedChartKind);
      if (name==="markets") loadMarkets();
      if (name==="prayer") loadPrayer();
      if (name==="radar") document.dispatchEvent(new CustomEvent("taqss:radar-open"));
    } else {
      if (name==="radar") document.dispatchEvent(new CustomEvent("taqss:radar-open"));
      if (name==="markets") loadMarkets({silent:true});
    }
    if (name === "markets") startMarketsRefresh();
    updateStickyOffsets();
    syncWeatherRefresh();
  }

  setupPrayerInfo();
  setupWeatherInfo();
  setupChartPicker();
  $("#weatherCurrentButton").addEventListener("click", () => selectWeatherView("current"));
  $("#weatherForecastButton").addEventListener("click", () => selectWeatherView("forecast"));
  updateStickyOffsets();
  window.addEventListener("resize", updateStickyOffsets, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    const prayerHeader = document.querySelector(".prayer-secondary-sticky");
    if (prayerHeader) new ResizeObserver(updateStickyOffsets).observe(prayerHeader);
  }

  $$(".tab").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
  $("#chartPrev").addEventListener("click",()=>moveChartPeriod(-1));
  $("#chartNext").addEventListener("click",()=>moveChartPeriod(1));
  const initial=["weather","history","radar","prayer","mushaf","markets","quiz"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "weather";
  showTab(initial);
})();

// v0.20.1: forecast-only colors, shared station status, market layout.


// taqss-price-sections-v0203: presentation only; no prices or calculation changed.
(() => {
  'use strict';
  const choices = new Map([
    ['المؤشرات', ['مؤشرات', false]],
    ['مؤشرات', ['مؤشرات', false]],
    ['المعادن والطاقة', ['سلع', true]],
    ['المعادن والسلع', ['سلع', true]],
    ['معادن وسلع', ['سلع', true]],
    ['سلع', ['سلع', true]],
    ['الأسهم', ['أسهم', true]],
    ['أسهم', ['أسهم', true]],
  ]);
  function decorateMarkets() {
    const panel = document.getElementById('panel-markets');
    if (!panel) return;
    // Deepest text nodes only; don't accidentally rename a container or a quote row.
    for (const el of panel.querySelectorAll('*')) {
      const raw = el.textContent?.trim().replace(/\s+/g, ' ');
      if (!choices.has(raw) || el.children.length > 0) continue;
      if (el.closest('.market-row, .market-details, button, select')) continue;
      const [shortTitle, separated] = choices.get(raw);
      // The current UI uses section headings; protect against rewriting unrelated text.
      const headingSelector = 'h1,h2,h3,h4,h5,h6,.market-section-title,.market-group-title,.market-heading,.section-title,.market-category-title';
      const heading = el.matches(headingSelector) ? el
        : (el.parentElement?.matches(headingSelector) ? el.parentElement
        : (el.matches('div,p,strong') && !el.closest('.market-row,.market-details') ? el : null));
      if (!heading) continue;
      heading.classList.add('taqss-market-heading-v0203');
      if (el.textContent.trim() !== shortTitle) el.textContent = shortTitle;
      if (separated) {
        const prev = heading.previousElementSibling;
        if (!prev?.classList.contains('taqss-market-divider-v0203')) {
          const separator = document.createElement('div');
          separator.className = 'taqss-market-divider-v0203';
          separator.setAttribute('aria-hidden', 'true');
          heading.before(separator);
        }
      }
    }
  }
  function boot() {
    const panel = document.getElementById('panel-markets');
    if (!panel) return;
    let inObserver = false;
    const observer = new MutationObserver(() => {
      if (inObserver) return;
      inObserver = true;
      observer.disconnect();
      try { decorateMarkets(); }
      finally { observer.observe(panel, {childList: true, subtree: true}); inObserver = false; }
    });
    decorateMarkets();
    observer.observe(panel, {childList: true, subtree: true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();


// taqss-last-existing-rule-v0203d: mark the last existing row before each category.
// The heading/divider observer from v0.20.3 is retained; no extra rules are inserted.
(() => {
  'use strict';
  function updateLastRows() {
    const panel = document.getElementById('panel-markets');
    if (!panel) return;
    panel.querySelectorAll('.market-row.taqss-market-last-v0203d')
      .forEach(row => {
        row.classList.remove('taqss-market-last-v0203d');
        row.style.removeProperty('border-bottom-width');
        row.style.removeProperty('border-bottom-style');
        row.style.removeProperty('border-bottom-color');
      });
    const rows = [...panel.querySelectorAll('.market-row')];
    const headings = [...panel.querySelectorAll('.taqss-market-divider-v0203 + .taqss-market-heading-v0203')];
    for (const heading of headings) {
      // Last ROW anywhere above the new heading, even if groups use wrappers.
      const prior = rows.filter(row => !!(row.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)).pop();
      if (prior) {
        // Reuse the color of an ordinary row's existing separator.
        const priorIndex = rows.indexOf(prior);
        prior.classList.add('taqss-market-last-v0203d');
        // Inline important is deliberate: older patches hide the old final line.
        prior.style.setProperty('border-bottom-width', '2px', 'important');
        prior.style.setProperty('border-bottom-style', 'solid', 'important');
        prior.style.setProperty('border-bottom-color', '#cbd0d4', 'important');
      }
    }
  }
  function boot() {
    const panel = document.getElementById('panel-markets');
    if (!panel) return;
    let queued = false;
    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; updateLastRows(); });
    }
    // Existing app may replace market markup during refresh; keep marker synchronized.
    new MutationObserver(schedule).observe(panel, {childList:true,subtree:true});
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
