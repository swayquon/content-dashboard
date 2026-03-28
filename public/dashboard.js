// ── Chart.js defaults ────────────────────────────────────────────────────────
Chart.defaults.color = '#6b7280';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null || (typeof n === 'number' && isNaN(n))) return '—';
  const num = Number(n);
  if (isNaN(num)) return '—';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Gradient helper ───────────────────────────────────────────────────────────
function makeGradient(ctx, color, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color + '30');
  gradient.addColorStop(1, color + '00');
  return gradient;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
const sparklineInstances = {};

function drawSparkline(canvasId, points, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Destroy existing instance
  if (sparklineInstances[canvasId]) {
    sparklineInstances[canvasId].destroy();
  }

  const ctx = canvas.getContext('2d');
  const gradient = makeGradient(ctx, color, 48);

  sparklineInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: points.map((_, i) => i),
      datasets: [{
        data: points,
        borderColor: color,
        borderWidth: 1.5,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 0,
      }],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      elements: {
        line: { borderCapStyle: 'round' },
      },
    },
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = { platform: 'all', days: 30, sort: 'views' };

// ── KPI config ────────────────────────────────────────────────────────────────
const KPI_CONFIG = [
  { key: 'views',           color: '#6366f1', sparklineField: 'views' },
  { key: 'reach',           color: '#0ea5e9', sparklineField: 'reach' },
  { key: 'engagement_rate', color: '#f59e0b', sparklineField: 'engagement_rate', suffix: '%' },
  { key: 'followers',       color: '#10b981', sparklineField: null },
  { key: 'shares',          color: '#ec4899', sparklineField: 'shares' },
  { key: 'saves',           color: '#8b5cf6', sparklineField: 'saves' },
];

// ── Load KPIs ─────────────────────────────────────────────────────────────────
async function loadKPIs() {
  try {
    const res = await fetch(`/api/kpis?days=${state.days}&platform=${state.platform}`);
    const { current, changes, sparklines } = await res.json();

    for (const cfg of KPI_CONFIG) {
      const { key, color, sparklineField, suffix } = cfg;

      // Value
      const valEl = document.getElementById(`val-${key}`);
      if (valEl) {
        let displayVal;
        if (key === 'engagement_rate') {
          const v = current[key];
          displayVal = (v == null || isNaN(v)) ? '—' : parseFloat(v).toFixed(2) + '%';
        } else if (key === 'followers') {
          const v = state.platform === 'instagram' ? current.followers_instagram
                  : state.platform === 'youtube'   ? current.followers_youtube
                  : current.followers;
          displayVal = fmt(v);
        } else {
          displayVal = fmt(current[key]);
        }
        valEl.textContent = displayVal;
      }

      // Delta
      const deltaEl = document.getElementById(`delta-${key}`);
      if (deltaEl) {
        const pct = changes[key];
        if (pct == null) {
          deltaEl.textContent = '';
          deltaEl.className = 'kpi-delta';
        } else {
          const abs = Math.abs(pct).toFixed(1);
          if (pct >= 0) {
            deltaEl.textContent = `↑ ${abs}%`;
            deltaEl.className = 'kpi-delta up';
          } else {
            deltaEl.textContent = `↓ ${abs}%`;
            deltaEl.className = 'kpi-delta down';
          }
        }
      }

      // Sparkline
      if (sparklineField && sparklines.length > 0) {
        const points = sparklines.map(d => d[sparklineField] ?? 0);
        drawSparkline(`spark-${key}`, points, color);
      }
    }

    // Last updated
    const lastUpdatedEl = document.getElementById('last-updated-time');
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = fmtDateTime(new Date().toISOString());
    }
  } catch (err) {
    console.error('loadKPIs error:', err);
  }
}

// ── Views & Reach Chart ───────────────────────────────────────────────────────
let viewsReachChart = null;

async function loadViewsReachChart() {
  try {
    const res = await fetch(`/api/chart/views-reach?days=${state.days}&platform=${state.platform}`);
    const data = await res.json();

    const canvas = document.getElementById('chart-views-reach');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (viewsReachChart) viewsReachChart.destroy();

    const height = 260;
    const gradViews = makeGradient(ctx, '#6366f1', height);
    const gradReach = makeGradient(ctx, '#0ea5e9', height);

    viewsReachChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => fmtDate(d.date)),
        datasets: [
          {
            label: 'Views',
            data: data.map(d => d.views),
            borderColor: '#6366f1',
            backgroundColor: gradViews,
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: 'Reach',
            data: data.map(d => d.reach),
            borderColor: '#0ea5e9',
            backgroundColor: gradReach,
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1a1a',
            borderColor: '#282828',
            borderWidth: 1,
            titleColor: '#f1f5f9',
            bodyColor: '#9ca3af',
            padding: 12,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: '#1f1f1f' },
            border: { display: false },
            ticks: { maxTicksLimit: 8, maxRotation: 0 },
          },
          y: {
            grid: { color: '#1f1f1f' },
            border: { display: false },
            ticks: {
              maxTicksLimit: 5,
              callback: v => fmt(v),
            },
          },
        },
      },
    });
  } catch (err) {
    console.error('loadViewsReachChart error:', err);
  }
}

// ── Engagement Chart ──────────────────────────────────────────────────────────
let engagementChart = null;

