require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { URL } = require('url');

const { GoogleGenerativeAI } = require('@google/generative-ai');

const chromium = require('@sparticuz/chromium');
const { chromium: playwrightChromium } = require('playwright');

const chromeLauncher = require('chrome-launcher');

const app = express();

const PORT = process.env.PORT || 3000;
const isVercel = !!process.env.VERCEL;


// ============================================================
// GEMINI CONFIGURATION
// ============================================================
//
// Primary model can be changed from .env.
//
// Recommended:
//
// GEMINI_MODEL=gemini-3.8-flash
// GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite
//
// If you already have a different model in .env,
// that model will be used as the primary model.
//

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.8-flash';

const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL ||
  'gemini-3.5-flash-lite';


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

app.use(
  express.json({
    limit: '10mb',
  })
);

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


// ============================================================
// URL VALIDATION
// ============================================================

function isValidUrl(string) {
  try {
    const url = new URL(string);

    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:'
    );
  } catch (_) {
    return false;
  }
}


// ============================================================
// BROWSER LAUNCHER
// ============================================================

async function launchBrowser() {

  // ----------------------------------------------------------
  // VERCEL / SERVERLESS
  // ----------------------------------------------------------

  if (
    isVercel ||
    process.env.AWS_LAMBDA_FUNCTION_VERSION
  ) {

    const executablePath =
      await chromium.executablePath();

    console.log(
      'Launching Chromium in serverless mode...'
    );

    return await playwrightChromium.launch({

      args: [
        ...chromium.args,

        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',

        '--hide-scrollbars',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],

      executablePath,

      headless: true,
    });
  }


  // ----------------------------------------------------------
  // LOCAL WINDOWS
  // ----------------------------------------------------------

  console.log(
    'Launching local Playwright Chromium...'
  );

  return await playwrightChromium.launch({
    headless: true,
  });
}


// ============================================================
// PLAYWRIGHT WEBSITE ANALYSIS
// ============================================================

async function analyzeWithBrowser(url) {

  let browser;
  let context;

  try {

    browser =
      await launchBrowser();


    context =
      await browser.newContext({

        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/120.0.0.0 Safari/537.36',

        ignoreHTTPSErrors: true,

        javaScriptEnabled: true,
      });


    // ========================================================
    // DESKTOP
    // ========================================================

    console.log(
      'Opening desktop version...'
    );


    const desktopPage =
      await context.newPage();


    await desktopPage.setViewportSize({
      width: 1440,
      height: 900,
    });


    await desktopPage.goto(url, {

      waitUntil:
        'domcontentloaded',

      timeout:
        30000,
    });


    // Give JavaScript, images and animations
    // some time to settle.

    await desktopPage.waitForTimeout(
      2500
    );


    console.log(
      'Taking desktop screenshot...'
    );


    const desktopScreenshot =
      await desktopPage.screenshot({

        fullPage: true,

        type: 'jpeg',

        quality: 70,
      });


    // ========================================================
    // PAGE INFORMATION
    // ========================================================

    const pageInfo =
      await desktopPage.evaluate(() => {

        const getMeta =
          (name) => {

            const el =
              document.querySelector(
                `meta[name="${name}"], meta[property="${name}"]`
              );

            return el
              ? el.content
              : null;
          };


        return {

          title:
            document.title || '',

          description:
            getMeta('description') ||
            getMeta('og:description') ||
            '',

          h1Count:
            document.querySelectorAll(
              'h1'
            ).length,

          h2Count:
            document.querySelectorAll(
              'h2'
            ).length,

          imgCount:
            document.querySelectorAll(
              'img'
            ).length,

          linkCount:
            document.querySelectorAll(
              'a'
            ).length,

          buttonCount:
            document.querySelectorAll(
              'button, [role="button"], input[type="submit"]'
            ).length,

          formCount:
            document.querySelectorAll(
              'form'
            ).length,

          hasNav:
            !!document.querySelector(
              'nav, [role="navigation"]'
            ),

          bodyTextLength:
            (
              document.body?.innerText ||
              ''
            ).length,

          lang:
            document.documentElement.lang ||
            '',

          viewportMeta:
            !!document.querySelector(
              'meta[name="viewport"]'
            ),
        };
      });


    // ========================================================
    // MOBILE
    // ========================================================

    console.log(
      'Opening mobile version...'
    );


    const mobilePage =
      await context.newPage();


    await mobilePage.setViewportSize({
      width: 390,
      height: 844,
    });


    await mobilePage.goto(url, {

      waitUntil:
        'domcontentloaded',

      timeout:
        30000,
    });


    await mobilePage.waitForTimeout(
      2500
    );


    console.log(
      'Taking mobile screenshot...'
    );


    const mobileScreenshot =
      await mobilePage.screenshot({

        fullPage: true,

        type: 'jpeg',

        quality: 70,
      });


    // ========================================================
    // CLOSE BROWSER
    // ========================================================

    await context.close();

    context = null;


    await browser.close();

    browser = null;


    console.log(
      'Browser analysis completed.'
    );


    // ========================================================
    // RETURN
    // ========================================================

    return {

      desktopScreenshot:
        desktopScreenshot.toString(
          'base64'
        ),

      mobileScreenshot:
        mobileScreenshot.toString(
          'base64'
        ),

      pageInfo,

      success: true,
    };


  } catch (err) {

    if (context) {

      try {
        await context.close();
      } catch (_) {}

    }


    if (browser) {

      try {
        await browser.close();
      } catch (_) {}

    }


    console.error(
      'PLAYWRIGHT ERROR:',
      err
    );


    throw err;
  }
}


