const SEARCH_TARGET =
  "https://candidateapi.jobvision.ir/api/v1/JobPost/List";

const JOB_PAGE_TARGET =
  "https://jobvision.ir/jobs/";

const ALLOWED_ORIGIN =
  "https://zanko-km.github.io";

const SEARCH_TIMEOUT_MS = 15000;
const JOB_DETAIL_TIMEOUT_MS = 15000;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "https://zanko-km.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Cache-Control, Accept",
    "Vary": "Origin",
  };
}

function json(res, status, body) {
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  res.status(status);
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(JSON.stringify(body));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryable(status) {
  return [
    408,
    425,
    429,
    500,
    502,
    503,
    504,
  ].includes(status);
}

async function fetchWithTimeout(
  url,
  options,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(
      url,
      {
        ...options,
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url,
  options,
  timeoutMs,
  retries = 2
) {
  let lastError;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const response =
        await fetchWithTimeout(
          url,
          options,
          timeoutMs
        );

      if (
        response.ok ||
        !retryable(response.status) ||
        attempt === retries
      ) {
        return response;
      }

      try {
        await response.body?.cancel();
      } catch {}

      await sleep(
        700 * Math.pow(2, attempt)
      );
    } catch (error) {
      lastError = error;

      if (
        attempt === retries
      ) {
        throw lastError;
      }

      await sleep(
        700 * Math.pow(2, attempt)
      );
    }
  }

  throw (
    lastError ||
    new Error(
      "Upstream request failed"
    )
  );
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSkills(html) {
  const sectionPatterns = [
    /نرم‌افزارها([\s\S]{0,15000})/i,
    /نرم افزارها([\s\S]{0,15000})/i,
    /مهارت‌های نرم‌افزاری([\s\S]{0,15000})/i,
    /مهارت های نرم افزاری([\s\S]{0,15000})/i,
  ];

  let section = null;

  for (
    const pattern of sectionPatterns
  ) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      section = match[1];
      break;
    }
  }

  if (!section) {
    return [];
  }

  const tagRegex =
    /<app-tag[\s\S]*?<span[^>]*class=["'][^"']*tag-title[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class=["'][^"']*tag-value[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/app-tag>/gi;

  const skills = [];
  const seen = new Set();

  let match;

  while (
    (match = tagRegex.exec(section)) !== null
  ) {
    const name =
      stripHtml(match[1])
        .replace(/\s+/g, " ")
        .trim();

    const level =
      stripHtml(match[2]);

    if (!name) {
      continue;
    }

    const key =
      name.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    skills.push({
      name,
      level: level || null,
    });
  }

  return skills;
}

async function handleSearch(
  req,
  res
) {
  let body = "";

  try {
    for await (
      const chunk of req
    ) {
      body += chunk;
    }
  } catch {
    return json(
      res,
      400,
      {
        ok: false,
        error:
          "Could not read request body",
      }
    );
  }

  try {
    JSON.parse(body);
  } catch {
    return json(
      res,
      400,
      {
        ok: false,
        error:
          "Invalid JSON request body",
      }
    );
  }

  try {
    const upstream =
      await fetchWithRetry(
        SEARCH_TARGET,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json,text/plain,*/*",

            "User-Agent":
              "Mozilla/5.0 (compatible; JobVisionMarketAnalysis/1.0)",
          },

          body,
        },

        SEARCH_TIMEOUT_MS,

        2
      );

    const data =
      await upstream.text();

    Object.entries(
      corsHeaders()
    ).forEach(
      ([key, value]) => {
        res.setHeader(
          key,
          value
        );
      }
    );

    res.status(
      upstream.status
    );

    res.setHeader(
      "Content-Type",
      upstream.headers.get(
        "content-type"
      ) ||
        "application/json; charset=utf-8"
    );

    return res.end(data);
  } catch (error) {
    console.error(
      "JobVision search failed:",
      error
    );

    return json(
      res,
      502,
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : String(error),

        source:
          "vercel-jobvision-search",
      }
    );
  }
}

async function handleJobDetail(
  req,
  res
) {
  const id =
    String(
      req.query?.id || ""
    );

  if (
    !/^\d+$/.test(id)
  ) {
    return json(
      res,
      400,
      {
        error:
          "Invalid job id",
      }
    );
  }

  try {
    const upstream =
      await fetchWithRetry(
        `${JOB_PAGE_TARGET}${id}`,

        {
          headers: {
            Accept:
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "fa-IR,fa;q=0.9,en;q=0.8",

            "User-Agent":
              "Mozilla/5.0 (compatible; JobVisionMarketAnalysis/1.0)",
          },
        },

        JOB_DETAIL_TIMEOUT_MS,

        1
      );

    if (!upstream.ok) {
      return json(
        res,
        upstream.status,
        {
          error:
            `Job page returned ${upstream.status}`,

          id:
            Number(id),
        }
      );
    }

    const html =
      await upstream.text();

    const skills =
      extractSkills(html);

    return json(
      res,
      200,
      {
        id:
          Number(id),

        skills,

        skillCount:
          skills.length,

        source:
          "jobvision-html",
      }
    );
  } catch (error) {
    console.error(
      "JobVision job detail failed:",
      error
    );

    return json(
      res,
      502,
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),

        id:
          Number(id),

        source:
          "vercel-jobvision-detail",
      }
    );
  }
}

module.exports =
  async function handler(
    req,
    res
  ) {
    Object.entries(
      corsHeaders()
    ).forEach(
      ([key, value]) => {
        res.setHeader(
          key,
          value
        );
      }
    );

    if (
      req.method ===
      "OPTIONS"
    ) {
      res.status(204);
      return res.end();
    }

    const route =
      req.query?.route;

    if (
      route === "search" &&
      req.method === "POST"
    ) {
      return handleSearch(
        req,
        res
      );
    }

    if (
      route === "job-detail" &&
      req.method === "GET"
    ) {
      return handleJobDetail(
        req,
        res
      );
    }

    return json(
      res,
      404,
      {
        error:
          "Not found",
      }
    );
  };