async function loadEngagementChart() {
  try {
    const res = await fetch(`/api/chart/engagement?days=${state.days}&platform=${state.platform}`);
    const data = await res.json();

    const canvas = document.getElementById('chart-engagement');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (engagementChart) engagementChart.destroy();

    const toRgba = (hex, alpha) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    };

    engagementChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => fmtDate(d.date)),
        datasets: [
          {
            label: 'Likes',
            data: data.map(d => d.likes),
            backgroundColor: toRgba('#ec4899', 0.8),
            borderRadius: 3,
            borderSkipped: false,
          },
          {
            label: 'Comments',
            data: data.map(d => d.comments),
            backgroundColor: toRgba('#f59e0b', 0.8),
            borderRadius: 3,
            borderSkipped: false,
          },
          {
            label: 'Shares',
            data: data.map(d => d.shares),
            backgroundColor: toRgba('#10b981', 0.8),
            borderRadius: 3,
            borderSkipped: false,
          },
          {
            label: 'Saves',
            data: data.map(d => d.saves),
            backgroundColor: toRgba('#8b5cf6', 0.8),
            borderRadius: 3,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 5,
              useBorderRadius: true,
              padding: 16,
              color: '#6b7280',
              font: { size: 12 },
            },
          },
          tooltip: {
            backgroundColor: '#1a1a1a',
            borderColor: '#282828',
            borderWidth: 1,
            titleColor: '#f1f5f9',
            bodyColor: '#9ca3af',
            padding: 12,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { maxTicksLimit: 8, maxRotation: 0 },
          },
          y: {
            grid: { color: '#1f1f1f' },
            border: { display: false },
            ticks: {
              maxTicksLimit: 5,
              callback: v => fmt(v),
            },
          },
        },
      },
    });
  } catch (err) {
    console.error('loadEngagementChart error:', err);
  }
}

// ── Posts ─────────────────────────────────────────────────────────────────────
function renderPostCard(post) {
  const thumbHtml = post.thumbnail_url
    ? `<img
         class="post-thumb"
         src="${escapeHtml(post.thumbnail_url)}"
         alt=""
         loading="lazy"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
       /><div class="post-thumb-placeholder" style="display:none;">&#9654;</div>`
    : `<div class="post-thumb-placeholder">&#9654;</div>`;

  const platform = (post.platform || '').toLowerCase();
  const platformLabel = platform === 'instagram' ? 'Instagram' : platform === 'youtube' ? 'YouTube' : escapeHtml(post.platform);

  const engRate = post.engagement_rate != null
    ? (parseFloat(post.engagement_rate) * 100).toFixed(2) + '%'
    : '—';

  const title = post.title
    ? escapeHtml(post.title)
    : '<span style="color:var(--muted);font-style:italic;">No caption</span>';

  return `
    <div class="post-card">
      <div style="position:relative;">
        ${thumbHtml}
      </div>
      <div class="post-body">
        <div class="post-meta">
          <span class="platform-badge ${escapeHtml(platform)}">${platformLabel}</span>
          <span class="post-date">${fmtDate(post.published_at)}</span>
        </div>
        <p class="post-title">${title}</p>
        <div class="post-stats">
          <div class="post-stat">
            <span class="post-stat-value">${fmt(post.views)}</span>
            <span class="post-stat-label">Views</span>
          </div>
          <div class="post-stat">
            <span class="post-stat-value">${fmt(post.likes)}</span>
            <span class="post-stat-label">Likes</span>
          </div>
          <div class="post-stat">
            <span class="post-stat-value">${fmt(post.shares)}</span>
            <span class="post-stat-label">Shares</span>
          </div>
          <div class="post-stat">
            <span class="post-stat-value">${fmt(post.saves)}</span>
            <span class="post-stat-label">Saves</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadPosts(sort = 'views') {
  const grid = document.getElementById('posts-grid');
  if (!grid) return;

  try {
    const res = await fetch(`/api/posts?sort=${encodeURIComponent(state.sort)}&limit=12&platform=${state.platform}`);
    const posts = await res.json();

    if (!posts.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;color:var(--muted);padding:40px 0;text-align:center;">No posts found.</div>`;
      return;
    }

    grid.innerHTML = posts.map(renderPostCard).join('');
  } catch (err) {
    console.error('loadPosts error:', err);
    grid.innerHTML = `<div style="grid-column:1/-1;color:var(--muted);padding:40px 0;text-align:center;">Failed to load posts.</div>`;
  }
}

// ── Refresh all ───────────────────────────────────────────────────────────────
function refreshAll() {
  Promise.all([
    loadKPIs(),
    loadViewsReachChart(),
    loadEngagementChart(),
    loadPosts(),
  ]);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Platform filter
  document.getElementById('platform-btns').addEventListener('click', e => {
    const btn = e.target.closest('.btn-filter');
    if (!btn) return;
    state.platform = btn.dataset.value;
    document.querySelectorAll('#platform-btns .btn-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    refreshAll();
  });

  // Time range
  document.getElementById('range-btns').addEventListener('click', e => {
    const btn = e.target.closest('.btn-filter');
    if (!btn) return;
    state.days = parseInt(btn.dataset.value);
    document.querySelectorAll('#range-btns .btn-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const labels = { 7: 'Last 7 days', 14: 'Last 14 days', 30: 'Last 30 days', 90: 'Last 90 days' };
    document.getElementById('period-label').textContent = labels[state.days] || `Last ${state.days} days`;
    refreshAll();
  });

  // Sort select
  document.getElementById('posts-sort').addEventListener('change', e => {
    state.sort = e.target.value;
    loadPosts();
  });

  // Initial load
  refreshAll();
});