// ============================================================
// LIGHTHOUSE
// ============================================================
//
// IMPORTANT:
//
// Lighthouse is loaded with dynamic import.
//
// This avoids the:
//
// TypeError: lighthouse is not a function
//
// problem caused by CommonJS / ESM module interop.
//

async function runLighthouse(url) {

  let chrome;

  try {

    console.log(
      'Starting Lighthouse...'
    );


    // --------------------------------------------------------
    // LOAD LIGHTHOUSE
    // --------------------------------------------------------

    const lighthouseModule =
      await import(
        'lighthouse'
      );


    const lighthouse =
      lighthouseModule.default ||
      lighthouseModule;


    if (
      typeof lighthouse !== 'function'
    ) {

      throw new Error(
        'Unable to load Lighthouse correctly. Please check your Lighthouse installation and Node.js version.'
      );
    }


    // --------------------------------------------------------
    // CHROME FLAGS
    // --------------------------------------------------------

    const chromeFlags = [

      '--headless',

      '--no-sandbox',

      '--disable-setuid-sandbox',

      '--disable-dev-shm-usage',

      '--disable-gpu',

      '--hide-scrollbars',

      '--disable-background-networking',

      '--disable-background-timer-throttling',

      '--disable-renderer-backgrounding',
    ];


    // --------------------------------------------------------
    // SERVERLESS CHROME PATH
    // --------------------------------------------------------

    let chromePath;


    if (
      isVercel ||
      process.env.AWS_LAMBDA_FUNCTION_VERSION
    ) {

      chromePath =
        await chromium.executablePath();


      console.log(
        'Lighthouse using serverless Chromium.'
      );
    }


    // --------------------------------------------------------
    // LAUNCH CHROME
    // --------------------------------------------------------

    chrome =
      await chromeLauncher.launch({

        chromePath,

        chromeFlags,
      });


    console.log(
      `Lighthouse Chrome running on port ${chrome.port}`
    );


    // --------------------------------------------------------
    // LIGHTHOUSE OPTIONS
    // --------------------------------------------------------

    const options = {

      port:
        chrome.port,

      output:
        'json',

      onlyCategories: [

        'performance',

        'accessibility',

        'best-practices',

        'seo',
      ],

      formFactor:
        'desktop',

      screenEmulation: {

        mobile:
          false,

        width:
          1440,

        height:
          900,

        deviceScaleFactor:
          1,

        disabled:
          false,
      },

      throttling: {

        rttMs:
          40,

        throughputKbps:
          10 * 1024,

        cpuSlowdownMultiplier:
          1,
      },

      logLevel:
        'error',
    };


    // --------------------------------------------------------
    // RUN LIGHTHOUSE
    // --------------------------------------------------------

    console.log(
      'Running Lighthouse audit...'
    );


    const runnerResult =
      await lighthouse(
        url,
        options
      );


    if (
      !runnerResult ||
      !runnerResult.lhr
    ) {

      throw new Error(
        'Lighthouse did not return a valid report.'
      );
    }


    const lhr =
      runnerResult.lhr;


    // --------------------------------------------------------
    // CLOSE CHROME
    // --------------------------------------------------------

    await chrome.kill();

    chrome = null;


    console.log(
      'Lighthouse completed successfully.'
    );


    // --------------------------------------------------------
    // RETURN LIGHTHOUSE DATA
    // --------------------------------------------------------

    return {

      performance:
        Math.round(
          (
            lhr.categories.performance?.score ||
            0
          ) * 100
        ),


      accessibility:
        Math.round(
          (
            lhr.categories.accessibility?.score ||
            0
          ) * 100
        ),


      bestPractices:
        Math.round(
          (
            lhr.categories[
              'best-practices'
            ]?.score ||
            0
          ) * 100
        ),


      seo:
        Math.round(
          (
            lhr.categories.seo?.score ||
            0
          ) * 100
        ),


      metrics: {

        fcp:
          lhr.audits[
            'first-contentful-paint'
          ]?.displayValue ||
          'N/A',


        lcp:
          lhr.audits[
            'largest-contentful-paint'
          ]?.displayValue ||
          'N/A',


        tbt:
          lhr.audits[
            'total-blocking-time'
          ]?.displayValue ||
          'N/A',


        cls:
          lhr.audits[
            'cumulative-layout-shift'
          ]?.displayValue ||
          'N/A',


        si:
          lhr.audits[
            'speed-index'
          ]?.displayValue ||
          'N/A',
      },


      success:
        true,
    };


  } catch (err) {

    if (chrome) {

      try {
        await chrome.kill();
      } catch (_) {}

    }


    console.error(
      'LIGHTHOUSE ERROR:',
      err
    );


    // Lighthouse failure should NOT
    // completely destroy the analysis.
    //
    // Gemini can still analyze the
    // screenshots.

    return {

      performance:
        null,

      accessibility:
        null,

      bestPractices:
        null,

      seo:
        null,

      metrics:
        {},

      success:
        false,

      error:
        err.message,
    };
  }
}


