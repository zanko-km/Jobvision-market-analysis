const SEARCH_TARGET =
  "https://candidateapi.jobvision.ir/api/v1/JobPost/List";

const JOB_PAGE_TARGET =
  "https://jobvision.ir/jobs/";

const ALLOWED_ORIGIN =
  "https://zanko-km.github.io";

/*
 * ------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------
 */

const SEARCH_TIMEOUT_MS = 13000;
const JOB_DETAIL_TIMEOUT_MS = 15000;

const MAX_SEARCH_RETRIES = 3;
const MAX_JOB_DETAIL_RETRIES = 2;

const RETRY_BASE_DELAY_MS = 800;
const RETRY_MAX_DELAY_MS = 5000;
const RETRY_JITTER_MS = 400;


/*
 * ------------------------------------------------------------
 * CORS
 * ------------------------------------------------------------
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};


/*
 * ------------------------------------------------------------
 * Response helpers
 * ------------------------------------------------------------
 */

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json; charset=utf-8",
        ...extraHeaders,
      },
    }
  );
}


/*
 * ------------------------------------------------------------
 * General helpers
 * ------------------------------------------------------------
 */

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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


function normalizeSkillName(name) {
  return String(name)
    .replace(/\s+/g, " ")
    .trim();
}


/*
 * ------------------------------------------------------------
 * Fetch with timeout
 * ------------------------------------------------------------
 */

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 15000
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, timeoutMs);

  try {
    return await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal,
      }
    );
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        `Upstream request timed out after ${timeoutMs}ms`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}


/*
 * ------------------------------------------------------------
 * Retry helpers
 * ------------------------------------------------------------
 */

function shouldRetryStatus(status) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}


function getRetryDelay(
  response,
  attempt
) {
  const retryAfter =
    response?.headers?.get(
      "Retry-After"
    );

  if (retryAfter) {
    const seconds =
      Number(retryAfter);

    if (
      Number.isFinite(seconds)
    ) {
      return Math.min(
        Math.max(
          seconds * 1000,
          0
        ),
        RETRY_MAX_DELAY_MS
      );
    }

    const date =
      Date.parse(
        retryAfter
      );

    if (
      Number.isFinite(date)
    ) {
      return Math.min(
        Math.max(
          date - Date.now(),
          0
        ),
        RETRY_MAX_DELAY_MS
      );
    }
  }

  const exponential =
    Math.min(
      RETRY_MAX_DELAY_MS,
      RETRY_BASE_DELAY_MS *
        Math.pow(2, attempt)
    );

  const jitter =
    Math.floor(
      Math.random() *
        RETRY_JITTER_MS
    );

  return (
    exponential +
    jitter
  );
}


/*
 * ------------------------------------------------------------
 * Skill extraction
 * ------------------------------------------------------------
 */

function extractSkills(html) {
  const skills = [];

  const softwareSectionPatterns = [
    /نرم‌افزارها([\s\S]{0,15000})/i,
    /نرم افزارها([\s\S]{0,15000})/i,
    /مهارت‌های نرم‌افزاری([\s\S]{0,15000})/i,
    /مهارت های نرم افزاری([\s\S]{0,15000})/i,
  ];

  let sectionHtml = null;

  for (
    const pattern
    of softwareSectionPatterns
  ) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      sectionHtml =
        match[1];

      break;
    }
  }

  if (!sectionHtml) {
    return [];
  }

  const tagRegex =
    /<app-tag[\s\S]*?<span[^>]*class=["'][^"']*tag-title[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class=["'][^"']*tag-value[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/app-tag>/gi;

  let match;

  while (
    (
      match =
        tagRegex.exec(
          sectionHtml
        )
    ) !== null
  ) {
    const name =
      normalizeSkillName(
        stripHtml(match[1])
      );

    const level =
      stripHtml(match[2]);

    if (!name) {
      continue;
    }

    skills.push({
      name,
      level:
        level || null,
    });
  }

  /*
   * Remove duplicate skills.
   */
  const unique = [];
  const seen = new Set();

  for (
    const skill
    of skills
  ) {
    const key =
      skill.name.toLowerCase();

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    unique.push(skill);
  }

  return unique;
}


/*
 * ------------------------------------------------------------
 * Job detail upstream
 * ------------------------------------------------------------
 */

async function fetchJobPage(
  jobUrl
) {
  let lastError = null;

  for (
    let attempt = 0;
    attempt <
      MAX_JOB_DETAIL_RETRIES;
    attempt++
  ) {
    let upstream = null;

    try {
      upstream =
        await fetchWithTimeout(
          jobUrl,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",

              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

              "Accept-Language":
                "fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7",

              Referer:
                "https://jobvision.ir/",

              "Cache-Control":
                "no-cache",

              Pragma:
                "no-cache",
            },

            cache:
              "no-store",

            redirect:
              "follow",
          },
          JOB_DETAIL_TIMEOUT_MS
        );

      /*
       * Successful response.
       */
      if (upstream.ok) {
        return upstream;
      }

      /*
       * Permanent errors don't need retry.
       */
      if (
        !shouldRetryStatus(
          upstream.status
        )
      ) {
        return upstream;
      }

      lastError =
        new Error(
          `Job page returned ${upstream.status}`
        );

      const delay =
        getRetryDelay(
          upstream,
          attempt
        );

      /*
       * Release response body
       * before retrying.
       */
      try {
        await upstream.body?.cancel();
      } catch {
        // Ignore body cancellation errors.
      }

      if (
        attempt <
        MAX_JOB_DETAIL_RETRIES - 1
      ) {
        await sleep(delay);
      }
    } catch (error) {
      lastError = error;

      if (
        attempt <
        MAX_JOB_DETAIL_RETRIES - 1
      ) {
        await sleep(
          getRetryDelay(
            null,
            attempt
          )
        );
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Job page request failed"
    )
  );
}


