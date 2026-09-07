let ALL_JOBS = [];
let charts = [];

const app = document.getElementById("app");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const backBtn = document.getElementById("backBtn");
const updatedAtEl = document.getElementById("updatedAt");

init();

async function init() {
  try {
    const res = await fetch("data/jobs.json", { cache: "no-store" });
    const data = await res.json();
    ALL_JOBS = data.jobs || [];

    if (data.generated_at) {
      const d = new Date(data.generated_at);
      updatedAtEl.textContent = "آخرین به‌روزرسانی: " + d.toLocaleString("fa-IR");
    }

    renderOverview(ALL_JOBS);
  } catch (err) {
    app.innerHTML = `<p class="info-box">خطا در بارگذاری داده‌ها: ${err}</p>`;
  }
}

searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});
backBtn.addEventListener("click", () => {
  backBtn.classList.add("hidden");
  renderOverview(ALL_JOBS);
});

function doSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return;

  const filtered = ALL_JOBS.filter((j) => {
    const title = (j.title || "").toLowerCase();
    const company = (j.company || "").toLowerCase();
    return title.includes(q) || company.includes(q);
  });

  backBtn.classList.remove("hidden");
  renderSearchResults(filtered, searchInput.value.trim());
}

function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

function countBy(jobs, field, limit) {
  const counts = {};
  jobs.forEach((j) => {
    const v = j[field];
    if (v === null || v === undefined || v === "") return;
    counts[v] = (counts[v] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return limit ? entries.slice(0, limit) : entries;
}

function makeBarChart(containerId, title, entries) {
  const box = document.createElement("div");
  box.className = "chart-box";
  box.innerHTML = `<h3>${title}</h3><canvas></canvas>`;
  document.getElementById(containerId).appendChild(box);

  const ctx = box.querySelector("canvas").getContext("2d");
  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: entries.map((e) => e[0]),
      datasets: [{ label: title, data: entries.map((e) => e[1]), backgroundColor: "#ff4b4b" }],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      responsive: true,
    },
  });
  charts.push(chart);
}

function parseSalaryAvg(jobs) {
  const values = [];
  jobs.forEach((j) => {
    if (!j.salary) return;
    const nums = String(j.salary)
      .replace(/,/g, " ")
      .replace(/،/g, " ")
      .split(/\s+/)
      .map(Number)
      .filter((n) => !isNaN(n));
    if (nums.length >= 2) values.push((nums[0] + nums[1]) / 2);
    else if (nums.length === 1) values.push(nums[0]);
  });
  if (!values.length) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { avg, count: values.length };
}

function metricsHtml(jobs) {
  const total = jobs.length;
  const companies = new Set(jobs.map((j) => j.company).filter(Boolean)).size;
  const provinces = new Set(jobs.map((j) => j.province).filter(Boolean)).size;
  const remote = jobs.filter((j) => j.is_remote).length;

  return `
    <div class="metrics">
      <div class="metric-card"><div class="value">${total.toLocaleString("fa-IR")}</div><div class="label">💼 کل آگهی‌ها</div></div>
      <div class="metric-card"><div class="value">${companies.toLocaleString("fa-IR")}</div><div class="label">🏢 کارفرمایان</div></div>
      <div class="metric-card"><div class="value">${provinces.toLocaleString("fa-IR")}</div><div class="label">📍 استان‌ها</div></div>
      <div class="metric-card"><div class="value">${remote.toLocaleString("fa-IR")}</div><div class="label">🌐 دورکاری</div></div>
    </div>`;
}

function carouselHtml(jobs) {
  const sorted = [...jobs].sort((a, b) => new Date(b.activation_date || 0) - new Date(a.activation_date || 0));
  const top = sorted.slice(0, 20);

  const cards = top
    .map((j) => {
      const meta = [];
      if (j.province) meta.push(`📍 ${j.province}`);
      if (j.work_type) meta.push(`💼 ${j.work_type}`);
      if (j.seniority) meta.push(`🎯 ${j.seniority}`);
      if (j.is_remote) meta.push("🌐 دورکاری");

      return `
        <div class="job-card">
          <div class="job-title">${escapeHtml(j.title || "بدون عنوان")}</div>
          <div class="job-company">🏢 ${escapeHtml(j.company || "نامشخص")}</div>
          ${meta.map((m) => `<div class="job-meta">${escapeHtml(m)}</div>`).join("")}
        </div>`;
    })
    .join("");

  return `<div class="section-title">🔥 آخرین آگهی‌ها</div><div class="carousel">${cards}</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderOverview(jobs) {
  destroyCharts();

  app.innerHTML = `
    ${metricsHtml(jobs)}
    ${carouselHtml(jobs)}
    <div class="section-title">📊 نمودارها</div>
    <div class="charts-grid" id="chartsGrid"></div>
  `;

  makeBarChart("chartsGrid", "📍 آگهی به تفکیک استان", countBy(jobs, "province", 15));
  makeBarChart("chartsGrid", "💼 دسته‌بندی شغلی برتر", countBy(jobs, "categories", 15));
  makeBarChart("chartsGrid", "🏢 کارفرمایان برتر", countBy(jobs, "company", 15));
  makeBarChart("chartsGrid", "🎯 سطح تجربه", countBy(jobs, "seniority"));
  makeBarChart("chartsGrid", "📋 نوع همکاری", countBy(jobs, "work_type"));
}

function renderSearchResults(jobs, query) {
  destroyCharts();

  if (!jobs.length) {
    app.innerHTML = `<p class="info-box">هیچ آگهی‌ای برای «${escapeHtml(query)}» پیدا نشد.</p>`;
    return;
  }

  const salaryInfo = parseSalaryAvg(jobs);
  const salaryHtml = salaryInfo
    ? `<div class="metrics">
         <div class="metric-card"><div class="value">${salaryInfo.avg.toFixed(1)}</div><div class="label">💰 میانگین حقوق (میلیون تومان)</div></div>
         <div class="metric-card"><div class="value">${salaryInfo.count}</div><div class="label">📄 آگهی با اطلاعات حقوق</div></div>
       </div>`
    : "";

  const rows = jobs
    .slice(0, 200)
    .map(
      (j) => `<tr>
        <td>${escapeHtml(j.title || "")}</td>
        <td>${escapeHtml(j.company || "")}</td>
        <td>${escapeHtml(j.province || "")}</td>
        <td>${escapeHtml(j.seniority || "")}</td>
        <td>${escapeHtml(j.work_type || "")}</td>
        <td>${escapeHtml(j.salary || "")}</td>
      </tr>`
    )
    .join("");

  app.innerHTML = `
    <p class="info-box">${jobs.length.toLocaleString("fa-IR")} آگهی مطابق «${escapeHtml(query)}» پیدا شد</p>
    ${salaryHtml}
    <div class="section-title">📊 نمودارها</div>
    <div class="charts-grid" id="chartsGrid"></div>
    <div class="section-title">📄 لیست آگهی‌ها</div>
    <div class="results-table">
      <table>
        <thead><tr><th>عنوان</th><th>شرکت</th><th>استان</th><th>سطح تجربه</th><th>نوع همکاری</th><th>حقوق</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  makeBarChart("chartsGrid", "🏢 کارفرمایان برتر", countBy(jobs, "company", 10));
  makeBarChart("chartsGrid", "📍 موقعیت مکانی", countBy(jobs, "province", 10));
  makeBarChart("chartsGrid", "🎯 سطح تجربه", countBy(jobs, "seniority"));
  makeBarChart("chartsGrid", "📋 نوع همکاری", countBy(jobs, "work_type"));
}