// ============================================================
// WAIT HELPER
// ============================================================

function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}


// ============================================================
// GEMINI MODEL CREATOR
// ============================================================

function createGeminiModel(
  modelName
) {

  const genAI =
    new GoogleGenerativeAI(
      process.env.GEMINI_API_KEY
    );


  return genAI.getGenerativeModel({

    model:
      modelName,

    generationConfig: {

      responseMimeType:
        'application/json',
    },
  });
}


// ============================================================
// GEMINI RETRY HELPER
// ============================================================
//
// Retries temporary errors:
//
// 429 = rate limit
// 503 = service/model temporarily unavailable
//
// If the primary model keeps failing,
// analyzeWithGemini() will switch to
// the fallback model.
//

async function generateGeminiWithRetry(
  model,
  content,
  modelName,
  retries = 2
) {

  let lastError;


  for (
    let attempt = 0;
    attempt < retries;
    attempt++
  ) {

    try {

      console.log(
        `Gemini [${modelName}] request attempt ${attempt + 1}/${retries}...`
      );


      const result =
        await model.generateContent(
          content
        );


      console.log(
        `Gemini [${modelName}] request successful.`
      );


      return result;


    } catch (err) {

      lastError =
        err;


      const status =
        err?.status;


      // ------------------------------------------------------
      // Non-temporary error
      // ------------------------------------------------------

      if (
        status !== 503 &&
        status !== 429
      ) {

        throw err;
      }


      // ------------------------------------------------------
      // No more retries
      // ------------------------------------------------------

      if (
        attempt ===
        retries - 1
      ) {

        break;
      }


      // ------------------------------------------------------
      // Exponential backoff
      // ------------------------------------------------------

      const delay =
        1500 *
        Math.pow(
          2,
          attempt
        );


      console.log(
        `Gemini [${modelName}] returned ${status}. ` +
        `Retrying in ${delay}ms...`
      );


      await sleep(
        delay
      );
    }
  }


  throw lastError;
}


// ============================================================
// GEMINI ANALYSIS
// ============================================================