/*
 * ------------------------------------------------------------
 * Job detail endpoint
 * ------------------------------------------------------------
 */

async function handleJobDetail(
  url
) {
  const id =
    url.searchParams.get(
      "id"
    );

  if (
    !id ||
    !/^\d+$/.test(id)
  ) {
    return jsonResponse(
      {
        error:
          "Invalid job id",
      },
      400
    );
  }

  try {
    const jobUrl =
      `${JOB_PAGE_TARGET}${id}`;

    const upstream =
      await fetchJobPage(
        jobUrl
      );

    if (!upstream.ok) {
      return jsonResponse(
        {
          error:
            `Job page returned ${upstream.status}`,
          id:
            Number(id),
        },
        upstream.status
      );
    }

    const html =
      await upstream.text();

    const skills =
      extractSkills(html);

    return jsonResponse({
      id:
        Number(id),

      skills,

      skillCount:
        skills.length,

      source:
        "jobvision-html",
    });
  } catch (error) {
    console.error(
      "JobVision job detail failed:",
      error
    );

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),

        id:
          Number(id),

        source:
          "jobvision-job-detail",
      },
      502
    );
  }
}


/*
 * ------------------------------------------------------------
 * Search upstream
 * ------------------------------------------------------------
 */

async function fetchSearchUpstream(
  body
) {
  let lastError = null;

  for (
    let attempt = 0;
    attempt <
      MAX_SEARCH_RETRIES;
    attempt++
  ) {
    let upstream = null;

    try {
      upstream =
        await fetchWithTimeout(
          SEARCH_TARGET,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json,text/plain,*/*",

              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",

              Origin:
                "https://jobvision.ir",

              Referer:
                "https://jobvision.ir/",

              "Cache-Control":
                "no-cache",

              Pragma:
                "no-cache",
            },

            cache:
              "no-store",

            redirect:
              "follow",

            body,
          },

          SEARCH_TIMEOUT_MS
        );

      /*
       * Success.
       */
      if (upstream.ok) {
        return upstream;
      }

      /*
       * Don't retry permanent 4xx errors.
       */
      if (
        !shouldRetryStatus(
          upstream.status
        )
      ) {
        return upstream;
      }

      lastError =
        new Error(
          `JobVision returned HTTP ${upstream.status}`
        );

      const delay =
        getRetryDelay(
          upstream,
          attempt
        );

      try {
        await upstream.body?.cancel();
      } catch {
        // Ignore body cancellation errors.
      }

      if (
        attempt <
        MAX_SEARCH_RETRIES - 1
      ) {
        await sleep(delay);
      }
    } catch (error) {
      lastError = error;

      if (
        attempt <
        MAX_SEARCH_RETRIES - 1
      ) {
        await sleep(
          getRetryDelay(
            null,
            attempt
          )
        );
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "JobVision search request failed"
    )
  );
}


/*
 * ------------------------------------------------------------
 * Search endpoint
 * ------------------------------------------------------------
 */

async function handleSearch(
  request
) {
  let body;

  try {
    body =
      await request.text();
  } catch {
    return jsonResponse(
      {
        ok: false,
        error:
          "Could not read request body",
      },
      400
    );
  }

  /*
   * Validate JSON before sending it.
   */
  try {
    JSON.parse(body);
  } catch {
    return jsonResponse(
      {
        ok: false,
        error:
          "Invalid JSON request body",
      },
      400
    );
  }

  try {
    const upstream =
      await fetchSearchUpstream(
        body
      );

    const data =
      await upstream.text();

    return new Response(
      data,
      {
        status:
          upstream.status,

        headers: {
          ...corsHeaders,

          "Content-Type":
            upstream.headers.get(
              "Content-Type"
            ) ||
            "application/json; charset=utf-8",
        },
      }
    );
  } catch (error) {
    console.error(
      "JobVision search failed:",
      error
    );

    return jsonResponse(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : String(error),

        source:
          "jobvision-search-proxy",
      },
      502
    );
  }
}


/*
 * ------------------------------------------------------------
 * Worker entry point
 * ------------------------------------------------------------
 */

export default {
  async fetch(request) {
    /*
     * CORS preflight.
     */
    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,

          headers:
            corsHeaders,
        }
      );
    }

    const url =
      new URL(request.url);

    /*
     * GET /job-detail?id=1504056
     */
    if (
      request.method === "GET" &&
      url.pathname ===
        "/job-detail"
    ) {
      return handleJobDetail(
        url
      );
    }

    /*
     * POST /
     *
     * JobVision search proxy.
     */
    if (
      request.method === "POST" &&
      url.pathname === "/"
    ) {
      return handleSearch(
        request
      );
    }

    return jsonResponse(
      {
        error:
          "Not found",
      },
      404
    );
  },
};