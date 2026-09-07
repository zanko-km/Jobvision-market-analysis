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

const JOBVISION_API = "https://candidateapi.jobvision.ir/api/v1/JobPost/List";
const PAGE_SIZE = 30;
const MAX_LIVE_PAGES = 10; // cap how many pages we pull live (10 * 30 = 300 jobs) for speed

async function fetchLivePage(keyword, page) {
  const res = await fetch(JOBVISION_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobCategoryUrlTitle: null,
      keyword: keyword,
      locationWrapper: null,
      pageSize: PAGE_SIZE,
      requestedPage: page,
      sortBy: 1,
      searchId: null,
    }),
  });
  if (!res.ok) throw new Error("bad response " + res.status);
  const json = await res.json();
  return json.data; // { jobPosts, jobPostCount }
}

function rawJobToRecord(job) {
  const properties = job.properties || {};
  const company = job.company || {};
  const location = job.location || {};
  const province = location.province || {};
  const city = location.city || {};
  const workType = job.workType || {};
  const seniority = job.seniorityLevel || {};

  return {
    id: job.id,
    title: job.title,
    company: company.nameFa,
    province: province.titleFa,
    city: city.titleFa,
    categories: (job.jobCategories || []).map((x) => x.titleFa).join(", "),
    work_type: workType.titleFa,
    seniority: seniority.titleFa,
    is_remote: properties.isRemote,
    salary: (job.salary || {}).titleFa,
    activation_date: (job.activationTime || {}).date,
  };
}

async function liveSearch(keyword) {
  const first = await fetchLivePage(keyword, 1);
  const total = first.data ? first.data.jobPostCount : first.jobPostCount;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pagesToFetch = Math.min(totalPages, MAX_LIVE_PAGES);

  let jobs = [...(first.jobPosts || [])];

  const pagePromises = [];
  for (let p = 2; p <= pagesToFetch; p++) {
    pagePromises.push(fetchLivePage(keyword, p));
  }
  const rest = await Promise.all(pagePromises);
  rest.forEach((d) => jobs.push(...(d.jobPosts || [])));

  return {
    total,
    shown: jobs.length,
    jobs: jobs.map(rawJobToRecord),
  };
}

async function doSearch() {
  const q = searchInput.value.trim();
  if (!q) return;

  backBtn.classList.remove("hidden");
  app.innerHTML = `<p class="info-box">در حال جستجوی زنده در JobVision...</p>`;

  try {
    const result = await liveSearch(q);
    renderSearchResults(result.jobs, q, result.total);
  } catch (err) {
    // Likely blocked by CORS or network - fall back to filtering the cached dataset
    console.warn("Live search failed, falling back to cached data:", err);
    const qLower = q.toLowerCase();
    const filtered = ALL_JOBS.filter((j) => {
      const title = (j.title || "").toLowerCase();
      const company = (j.company || "").toLowerCase();
      return title.includes(qLower) || company.includes(qLower);
    });
    renderSearchResults(filtered, q, filtered.length, true);
  }
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

function renderSearchResults(jobs, query, totalCount, isFallback) {
  destroyCharts();

  if (!jobs.length) {
    app.innerHTML = `<p class="info-box">هیچ آگهی‌ای برای «${escapeHtml(query)}» پیدا نشد.</p>`;
    return;
  }

  const total = totalCount !== undefined ? totalCount : jobs.length;
  const shownNote =
    total > jobs.length
      ? `(${jobs.length.toLocaleString("fa-IR")} مورد برای نمودار/جدول بارگذاری شد)`
      : "";
  const fallbackNote = isFallback
    ? `<br/><small>⚠️ دسترسی زنده به API ممکن نشد؛ این نتایج از داده‌ی ذخیره‌شده (عنوان/شرکت) فیلتر شدن.</small>`
    : "";

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
    <p class="info-box">${total.toLocaleString("fa-IR")} آگهی مطابق «${escapeHtml(query)}» پیدا شد ${shownNote}${fallbackNote}</p>
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