async function analyzeWithGemini(
  desktopBase64,
  mobileBase64,
  pageInfo,
  lighthouseData,
  url
) {

  if (
    !process.env.GEMINI_API_KEY
  ) {

    throw new Error(
      'GEMINI_API_KEY is not configured in .env'
    );
  }


  console.log(
    `Primary Gemini model: ${GEMINI_MODEL}`
  );


  console.log(
    `Fallback Gemini model: ${GEMINI_FALLBACK_MODEL}`
  );


  // ==========================================================
  // PROMPT
  // ==========================================================

  const prompt = `
You are an expert website design auditor, UX analyst, visual designer and web quality reviewer.

Analyze the provided screenshots of a LIVE publicly accessible website along with page metadata and Lighthouse data.

IMPORTANT RULES:

- Base the visual analysis primarily on what is actually visible in the screenshots.
- Be specific and evidence-based.
- Do not invent features that are not visible.
- Do not claim the website was created by AI.
- The AI-Like Design Score measures only how strongly the visual design resembles common AI-generated or AI-builder website patterns.
- High AI-Like Design Score = strongly resembles generic AI-builder / template visual patterns.
- Low AI-Like Design Score = distinctive, intentional and original visual identity.
- Scores must be integers from 0 to 100.
- Recommendations must be practical and actionable.
- Do not praise something unless there is visible evidence for it.
- Compare desktop and mobile screenshots carefully when discussing responsiveness.
- Return ONLY valid JSON.
- Do not use markdown.
- Do not add explanations outside the JSON.

Website URL:
${url}

Page metadata:
${JSON.stringify(pageInfo, null, 2)}

Lighthouse data:
${JSON.stringify(lighthouseData, null, 2)}


Analyze these areas:

1. Visual Design
2. Layout & Structure
3. Typography
4. Color System
5. Spacing
6. Visual Hierarchy
7. UX / Usability
8. Responsiveness
9. Accessibility
10. Content Presentation
11. Consistency
12. AI-Like Design Patterns


AI-Like Design patterns to consider include:

- generic purple/blue gradients
- excessive gradients
- glassmorphism used without purpose
- excessive glowing effects
- decorative blobs
- repeated three-card feature sections
- generic SaaS hero layouts
- oversized generic headlines
- default-looking Inter/Geist-style typography
- excessive rounded cards
- excessive pill-shaped UI
- template-like section structure
- generic AI SaaS visual language
- lack of distinctive brand identity
- repetitive layouts with little visual personality

Also recognize positive originality signals such as:

- distinctive typography choices
- strong brand identity
- unusual but coherent composition
- purposeful visual rhythm
- custom imagery
- editorial layouts
- intentional asymmetry
- meaningful use of whitespace
- domain-specific visual language
- restrained and coherent effects


Return this exact JSON structure:

{
  "summary": "2-3 sentence overall assessment of the website's visual quality and user experience.",

  "ai_like_design_score": 0,

  "ai_like_design_reasoning": "Detailed explanation based only on visible evidence.",

  "categories": {

    "visual_design": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "layout": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "typography": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "color": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "spacing": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "visual_hierarchy": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "ux": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "responsiveness": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "accessibility": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "content": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    },

    "consistency": {
      "score": 0,
      "strengths": [],
      "issues": [],
      "recommendations": []
    }
  },

  "strengths_overall": [
    {
      "title": "Short title",
      "description": "Concrete explanation supported by visible evidence."
    }
  ],

  "improvements": [
    {
      "category": "Category name",
      "score": 0,
      "priority": "High",
      "problem": "Specific problem observed.",
      "why_it_matters": "Explain the user or business impact.",
      "recommendation": "Clear actionable fix."
    }
  ],

  "insights": [
    {
      "category": "Category",
      "severity": "High",
      "observation": "Specific observation.",
      "recommendation": "Specific recommendation."
    }
  ],

  "improvement_opportunities": [
    {
      "area": "Typography",
      "potential_points": 8,
      "note": "Brief reason."
    }
  ]
}
`;


  // ==========================================================
  // IMAGE PARTS
  // ==========================================================

  const imageParts = [

    {
      inlineData: {

        mimeType:
          'image/jpeg',

        data:
          desktopBase64,
      },
    },


    {
      inlineData: {

        mimeType:
          'image/jpeg',

        data:
          mobileBase64,
      },
    },

  ];


  // ==========================================================
  // MODELS TO TRY
  // ==========================================================

  const modelNames = [
    GEMINI_MODEL,
    GEMINI_FALLBACK_MODEL,
  ].filter(
    (value, index, array) =>
      value &&
      array.indexOf(value) === index
  );


  let lastError;


  // ==========================================================
  // TRY PRIMARY THEN FALLBACK
  // ==========================================================

  for (
    let i = 0;
    i < modelNames.length;
    i++
  ) {

    const modelName =
      modelNames[i];


    console.log(
      `Trying Gemini model ${i + 1}/${modelNames.length}: ${modelName}`
    );


    const model =
      createGeminiModel(
        modelName
      );


    try {

      const result =
        await generateGeminiWithRetry(

          model,

          [
            prompt,
            ...imageParts,
          ],

          modelName,

          2
        );


      const response =
        await result.response;


      const text =
        response.text();


      console.log(
        `Gemini analysis received from ${modelName}.`
      );


      // ------------------------------------------------------
      // PARSE JSON
      // ------------------------------------------------------

      let parsed;


      try {

        parsed =
          JSON.parse(
            text
          );


      } catch (_) {

        // Gemini sometimes wraps JSON
        // despite being instructed not to.

        const match =
          text.match(
            /\{[\s\S]*\}/
          );


        if (!match) {

          throw new Error(
            'Gemini returned invalid JSON.'
          );
        }


        try {

          parsed =
            JSON.parse(
              match[0]
            );


        } catch (jsonError) {

          throw new Error(
            'Failed to parse Gemini JSON response.'
          );
        }
      }


      return parsed;


    } catch (err) {

      lastError =
        err;


      console.error(
        `Gemini model ${modelName} failed:`,
        err.message
      );


      // ------------------------------------------------------
      // ONLY FALL BACK FOR TEMPORARY MODEL ERRORS
      // ------------------------------------------------------

      const status =
        err?.status;


      if (
        status !== 503 &&
        status !== 429
      ) {

        throw err;
      }


      // If another model exists,
      // continue to fallback.

      if (
        i <
        modelNames.length - 1
      ) {

        console.log(
          `Model ${modelName} unavailable. ` +
          `Switching to fallback model ${modelNames[i + 1]}...`
        );


        await sleep(
          1000
        );
      }
    }
  }


  throw lastError ||
    new Error(
      'All Gemini models failed.'
    );
}


