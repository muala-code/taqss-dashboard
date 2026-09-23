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
  const loaded = new Set();
  const chartState = { monthYear: null, month: null, year: null };
  let selectedChartKind = "today-temp";
  const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

  const stationBase = () => String(cfg.stationApiBase || "").replace(/\/$/, "");
  const dashboardBase = () => String(cfg.dashboardApiBase || "").replace(/\/$/, "");
  const api = path => `${stationBase()}${path}`;

  function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
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
    if (kind === "month-temp-dew") return "month";
    if (kind === "year-temp-rain") return "year";
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

  async function loadWeather() {
    const status = $("#weatherStatus"), dl = $("#weatherData"), connection = $("#stationConnection");
    $("#stationLocation").textContent = cfg.stationLocation || "—";
    status.hidden = true; status.textContent = ""; dl.innerHTML = "";
    connection.className = "station-connection loading";
    connection.querySelector(".connection-text").textContent = "جارٍ التحقق من اتصال المحطة…";
    try {
      const d = await getJson(api("/api/weather"));
      const connected = d.stationConnected !== false;
      const readAt = d.observedAt ? formatUpdateTime(d.observedAt) : "—";
      connection.className = `station-connection ${connected ? "connected" : "disconnected"}`;
      connection.querySelector(".connection-text").textContent = `${connected ? "المحطة متصلة" : "المحطة غير متصلة"} · آخر قراءة: ${readAt}`;

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
      connection.className = "station-connection disconnected";
      connection.querySelector(".connection-text").textContent = "تعذر التحقق من اتصال المحطة";
      status.hidden = false;
      status.textContent = `تعذر جلب بيانات الطقس: ${e.message}`;
    }
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
    ensureChartState();
    updatePeriodNav(kind);
    const status = $("#chartStatus");
    const canvas = $("#historyChart");
    status.textContent = "جارٍ جلب البيانات…";
    destroyChart();
    const now = riyadhNowParts();
    try {
      let data, spec;
      if (kind === "today-temp") {
        data = await getJson(api("/api/history/today"));
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
        spec = {
          type: "line",
          data: {
            labels: pts.map(p => new Date(p.observedAt).toLocaleTimeString("ar-SA-u-nu-latn", { timeZone: cfg.timeZone || "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false })),
            datasets: [{
              label: "الحرارة",
              data: temps,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHitRadius: 12,
              tension: .22,
              spanGaps: true
            }]
          },
          options
        };
        status.textContent = pts.length ? `قراءات اليوم: ${pts.length}` : "لا توجد بيانات كافية لليوم.";
      } else if (kind === "year-temp-rain") {
        const selectedYear = chartState.year;
        data = await getJson(api(`/api/history/year?year=${selectedYear}`));
        const pts = (data.points || []).slice().sort((a,b) => Number(a.month) - Number(b.month));
        const months = ["ينا","فبر","مار","أبر","ماي","يون","يول","أغس","سبت","أكت","نوف","ديس"];
        const highs = pts.map(p => finite(p.tempHigh));
        const lows = pts.map(p => finite(p.tempLow));
        const options = baseChartOptions(12);
        options.scales.temp = {
          type: "linear",
          position: "right",
          ...paddedRange([...highs, ...lows], 2),
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
              { type: "line", label: "العظمى", data: highs, yAxisID: "temp", borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: .2, spanGaps: true, order: 1 },
              { type: "line", label: "الصغرى", data: lows, yAxisID: "temp", borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: .2, spanGaps: true, order: 1 },
              { type: "bar", label: "المطر", data: pts.map(p => finite(p.rain) ?? 0), yAxisID: "rain", borderWidth: 0, barPercentage: .58, categoryPercentage: .78, order: 2 }
            ]
          },
          options
        };
        status.textContent = `${selectedYear} — العظمى والصغرى شهريًا، والمطر مجموع كل شهر.`;
      } else {
        const selectedYear = chartState.monthYear;
        const selectedMonth = chartState.month;
        data = await getJson(api(`/api/history/month?year=${selectedYear}&month=${selectedMonth}`));
        const pts = (data.points || []).slice().sort((a,b) => Number(a.day || 0) - Number(b.day || 0));
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
              { label: "متوسط الحرارة", data: temps, yAxisID: "temp", borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: .22, spanGaps: true },
              { label: "نقطة الندى", data: dews, yAxisID: "temp", borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: .22, spanGaps: true }
            ]
          },
          options
        };
        status.textContent = `${monthNames[selectedMonth - 1]} ${selectedYear} — متوسط الحرارة ونقطة الندى لكل يوم.`;
      }
      chart = new Chart(canvas, spec);
    } catch (e) {
      status.textContent = `تعذر جلب الشارت: ${e.message}`;
    }
  }

  const previousMarketPrices = new Map();
  let marketsLoading = false;
  let openStockSymbol = null;

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
  function compactVolume(value) {
    const n = finite(value);
    if (n === null) return "—";
    return n.toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 0 });
  }
  function buildMarketHeader(title) {
    const head = document.createElement("div"); head.className = "market-group-heading";
    const h = document.createElement("h3"); h.textContent = title; head.appendChild(h);
    return head;
  }
  function buildStockDetails(q) {
    const details = document.createElement("div"); details.className = "market-details"; details.hidden = true;
    const fields = [
      ["الإغلاق السابق", q.previousClose, 2], ["الافتتاح", q.open, 2],
      ["الأعلى", q.high, 2], ["الأدنى", q.low, 2]
    ];
    for (const [label, value, digits] of fields) {
      const cell = document.createElement("span"); cell.innerHTML = `<small>${label}:</small><strong>${fmt(value, digits)}</strong>`; details.appendChild(cell);
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
      const groups = [["index","المؤشرات"],["commodity","المعادن والطاقة"],["stock","الأسهم"]];
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
            row.innerHTML = `<span class="market-name">${item.name}</span><span class="num ${cls}">${fmt(q.price,2)} ${marketCurrency(q.currency)}</span><span class="num ${cls}">${change === null ? "—" : marketSigned(change)}</span><span class="num ${cls}">${pct === null ? "—" : marketSigned(pct,"%")}</span>`;
            if (key === "stock") {
              row.classList.add("stock-row"); row.tabIndex = 0; row.setAttribute("role", "button");
              const details = buildStockDetails(q);
              const isOpen = openStockSymbol === item.symbol;
              details.hidden = !isOpen;
              row.setAttribute("aria-expanded", isOpen ? "true" : "false");
              itemWrap.append(row, details);
              const toggle = () => {
                const willOpen = details.hidden;
                root.querySelectorAll(".market-details").forEach(el => { el.hidden = true; });
                root.querySelectorAll(".stock-row[aria-expanded=\"true\"]").forEach(el => el.setAttribute("aria-expanded", "false"));
                if (willOpen) {
                  details.hidden = false;
                  row.setAttribute("aria-expanded", "true");
                  openStockSymbol = item.symbol;
                } else {
                  openStockSymbol = null;
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

  function prayerCountdownState(times, now = new Date()) {
    const keys = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
    const current = currentRiyadhMinutes(now);
    const nextKey = nextPrayerKey(times, now);
    const nextIndex = keys.indexOf(nextKey);
    if (nextIndex < 0) return null;
    let target = timeToMinutes(times?.[nextKey]);
    if (target === null) return null;
    let previous;
    if (nextIndex === 0) {
      previous = timeToMinutes(times?.isha);
      if (previous === null) return null;
      if (current >= previous) target += 1440;
      else previous -= 1440;
    } else {
      previous = timeToMinutes(times?.[keys[nextIndex - 1]]);
      if (previous === null) return null;
    }
    const span = Math.max(1, target - previous);
    const remaining = Math.max(0, target - current);
    const ratio = Math.max(0, Math.min(1, remaining / span));
    return { nextKey, ratio, remaining };
  }

  function updatePrayerCountdown() {
    if (!prayerCountdownTimes) return;
    const state = prayerCountdownState(prayerCountdownTimes, new Date());
    if (!state) return;
    const names={fajr:"الفجر",dhuhr:"الظهر",asr:"العصر",maghrib:"المغرب",isha:"العشاء"};
    $("#prayerData")?.querySelectorAll("[data-prayer-key]").forEach(row => {
      row.classList.remove("next-prayer");
      row.removeAttribute("aria-label");
    });
    $("#prayerData")?.querySelectorAll(".prayer-countdown").forEach(el => el.remove());
    const row = $(`#prayerData [data-prayer-key="${state.nextKey}"]`);
    if (!row) return;
    row.classList.add("next-prayer");
    const meter = document.createElement("span");
    meter.className = "prayer-countdown";
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-valuenow", String(Math.round(state.ratio * 100)));
    meter.setAttribute("aria-label", `الوقت المتبقي حتى ${names[state.nextKey]}`);
    const fill = document.createElement("span");
    fill.className = "prayer-countdown-fill";
    fill.style.width = `${(state.ratio * 100).toFixed(1)}%`;
    meter.appendChild(fill);
    const dd = row.querySelector("dd");
    row.insertBefore(meter, dd || null);
    row.setAttribute("aria-label", `${names[state.nextKey]}، الصلاة القادمة`);
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
    if (kind === "month-temp-dew") { chartState.monthYear = now.year; chartState.month = now.month; }
    if (kind === "year-temp-rain") chartState.year = now.year;
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

  function showTab(name) {
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
  }

  setupPrayerInfo();
  setupWeatherInfo();
  setupChartPicker();

  $$(".tab").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
  $("#chartPrev").addEventListener("click",()=>moveChartPeriod(-1));
  $("#chartNext").addEventListener("click",()=>moveChartPeriod(1));
  const initial=["weather","history","radar","markets","prayer"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "weather";
  showTab(initial);
})();
