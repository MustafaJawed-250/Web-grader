(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const landing = $('#landing');
  const loading = $('#loading');
  const results = $('#results');
  const errorOverlay = $('#error-overlay');
  const form = $('#analyze-form');
  const urlInput = $('#url-input');
  const formError = $('#form-error');
  const analyzeBtn = $('#analyze-btn');

  let currentData = null;
  let stageTimer = null;

  // --- Helpers ---
  function show(el) {
    el.hidden = false;
  }
  function hide(el) {
    el.hidden = true;
  }

  function isValidUrl(str) {
    try {
      const u = new URL(str.startsWith('http') ? str : 'https://' + str);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function scoreClass(score) {
    if (score == null) return '';
    if (score >= 90) return 'good';
    if (score >= 50) return 'ok';
    return 'poor';
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return '';
    }
  }

  // --- Stage progress ---
  const STAGES = [
    'check', 'open', 'desktop', 'mobile',
    'lighthouse', 'visual', 'ux', 'ai', 'report'
  ];

  function resetStages() {
    $$('#progress-stages li').forEach((li) => {
      li.classList.remove('active', 'done');
    });
  }

  function setStage(name) {
    const items = $$('#progress-stages li');
    let found = false;
    items.forEach((li) => {
      const s = li.dataset.stage;
      if (s === name) {
        li.classList.add('active');
        li.classList.remove('done');
        found = true;
      } else if (!found) {
        li.classList.add('done');
        li.classList.remove('active');
      } else {
        li.classList.remove('active', 'done');
      }
    });
  }

  function runStageSequence() {
    resetStages();
    let i = 0;
    const delays = [400, 1200, 2800, 4500, 7000, 10000, 13000, 16000, 19000];

    function next() {
      if (i >= STAGES.length) return;
      setStage(STAGES[i]);
      i += 1;
      if (i < STAGES.length) {
        stageTimer = setTimeout(next, delays[i] - delays[i - 1] || 1500);
      }
    }
    next();
  }

  function stopStages() {
    if (stageTimer) clearTimeout(stageTimer);
    // Mark all done
    $$('#progress-stages li').forEach((li) => {
      li.classList.add('done');
      li.classList.remove('active');
    });
  }

  // --- Render results ---
  function renderResults(data) {
    currentData = data;

    // Meta
    const urlEl = $('#result-url');
    urlEl.textContent = data.url;
    urlEl.href = data.url;
    $('#result-time').textContent = formatTime(data.analyzedAt);

    // Scores
    $('#overall-score').textContent = data.overallScore ?? '—';
    $('#ai-like-score').textContent = data.aiLikeDesignScore ?? '—';

    const aiNote = data.aiLikeDesignScore >= 70
      ? 'Shows a strong presence of common AI-builder visual patterns.'
      : data.aiLikeDesignScore >= 45
      ? 'Shows a moderate presence of common AI-builder visual patterns.'
      : 'Shows relatively few common AI-builder visual patterns.';
    $('#ai-like-note').textContent = aiNote;

    $('#summary-text').textContent = data.summary || '';

    // Screenshots
    const img = $('#screenshot-img');
    img.src = data.screenshots?.desktop || '';
    img.alt = 'Desktop screenshot of ' + data.url;

    // Tabs
    $$('.tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.view === 'desktop');
      t.setAttribute('aria-selected', t.dataset.view === 'desktop');
    });

    // Categories
    const catList = $('#category-list');
    catList.innerHTML = '';
    const order = [
      'Visual Design', 'Layout', 'Typography', 'Color System', 'Spacing',
      'Visual Hierarchy', 'UX / Usability', 'Responsiveness', 'Accessibility',
      'Content Presentation', 'Consistency', 'Performance'
    ];
    order.forEach((name) => {
      const cat = data.categoryScores?.[name];
      if (!cat) return;
      const score = cat.score ?? 0;
      const row = document.createElement('div');
      row.className = 'category-row';
      row.innerHTML = `
        <span class="category-name">${name}</span>
        <div class="category-bar"><div class="category-fill" style="width:${score}%"></div></div>
        <span class="category-score">${score}</span>
      `;
      catList.appendChild(row);
    });

    // Strengths
    const strList = $('#strengths-list');
    strList.innerHTML = '';
    (data.strengths || []).forEach((s) => {
      const el = document.createElement('div');
      el.className = 'strength-item';
      el.innerHTML = `<h4>${escapeHtml(s.title || 'Strength')}</h4><p>${escapeHtml(s.description || '')}</p>`;
      strList.appendChild(el);
    });
    if (!(data.strengths || []).length) {
      strList.innerHTML = '<p class="section-note">No specific strengths extracted.</p>';
    }

    // Improvements
    const impList = $('#improvements-list');
    impList.innerHTML = '';
    (data.improvements || []).forEach((imp) => {
      const el = document.createElement('div');
      el.className = 'improvement-item';
      const pri = (imp.priority || 'medium').toLowerCase();
      el.innerHTML = `
        <div class="improvement-header">
          <span class="improvement-cat">${escapeHtml(imp.category || '')}</span>
          <span class="improvement-score">${imp.score != null ? imp.score + '/100' : ''}</span>
          <span class="priority-badge ${pri}">${escapeHtml(imp.priority || 'Medium')}</span>
        </div>
        <p class="problem"><strong>Problem:</strong> ${escapeHtml(imp.problem || '')}</p>
        <p class="why">${escapeHtml(imp.why_it_matters || '')}</p>
        <p class="rec"><strong>Recommendation:</strong> ${escapeHtml(imp.recommendation || '')}</p>
      `;
      impList.appendChild(el);
    });
    if (!(data.improvements || []).length) {
      impList.innerHTML = '<p class="section-note">No major improvements flagged.</p>';
    }

    // Insights
    const insList = $('#insights-list');
    insList.innerHTML = '';
    (data.insights || []).forEach((ins) => {
      const el = document.createElement('div');
      el.className = 'insight-card';
      const sev = (ins.severity || 'medium').toLowerCase();
      el.innerHTML = `
        <div class="insight-meta">
          <span class="insight-cat">${escapeHtml(ins.category || '')}</span>
          <span class="severity-badge ${sev}">${escapeHtml(ins.severity || 'Medium')}</span>
        </div>
        <p class="insight-obs">${escapeHtml(ins.observation || '')}</p>
        <p class="insight-rec"><strong>Recommendation:</strong> ${escapeHtml(ins.recommendation || '')}</p>
      `;
      insList.appendChild(el);
    });
    if (!(data.insights || []).length) {
      insList.innerHTML = '<p class="section-note">No additional insights.</p>';
    }

    // Opportunities
    const oppList = $('#opportunities-list');
    oppList.innerHTML = '';
    (data.improvementOpportunities || []).forEach((opp) => {
      const el = document.createElement('div');
      el.className = 'opp-card';
      el.innerHTML = `
        <div class="opp-area">${escapeHtml(opp.area || '')}</div>
        <div class="opp-points">+${opp.potential_points ?? '?'} points</div>
        <div class="opp-note">${escapeHtml(opp.note || '')}</div>
      `;
      oppList.appendChild(el);
    });
    if (!(data.improvementOpportunities || []).length) {
      oppList.innerHTML = '<p class="section-note">No estimated opportunities calculated.</p>';
    }

    // AI-Like
    $('#ai-like-detail-score').textContent = data.aiLikeDesignScore ?? '—';
    $('#ai-like-reasoning').textContent = data.aiLikeDesignReasoning || '';

    // Lighthouse
    const lhSec = $('#lighthouse-section');
    if (data.lighthouse?.available) {
      const lh = data.lighthouse;
      const metrics = lh.metrics || {};
      lhSec.innerHTML = `
        <div class="lh-grid">
          <div class="lh-metric">
            <div class="lh-score ${scoreClass(lh.performance)}">${lh.performance ?? '—'}</div>
            <div class="lh-label">Performance</div>
          </div>
          <div class="lh-metric">
            <div class="lh-score ${scoreClass(lh.accessibility)}">${lh.accessibility ?? '—'}</div>
            <div class="lh-label">Accessibility</div>
          </div>
          <div class="lh-metric">
            <div class="lh-score ${scoreClass(lh.bestPractices)}">${lh.bestPractices ?? '—'}</div>
            <div class="lh-label">Best Practices</div>
          </div>
          <div class="lh-metric">
            <div class="lh-score ${scoreClass(lh.seo)}">${lh.seo ?? '—'}</div>
            <div class="lh-label">SEO</div>
          </div>
        </div>
        <h3 style="font-size:0.9rem;margin-bottom:0.75rem;font-weight:600;">Core Web Vitals</h3>
        <div class="cwv-list">
          <div class="cwv-item"><strong>FCP</strong>${escapeHtml(metrics.fcp || 'N/A')}</div>
          <div class="cwv-item"><strong>LCP</strong>${escapeHtml(metrics.lcp || 'N/A')}</div>
          <div class="cwv-item"><strong>TBT</strong>${escapeHtml(metrics.tbt || 'N/A')}</div>
          <div class="cwv-item"><strong>CLS</strong>${escapeHtml(metrics.cls || 'N/A')}</div>
          <div class="cwv-item"><strong>Speed Index</strong>${escapeHtml(metrics.si || 'N/A')}</div>
        </div>
      `;
    } else {
      lhSec.innerHTML = '<p class="section-note">Lighthouse data not available for this analysis.</p>';
    }

    // Detailed analysis
    const detail = $('#detailed-analysis');
    detail.innerHTML = '';
    const cats = data.categoryScores || {};
    Object.entries(cats).forEach(([name, cat]) => {
      if (name === 'Performance') return; // already in Lighthouse
      const el = document.createElement('div');
      el.className = 'detail-cat';
      let html = `<h3>${escapeHtml(name)} <span class="score-pill">${cat.score ?? '—'}/100</span></h3>`;
      if (cat.strengths?.length) {
        html += '<p><strong>Strengths</strong></p><ul class="detail-list">';
        cat.strengths.forEach((s) => { html += `<li>${escapeHtml(s)}</li>`; });
        html += '</ul>';
      }
      if (cat.issues?.length) {
        html += '<p><strong>Issues</strong></p><ul class="detail-list">';
        cat.issues.forEach((s) => { html += `<li>${escapeHtml(s)}</li>`; });
        html += '</ul>';
      }
      if (cat.recommendations?.length) {
        html += '<p><strong>Recommendations</strong></p><ul class="detail-list">';
        cat.recommendations.forEach((s) => { html += `<li>${escapeHtml(s)}</li>`; });
        html += '</ul>';
      }
      el.innerHTML = html;
      detail.appendChild(el);
    });
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Events ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.hidden = true;
    const raw = urlInput.value.trim();
    if (!raw) {
      formError.textContent = 'Please enter a website URL.';
      formError.hidden = false;
      return;
    }
    if (!isValidUrl(raw)) {
      formError.textContent = 'Please enter a valid HTTP or HTTPS URL.';
      formError.hidden = false;
      return;
    }

    let target = raw;
    if (!target.startsWith('http')) target = 'https://' + target;

    // UI transition
    hide(landing);
    hide(results);
    hide(errorOverlay);
    show(loading);
    $('#loading-url').textContent = target;
    analyzeBtn.disabled = true;
    runStageSequence();

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      stopStages();
      hide(loading);
      show(results);
      renderResults(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      stopStages();
      hide(loading);
      $('#error-message').textContent = err.message || 'Something went wrong. Please try again.';
      show(errorOverlay);
    } finally {
      analyzeBtn.disabled = false;
    }
  });

  // Screenshot tabs
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || !currentData) return;
    const view = tab.dataset.view;
    $$('.tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    const img = $('#screenshot-img');
    if (view === 'mobile') {
      img.src = currentData.screenshots?.mobile || '';
      img.alt = 'Mobile screenshot';
    } else {
      img.src = currentData.screenshots?.desktop || '';
      img.alt = 'Desktop screenshot';
    }
  });

  // New analysis / back
  $('#new-analysis').addEventListener('click', () => {
    hide(results);
    show(landing);
    urlInput.value = '';
    urlInput.focus();
  });

  $('#back-home').addEventListener('click', () => {
    hide(results);
    show(landing);
  });

  $('#error-retry').addEventListener('click', () => {
    hide(errorOverlay);
    show(landing);
    urlInput.focus();
  });
})();