// ============================================================
// OVERALL SCORE
// ============================================================

function calculateOverallScore(
  categories,
  lighthouseData
) {

  const weights = {

    visual_design:
      1.0,

    layout:
      1.0,

    typography:
      0.9,

    color:
      0.9,

    spacing:
      0.85,

    visual_hierarchy:
      1.1,

    ux:
      1.1,

    responsiveness:
      1.0,

    accessibility:
      0.95,

    content:
      0.85,

    consistency:
      0.9,
  };


  let totalWeight =
    0;


  let weightedSum =
    0;


  for (
    const [key, cat]
    of Object.entries(
      categories || {}
    )
  ) {

    const weight =
      weights[key] ||
      1;


    const score =
      typeof cat?.score ===
      'number'

        ? cat.score

        : 50;


    weightedSum +=
      score *
      weight;


    totalWeight +=
      weight;
  }


  // ----------------------------------------------------------
  // LIGHTHOUSE PERFORMANCE
  // ----------------------------------------------------------

  if (
    lighthouseData?.success
  ) {

    if (
      typeof lighthouseData.performance ===
      'number'
    ) {

      weightedSum +=
        lighthouseData.performance *
        0.8;


      totalWeight +=
        0.8;
    }
  }


  if (
    totalWeight === 0
  ) {

    return 50;
  }


  const overall =
    Math.round(
      weightedSum /
      totalWeight
    );


  return Math.max(
    0,
    Math.min(
      100,
      overall
    )
  );
}


// ============================================================
// MAIN ANALYSIS ENDPOINT
// ============================================================

app.post(
  '/api/analyze',
  async (req, res) => {

    const startTime =
      Date.now();


    try {

      // ======================================================
      // READ URL
      // ======================================================

      const {
        url
      } = req.body;


      if (
        !url ||
        typeof url !== 'string'
      ) {

        return res.status(400).json({

          error:
            'Please provide a valid website URL.',
        });
      }


      // ======================================================
      // NORMALIZE URL
      // ======================================================

      let targetUrl =
        url.trim();


      if (
        !/^https?:\/\//i.test(
          targetUrl
        )
      ) {

        targetUrl =
          'https://' +
          targetUrl;
      }


      // ======================================================
      // VALIDATE URL
      // ======================================================

      if (
        !isValidUrl(
          targetUrl
        )
      ) {

        return res.status(400).json({

          error:
            'Invalid URL. Please enter a valid HTTP or HTTPS website URL.',
        });
      }


      // ======================================================
      // START LOGGING
      // ======================================================

      console.log('');

      console.log(
        '========================================'
      );

      console.log(
        'WEBGRADE ANALYSIS STARTED'
      );

      console.log(
        targetUrl
      );

      console.log(
        '========================================'
      );


      // ======================================================
      // STEP 1: PLAYWRIGHT
      // ======================================================

      let browserResult;


      try {

        console.log(
          'STEP 1: Rendering website...'
        );


        browserResult =
          await analyzeWithBrowser(
            targetUrl
          );


      } catch (err) {

        console.error(
          'Browser error:',
          err.message
        );


        const message =
          err.message ||
          '';


        const friendlyMessage =

          /timeout/i.test(
            message
          )

            ? 'The website took too long to load or did not respond.'

            : /net::|ERR_/i.test(
                message
              )

            ? 'Unable to reach the website. It may be down, blocking automated browsers, or require authentication.'

            : 'Failed to render the website. Please check the URL and try again.';


        return res.status(422).json({

          error:
            friendlyMessage,

          details:
            process.env.NODE_ENV ===
            'development'

              ? message

              : undefined,
        });
      }


      // ======================================================
      // STEP 2: LIGHTHOUSE
      // ======================================================

      console.log(
        'STEP 2: Running Lighthouse...'
      );


      const lighthouseData =
        await runLighthouse(
          targetUrl
        );


      // ======================================================
      // STEP 3: GEMINI
      // ======================================================

      console.log(
        'STEP 3: Running Gemini visual analysis...'
      );


      let geminiResult;


      try {

        geminiResult =
          await analyzeWithGemini(

            browserResult.desktopScreenshot,

            browserResult.mobileScreenshot,

            browserResult.pageInfo,

            lighthouseData,

            targetUrl
          );


      } catch (err) {

        console.error(
          'GEMINI ERROR:',
          err
        );


        return res.status(502).json({

          error:
            'AI analysis failed. Please try again in a moment.',

          details:
            err.message,

          status:
            err.status ||
            null,
        });
      }


      // ======================================================
      // STEP 4: OVERALL SCORE
      // ======================================================

      const overallScore =
        calculateOverallScore(

          geminiResult.categories,

          lighthouseData
        );


      // ======================================================
      // CATEGORY MAPPING
      // ======================================================

      const categoryScores =
        {};


      const keyMap = {

        visual_design:
          'Visual Design',

        layout:
          'Layout',

        typography:
          'Typography',

        color:
          'Color System',

        spacing:
          'Spacing',

        visual_hierarchy:
          'Visual Hierarchy',

        ux:
          'UX / Usability',

        responsiveness:
          'Responsiveness',

        accessibility:
          'Accessibility',

        content:
          'Content Presentation',

        consistency:
          'Consistency',
      };


      for (
        const [key, value]
        of Object.entries(
          geminiResult.categories ||
          {}
        )
      ) {

        categoryScores[
          keyMap[key] ||
          key
        ] = {

          score:
            typeof value?.score ===
            'number'

              ? value.score

              : 50,

          strengths:
            Array.isArray(
              value?.strengths
            )

              ? value.strengths

              : [],

          issues:
            Array.isArray(
              value?.issues
            )

              ? value.issues

              : [],

          recommendations:
            Array.isArray(
              value?.recommendations
            )

              ? value.recommendations

              : [],
        };
      }


      // ======================================================
      // PERFORMANCE CATEGORY
      // ======================================================

      if (
        lighthouseData.success &&
        typeof lighthouseData.performance ===
        'number'
      ) {

        categoryScores[
          'Performance'
        ] = {

          score:
            lighthouseData.performance,

          strengths:
            [],

          issues:
            [],

          recommendations:
            [],
        };
      }


      // ======================================================
      // FINAL RESPONSE
      // ======================================================

      const responsePayload = {

        url:
          targetUrl,


        analyzedAt:
          new Date().toISOString(),


        durationMs:
          Date.now() -
          startTime,


        overallScore:
          overallScore,


        aiLikeDesignScore:

          typeof geminiResult
            .ai_like_design_score ===
          'number'

            ? geminiResult
                .ai_like_design_score

            : 50,


        aiLikeDesignReasoning:

          geminiResult
            .ai_like_design_reasoning ||
          '',


        summary:

          geminiResult.summary ||
          '',


        categoryScores:
          categoryScores,


        strengths:

          Array.isArray(
            geminiResult
              .strengths_overall
          )

            ? geminiResult
                .strengths_overall

            : [],


        improvements:

          Array.isArray(
            geminiResult.improvements
          )

            ? geminiResult
                .improvements

            : [],


        insights:

          Array.isArray(
            geminiResult.insights
          )

            ? geminiResult.insights

            : [],


        improvementOpportunities:

          Array.isArray(
            geminiResult
              .improvement_opportunities
          )

            ? geminiResult
                .improvement_opportunities

            : [],


        lighthouse: {

          performance:
            lighthouseData.performance,

          accessibility:
            lighthouseData.accessibility,

          bestPractices:
            lighthouseData.bestPractices,

          seo:
            lighthouseData.seo,

          metrics:
            lighthouseData.metrics,

          available:
            lighthouseData.success,
        },


        pageInfo:
          browserResult.pageInfo,


        screenshots: {

          desktop:
            `data:image/jpeg;base64,${browserResult.desktopScreenshot}`,

          mobile:
            `data:image/jpeg;base64,${browserResult.mobileScreenshot}`,
        },
      };


      // ======================================================
      // COMPLETION LOG
      // ======================================================

      console.log('');

      console.log(
        '========================================'
      );

      console.log(
        'WEBGRADE ANALYSIS COMPLETED'
      );

      console.log(
        `Overall Score: ${overallScore}`
      );

      console.log(
        `AI-Like Score: ${responsePayload.aiLikeDesignScore}`
      );

      console.log(
        `Duration: ${responsePayload.durationMs}ms`
      );

      console.log(
        `Lighthouse Available: ${lighthouseData.success}`
      );

      console.log(
        '========================================'
      );

      console.log('');


      return res.json(
        responsePayload
      );


    } catch (err) {

      console.error(
        'UNEXPECTED SERVER ERROR:',
        err
      );


      return res.status(500).json({

        error:
          'An unexpected error occurred while analyzing the website. Please try again.',

        details:
          process.env.NODE_ENV ===
          'development'

            ? err.message

            : undefined,
      });
    }
  }
);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  '/api/health',
  (req, res) => {

    res.json({

      status:
        'ok',

      timestamp:
        new Date().toISOString(),

      geminiModel:
        GEMINI_MODEL,

      geminiFallbackModel:
        GEMINI_FALLBACK_MODEL,

      geminiKeyLoaded:
        !!process.env.GEMINI_API_KEY,

      environment:
        isVercel
          ? 'vercel'
          : 'local',
    });
  }
);


// ============================================================
// FRONTEND FALLBACK
// ============================================================

app.get(
  '*',
  (req, res) => {

    res.sendFile(

      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );
  }
);


// ============================================================
// LOCAL SERVER
// ============================================================

if (!isVercel) {

  app.listen(
    PORT,
    () => {

      console.log('');

      console.log(
        '========================================'
      );

      console.log(
        'WebGrade running'
      );

      console.log(
        `http://localhost:${PORT}`
      );

      console.log(
        `Primary Gemini model: ${GEMINI_MODEL}`
      );

      console.log(
        `Fallback Gemini model: ${GEMINI_FALLBACK_MODEL}`
      );

      console.log(
        `Gemini key loaded: ${!!process.env.GEMINI_API_KEY}`
      );

      console.log(
        '========================================'
      );

      console.log('');
    }
  );
}


// ============================================================
// VERCEL EXPORT
// ============================================================

module.exports = app;