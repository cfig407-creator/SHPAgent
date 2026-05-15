import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Building2, Mail, CheckCircle2, Loader2, Sparkles, Target,
  ExternalLink, Filter, ArrowRight, Send, Edit3, Zap, TrendingUp,
  MapPin, Users, AlertCircle, Briefcase, Hash, Settings, Key,
  RefreshCw, X, Plus, Compass, BookOpen, MessageCircle, Copy,
  ChevronRight, ChevronDown, Download, UserPlus, Calendar,
} from 'lucide-react';
import {
  SHP_IDENTITY, DEFAULT_SIGNATURE, DEFAULT_SOFT_OPT_OUT, DEFAULT_MAX_TOUCHES,
  TERRITORY, APOLLO_LOCATION_STRINGS, ZIP_TO_COUNTY,
  classifyCounty, isInTerritory,
  classifyICP, classifyTitle, PAIN_LIBRARY, RESOURCE_CTAS, CUSTOMERS, pickProofPoints,
  customerCheck, detectEnrichmentNeeds,
  PAIN_FUNNEL_TEMPLATES, UFC_TEMPLATES, REVERSING_RESPONSES,
  buildColdEmailPrompt, buildDealTitle, buildLeadTitle, buildClusters, FOLLOW_UP_DAYS,
  composeEmail,
  getMultiThreadTitles, classifyTier, scoreUnenrichedCandidate,
} from './strategy.js';
import seedData from './seed-prospects.js';
import { apiFetch, postJson } from './api-client.js';

// Anthropic model — promoted to a constant so we change it in one place.
// Use a stable alias rather than a dated snapshot so we don't break when
// Anthropic retires old snapshots.
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

// === APOLLO CYCLE HELPERS ===
// Tracks credit usage by calendar month so we can surface end-of-cycle nudges
// ("you have 22 credits and 6 days left — spend them on multi-thread candidates").
// Persisted to localStorage; auto-rotates on month change.
const APOLLO_CYCLE_KEY = 'shp_apollo_cycle_v1';

function getCurrentCycle() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysUntilMonthEnd() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of current month
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function loadApolloCycle() {
  try {
    const raw = localStorage.getItem(APOLLO_CYCLE_KEY);
    if (!raw) return { cycle: getCurrentCycle(), creditsUsedThisCycle: 0, lastUpdated: null };
    const parsed = JSON.parse(raw);
    // Auto-rotate if we crossed into a new month
    if (parsed.cycle !== getCurrentCycle()) {
      return { cycle: getCurrentCycle(), creditsUsedThisCycle: 0, lastUpdated: null, previousCycle: parsed };
    }
    return parsed;
  } catch (e) {
    console.warn('[shp] apollo cycle load failed:', e);
    return { cycle: getCurrentCycle(), creditsUsedThisCycle: 0, lastUpdated: null };
  }
}

function saveApolloCycle(cycle) {
  try { localStorage.setItem(APOLLO_CYCLE_KEY, JSON.stringify(cycle)); }
  catch (e) { console.warn('[shp] apollo cycle save failed:', e); }
}

export default function SHPProspectingAgent() {
  const [view, setView] = useState('dashboard');

  // Pipedrive
  const [pdConnected, setPdConnected] = useState(false);
  const [pdMeta, setPdMeta] = useState({ stages: [], pipelines: [], userId: null, defaultPipelineId: null });
  const [isConnecting, setIsConnecting] = useState(false);
  // Last connection-attempt error — only surfaced when a connect actually failed.
  // Prevents the "stale disconnected" banner from showing while a reconnect is in flight.
  const [pdConnectError, setPdConnectError] = useState(null);
  const [hasAttemptedConnect, setHasAttemptedConnect] = useState(false);

  // Apollo quota — { creditsUsed, creditsTotal, creditsRemaining, planName }
  const [apolloQuota, setApolloQuota] = useState(null);
  const [apolloQuotaError, setApolloQuotaError] = useState(null);

  // Apollo cycle — tracks enrich credit usage by month so we can show
  // end-of-cycle nudges when there's leftover budget. Auto-rotates on month change.
  const [apolloCycle, setApolloCycle] = useState(() => loadApolloCycle());

  // Multi-thread state — modal for "Find peers at this org"
  const [findPeersFor, setFindPeersFor] = useState(null); // prospect being multi-threaded
  const [findPeersResults, setFindPeersResults] = useState(null); // candidates returned by Apollo
  const [isFindingPeers, setIsFindingPeers] = useState(false);

  // Bulk cross-thread (run free Apollo people-searches against every existing
  // org in the pool to discover peers at scale). State shape:
  //   bulkCrossThreadResults = [{ org, segment, county, parents:[Prospect], candidates:[Candidate], error? }]
  const [bulkCrossThreadOpen, setBulkCrossThreadOpen] = useState(false);
  const [bulkCrossThreadRunning, setBulkCrossThreadRunning] = useState(false);
  const [bulkCrossThreadProgress, setBulkCrossThreadProgress] = useState({ done: 0, total: 0, currentOrg: '' });
  const [bulkCrossThreadResults, setBulkCrossThreadResults] = useState([]);
  const [bulkCrossThreadCancel, setBulkCrossThreadCancel] = useState(false);

  // Net-new account discovery (Apollo organization search → chained people search).
  // newAccountsResults shape: [{ org: {...}, candidates: [{...}], alreadyInPool: bool }]
  const [newAccountsOpen, setNewAccountsOpen] = useState(false);
  const [newAccountsRunning, setNewAccountsRunning] = useState(false);
  const [newAccountsProgress, setNewAccountsProgress] = useState({ phase: 'idle', done: 0, total: 0, currentOrg: '' });
  const [newAccountsResults, setNewAccountsResults] = useState([]);
  const [newAccountsCancel, setNewAccountsCancel] = useState(false);

  // Batch-enrich wizard state — "Spend remaining credits" end-of-month workflow
  const [batchEnrichOpen, setBatchEnrichOpen] = useState(false);
  const [batchEnrichRunning, setBatchEnrichRunning] = useState(false);
  const [batchEnrichProgress, setBatchEnrichProgress] = useState({ done: 0, total: 0 });

  // Settings (browser-saved)
  const [config, setConfig] = useState({
    smartBcc: '', // Optional — M365 sync handles auto-logging, but keep field for users who want it
    fromName: SHP_IDENTITY.rep,
    fromTitle: SHP_IDENTITY.title,
    fromDirectPhone: SHP_IDENTITY.directPhone,
    fromOfficePhone: SHP_IDENTITY.officePhone,
    fromEmail: SHP_IDENTITY.email,
    contactCardUrl: SHP_IDENTITY.contactCardUrl,
    signature: DEFAULT_SIGNATURE,
    // Stage-1 hygiene: physical address (CAN-SPAM) + soft opt-out (deliverability)
    // + touch cap (anti-harassment guard).
    companyAddress: SHP_IDENTITY.companyAddress,
    softOptOut: DEFAULT_SOFT_OPT_OUT,
    maxTouches: DEFAULT_MAX_TOUCHES,
    // Apollo plan's monthly credit cap. Free tier = 50; increase if upgraded.
    // Used as the local fallback when Apollo's API doesn't expose usage data
    // (auth/health returns nulls on the free tier — local tracking is the
    // ground truth in that case).
    apolloMonthlyCredits: 50,
    sendMode: 'pipedrive', // 'pipedrive' (direct send via M365) | 'gmail' (legacy fallback)
    followUpHour: 9, // 0-23, local hour of day for the Day-14 activity
  });

  // Prospect pool — seed data + manually added + Apollo-found
  const [prospects, setProspects] = useState(() => normalizeSeed(seedData));
  const [filterSegment, setFilterSegment] = useState('all');
  const [filterCounty, setFilterCounty] = useState('all');
  const [filterStatus, setFilterStatus] = useState('Ready');
  const [filterOutreach, setFilterOutreach] = useState('Active'); // Active/Customer/Dead/PursueLater/all
  const [search, setSearch] = useState('');

  // Per-prospect overrides — { [prospectId]: { outreachStatus, revisitDate, deletedAt } }
  // Persisted to localStorage so status changes survive reloads
  const [overrides, setOverrides] = useState({});

  // Pursue Later modal state
  const [pursueLaterFor, setPursueLaterFor] = useState(null); // prospect id
  const [pursueLaterDate, setPursueLaterDate] = useState('');

  // Delete confirmation modal
  const [deleteConfirm, setDeleteConfirm] = useState(null); // prospect object

  // Selected prospect / draft state
  const [selectedProspect, setSelectedProspect] = useState(null);
  const [researchData, setResearchData] = useState({});
  const [isResearching, setIsResearching] = useState(false);
  const [draftEmail, setDraftEmail] = useState({ subject: '', body: '' });
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftDiagnostic, setDraftDiagnostic] = useState(null);
  // Track recently-used variant IDs so the composer rotates rather than repeats
  const [recentVariants, setRecentVariants] = useState([]);

  // Batch draft queue — multi-select in Find → research + draft N prospects in one run
  const [selectedProspectIds, setSelectedProspectIds] = useState(new Set());
  const [batchDraftOpen, setBatchDraftOpen] = useState(false);
  const [batchDraftRunning, setBatchDraftRunning] = useState(false);
  const [batchDraftProgress, setBatchDraftProgress] = useState({ done: 0, total: 0, currentName: '' });
  const [batchDraftQueue, setBatchDraftQueue] = useState({}); // { [id]: { status, research?, draft?, fallback?, error? } }
  const [batchDraftCancel, setBatchDraftCancel] = useState(false);

  // Pipedrive records — pdRecords[prospectId] = {leadId, leadUrl, dealId, dealUrl, personId, orgId, sentAt, sentHistory[], touchCount}
  // leadId is set when we push (default). dealId is set later if/when the lead is converted in Pipedrive.
  const [pdRecords, setPdRecords] = useState({});
  const [stageDeals, setStageDeals] = useState({});
  const [isPushing, setIsPushing] = useState(false);
  const [isSendingPD, setIsSendingPD] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Apollo enrichment — track which prospect is currently being enriched + the proposed result.
  // proposedEnrichment[prospectId] = { person, email, phone, title, linkedinUrl, ... } awaiting user approval
  const [isEnriching, setIsEnriching] = useState(null); // prospect id of currently-enriching prospect
  const [proposedEnrichment, setProposedEnrichment] = useState({});

  // Apollo search
  const [apolloCriteria, setApolloCriteria] = useState({
    titles: 'Facilities Director, Director of Facilities, VP Facilities, Facilities Manager',
    segments: 'K-12 Education, Higher Education, Local Government',
  });
  const [isApolloSearching, setIsApolloSearching] = useState(false);

  // Manual add form
  const [manualForm, setManualForm] = useState({
    name: '', title: '', company: '', email: '', phone: '',
    city: '', county: '', segment: 'auto',
  });

  // Sandler Coach
  const [coachTab, setCoachTab] = useState('painFunnel');
  const [coachSelectedSegment, setCoachSelectedSegment] = useState('K-12 Education');

  const [toast, setToast] = useState(null);
  // Mobile "More" sheet open state — overflow tabs (Coach, Settings) on phones.
  const [moreOpen, setMoreOpen] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Force a re-render at midnight + on tab focus so Pursue Later "due today"
  // re-evaluates without requiring a manual refresh.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setNowTick(Date.now()); };
    document.addEventListener('visibilitychange', onVisible);
    // Re-tick every 30 minutes so a long-open tab still flips at midnight
    const interval = setInterval(() => setNowTick(Date.now()), 30 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, []);

  // === Settings persistence ===
  useEffect(() => {
    // 1. Hydrate from localStorage immediately (fast, offline-friendly)
    const saved = localStorage.getItem('shp_config_v3');
    if (saved) {
      try { setConfig(c => ({ ...c, ...JSON.parse(saved) })); }
      catch (e) { console.warn('[shp] failed to parse saved config:', e); }
    }
    const savedOverrides = localStorage.getItem('shp_prospect_overrides_v3');
    if (savedOverrides) {
      try { setOverrides(JSON.parse(savedOverrides)); }
      catch (e) { console.warn('[shp] failed to parse saved overrides:', e); }
    }
    // Hydrate Pipedrive records (lead/deal IDs + sent history + touch counts)
    // so touch caps and "already in PD" badges survive reloads.
    const savedPdRecords = localStorage.getItem('shp_pd_records_v1');
    if (savedPdRecords) {
      try { setPdRecords(JSON.parse(savedPdRecords)); }
      catch (e) { console.warn('[shp] failed to parse saved pd records:', e); }
    }

    // 2. If a server-side config exists (Vercel KV), let it override the
    //    localStorage copy — the server is the source of truth across devices.
    (async () => {
      try {
        const r = await apiFetch('/api/config', { method: 'GET' }, { retries: 1, timeoutMs: 5000 });
        if (r?.config && typeof r.config === 'object') {
          setConfig(c => ({ ...c, ...r.config }));
        }
      } catch (e) {
        // Server config is optional — quietly continue with localStorage.
        console.info('[shp] no server-side config (using localStorage):', e.message);
      }
    })();

    autoConnect();
    fetchApolloQuota();
  }, []);

  // Persist overrides whenever they change
  useEffect(() => {
    if (Object.keys(overrides).length > 0) {
      localStorage.setItem('shp_prospect_overrides_v3', JSON.stringify(overrides));
    }
  }, [overrides]);

  // Persist Pipedrive records (touch counts + lead/deal links)
  useEffect(() => {
    if (Object.keys(pdRecords).length > 0) {
      localStorage.setItem('shp_pd_records_v1', JSON.stringify(pdRecords));
    }
  }, [pdRecords]);

  // Persist Apollo cycle on every update (including auto-rotate at month boundary)
  useEffect(() => { saveApolloCycle(apolloCycle); }, [apolloCycle]);

  // Re-check cycle every time the tab becomes visible — catches month rollovers on
  // long-open tabs without requiring a full reload.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const current = getCurrentCycle();
      setApolloCycle(prev => prev.cycle === current ? prev
        : { cycle: current, creditsUsedThisCycle: 0, lastUpdated: null, previousCycle: prev });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Bump the credit counter whenever Apollo's reported quota usage increases.
  // This lets the dashboard widget show real per-cycle usage even if the user
  // enriched prospects in a different browser session (Apollo is the source of truth).
  useEffect(() => {
    if (apolloQuota?.used == null) return;
    setApolloCycle(prev => {
      // Only update if Apollo's count exceeds what we last recorded
      const baseline = prev.apolloUsedAtCycleStart;
      if (baseline == null) {
        // First time we see Apollo data this cycle — anchor to current usage
        return { ...prev, apolloUsedAtCycleStart: apolloQuota.used, lastUpdated: new Date().toISOString() };
      }
      const usedThisCycle = Math.max(0, apolloQuota.used - baseline);
      if (usedThisCycle === prev.creditsUsedThisCycle) return prev;
      return { ...prev, creditsUsedThisCycle: usedThisCycle, lastUpdated: new Date().toISOString() };
    });
  }, [apolloQuota?.used]);

  const saveConfig = async () => {
    // Always save to localStorage first so the user never loses input
    localStorage.setItem('shp_config_v3', JSON.stringify(config));
    // Best-effort server persistence (survives browser clears / new devices)
    try {
      const r = await postJson('/api/config', { config }, { retries: 1, timeoutMs: 5000 });
      if (r?.persisted) {
        showToast('Settings saved (synced to server)');
      } else {
        showToast('Settings saved (browser only — server KV not configured)');
      }
    } catch (e) {
      console.warn('[shp] server config save failed:', e.message);
      showToast('Settings saved to browser (server save failed)', 'info');
    }
  };

  // Fetch Apollo credit usage so we can warn before the user runs out.
  const fetchApolloQuota = async () => {
    try {
      const r = await apiFetch('/api/apollo-quota', { method: 'GET' }, { retries: 1, timeoutMs: 5000 });
      setApolloQuota({
        used: r.creditsUsed,
        total: r.creditsTotal,
        remaining: r.creditsRemaining,
        plan: r.planName,
      });
      setApolloQuotaError(null);
    } catch (e) {
      console.info('[shp] Apollo quota unavailable:', e.message);
      setApolloQuotaError(e.message);
    }
  };

  // === Prospect status management ===
  const setOutreachStatus = (prospectId, outreachStatus, extra = {}) => {
    setOverrides(prev => {
      const next = { ...prev, [prospectId]: { ...(prev[prospectId] || {}), outreachStatus, ...extra } };
      localStorage.setItem('shp_prospect_overrides_v3', JSON.stringify(next));
      return next;
    });
  };

  const markCustomer = (prospectId) => {
    setOutreachStatus(prospectId, 'Customer');
    showToast('Marked as customer');
  };

  const markDead = (prospectId) => {
    setOutreachStatus(prospectId, 'Dead');
    showToast('Marked as dead lead');
  };

  const markActive = (prospectId) => {
    setOutreachStatus(prospectId, 'Active', { revisitDate: null });
    showToast('Restored to Active');
  };

  const openPursueLater = (prospect) => {
    const existing = overrides[prospect.id]?.revisitDate;
    if (existing) {
      setPursueLaterDate(existing);
    } else {
      // Default: 90 days out
      const d = new Date();
      d.setDate(d.getDate() + 90);
      setPursueLaterDate(d.toISOString().split('T')[0]);
    }
    setPursueLaterFor(prospect.id);
  };

  const savePursueLater = () => {
    if (!pursueLaterFor || !pursueLaterDate) {
      setPursueLaterFor(null);
      return;
    }
    setOutreachStatus(pursueLaterFor, 'PursueLater', { revisitDate: pursueLaterDate });
    showToast(`Pursue later — revisit ${pursueLaterDate}`);
    setPursueLaterFor(null);
    setPursueLaterDate('');
  };

  const confirmDelete = (prospect) => {
    setDeleteConfirm(prospect);
  };

  const executeDelete = () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm.id;
    // Remove from prospects pool entirely
    setProspects(prev => prev.filter(p => p.id !== id));
    // Mark deletedAt in overrides so we know we explicitly deleted (audit/recovery if needed)
    setOverrides(prev => {
      const next = { ...prev, [id]: { ...(prev[id] || {}), deletedAt: new Date().toISOString() } };
      localStorage.setItem('shp_prospect_overrides_v3', JSON.stringify(next));
      return next;
    });
    showToast(`Deleted ${deleteConfirm.name || deleteConfirm.company} from pool`);
    setDeleteConfirm(null);
  };

  // === Pipedrive proxy ===
  const pdRequest = async (method, path, body) => {
    return postJson('/api/pipedrive', { method, path, body }, { retries: 2, timeoutMs: 30_000 });
  };

  const autoConnect = async () => {
    setIsConnecting(true);
    setHasAttemptedConnect(true);
    try {
      const me = await pdRequest('GET', '/users/me');
      const pipelines = await pdRequest('GET', '/pipelines');
      const stagesResp = await pdRequest('GET', '/stages');

      // Defensive null-checks — Pipedrive responses occasionally return data: null
      const pipelineList = Array.isArray(pipelines?.data) ? pipelines.data : [];
      const stageList = Array.isArray(stagesResp?.data) ? stagesResp.data : [];
      if (pipelineList.length === 0) {
        throw new Error('Pipedrive returned no pipelines');
      }
      const defaultPipeline = pipelineList.find(p => p.selected) || pipelineList[0];
      const pipelineStages = stageList
        .filter(s => s.pipeline_id === defaultPipeline.id)
        .sort((a, b) => a.order_nr - b.order_nr);

      setPdMeta({
        userId: me?.data?.id,
        userEmail: me?.data?.email,
        userName: me?.data?.name,
        pipelines: pipelineList,
        defaultPipelineId: defaultPipeline.id,
        defaultPipelineName: defaultPipeline.name,
        stages: pipelineStages,
      });
      setPdConnected(true);
      setPdConnectError(null); // <-- clear any prior error so the dashboard banner disappears

      const buckets = {};
      pipelineStages.forEach(s => { buckets[s.id] = []; });
      setStageDeals(buckets);

      await syncPipelineWith(defaultPipeline.id, pipelineStages);
    } catch (err) {
      console.error('Auto-connect failed:', err);
      setPdConnected(false);
      setPdConnectError(err?.message || String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const syncPipelineWith = async (pipelineId, stages) => {
    if (!pipelineId) return;
    setIsSyncing(true);
    try {
      const deals = await pdRequest('GET', `/deals?status=open&limit=100`);
      const buckets = {};
      stages.forEach(s => { buckets[s.id] = []; });
      (deals.data || [])
        .filter(d => d.pipeline_id === pipelineId)
        .forEach(d => { if (buckets[d.stage_id]) buckets[d.stage_id].push(d); });
      setStageDeals(buckets);
    } catch (err) {
      showToast(`Sync failed: ${err.message}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const syncPipeline = () => syncPipelineWith(pdMeta.defaultPipelineId, pdMeta.stages);

  // === Apollo search (criteria-based, direct Apollo people-search) ===
  // Calls /api/apollo-people-search with parsed user criteria. No Anthropic /
  // MCP dependency — direct Apollo REST. Free (search is always free; only
  // enrichment costs credits).
  //
  // User inputs (apolloCriteria):
  //   - titles: comma-separated job titles
  //   - segments: comma-separated segment labels (K-12, Higher Ed, Local Gov)
  //
  // We translate segments → org keyword filters Apollo understands, layer in
  // Florida location, and exclude healthcare. Results are filtered to the
  // 15 CFL North counties via classifyCounty.
  const runApolloSearch = async () => {
    setIsApolloSearching(true);

    // Parse user inputs.
    const titles = apolloCriteria.titles
      .split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const requestedSegments = apolloCriteria.segments
      .split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);

    if (titles.length === 0) {
      showToast('Add at least one job title to search for', 'error');
      setIsApolloSearching(false);
      return;
    }

    // Map segment labels → Apollo org keyword tags.
    const SEGMENT_KEYWORDS = {
      'k-12 education': ['school district', 'public schools', 'k-12', 'county schools', 'isd'],
      'higher education': ['college', 'university', 'community college', 'state college'],
      'local government': ['city of', 'county government', 'town of', 'public works', 'county board of commissioners'],
    };
    const orgKeywords = [];
    for (const s of requestedSegments) {
      const kw = SEGMENT_KEYWORDS[s];
      if (kw) orgKeywords.push(...kw);
    }

    try {
      const data = await postJson('/api/apollo-people-search', {
        titles,
        // Send each CFL North county as its own location filter so Apollo
        // narrows from "anyone in Florida" to "anyone in these 15 counties".
        locations: APOLLO_LOCATION_STRINGS,
        orgKeywords: orgKeywords.length > 0 ? orgKeywords : undefined,
        orgKeywordsExclude: ['hospital', 'health system', 'medical center', 'physician', 'clinic'],
        limit: 25,
      }, { retries: 1, timeoutMs: 30_000 });

      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

      // De-dupe against existing pool by normalized name+org pair.
      const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const existingKeys = new Set(
        prospects.map(p => `${norm(p.name)}|${norm(p.company)}`).filter(k => k !== '|')
      );

      const newProspects = candidates
        .filter(c => c.name && c.organizationName)
        .map((c, i) => {
          const county = classifyCounty(c.city);
          const icp = classifyICP(c.organizationName, c.title);
          const titleClass = classifyTitle(c.title);
          // Use the email Apollo returned (paid tier) or empty (free tier
          // returns status without the actual address — still requires
          // running through /api/apollo-enrich to reveal).
          const apolloEmail = c.email && c.email.trim() ? c.email.toLowerCase() : '';
          return {
            id: `apollo_${Date.now()}_${i}`,
            name: c.name,
            title: c.title || '',
            company: c.organizationName,
            email: apolloEmail,
            phone: '',
            city: c.city || '',
            county: county || '',
            state: c.state || 'FL',
            zip: '',
            segment: icp.segment,
            icpStatus: icp.status,
            titleAltitude: titleClass.altitude,
            status: icp.status === 'in' ? 'Ready' : (icp.status === 'unknown' ? 'Review Needed' : 'Out of ICP'),
            source: 'Apollo Search',
            // Bonus priority if Apollo already supplied a verified email
            priority: 80 + (icp.status === 'in' ? 10 : 0) + (apolloEmail ? 10 : 0),
            apolloId: c.apolloId,
            apolloEmailStatus: c.emailStatus || null,
            linkedinUrl: c.linkedinUrl,
            photoUrl: c.photoUrl,
            _key: `${norm(c.name)}|${norm(c.organizationName)}`,
          };
        });

      // Filter: in-territory only AND not already in pool.
      const inTerritory = newProspects.filter(p => p.county && !existingKeys.has(p._key));
      // Strip _key before persisting.
      inTerritory.forEach(p => { delete p._key; });

      const filteredOut = newProspects.length - inTerritory.length;
      setProspects(prev => [...inTerritory, ...prev]);

      if (inTerritory.length === 0) {
        showToast(
          candidates.length === 0
            ? `Apollo returned 0 matches — try broader titles or fewer segments`
            : `Apollo returned ${candidates.length} matches but none were in-territory or all were already in pool`,
          'info',
        );
      } else {
        showToast(
          `Added ${inTerritory.length} prospect${inTerritory.length === 1 ? '' : 's'} from Apollo${filteredOut > 0 ? ` (${filteredOut} skipped: out-of-territory or duplicates)` : ''}`,
        );
      }
    } catch (err) {
      console.error('[shp] Apollo search failed:', err);
      const isPlanLimit = err?.status === 403 || /apollo_plan_required|invalid access credentials/i.test(err?.message || '');
      if (isPlanLimit) {
        showToast(
          `Apollo search requires a paid plan — switch to "Import CSV" tab to upload an Apollo CSV export instead`,
          'info',
        );
      } else {
        showToast(`Apollo search failed: ${err.message || 'unknown error'}`, 'error');
      }
    } finally {
      setIsApolloSearching(false);
    }
  };

  // === CSV Import ===
  // Bulk-add prospects from a CSV (typically an Apollo web-UI export, or any
  // other lead list). Each row is run through classifyICP + classifyCounty.
  // De-duped against existing pool by normalized name+company pair.
  // Rows missing a name OR company are dropped upstream by csvRowToProspect.
  const importCsvRows = (candidates) => {
    if (!candidates || candidates.length === 0) {
      showToast('No valid rows to import', 'error');
      return { added: 0, skippedDup: 0, skippedOutOfTerritory: 0 };
    }
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const existingKeys = new Set(
      prospects.map(p => `${norm(p.name)}|${norm(p.company)}`).filter(k => k !== '|')
    );

    const stats = { added: 0, skippedDup: 0, skippedOutOfTerritory: 0 };
    const now = Date.now();
    const newOnes = [];
    candidates.forEach((c, i) => {
      const key = `${norm(c.name)}|${norm(c.company)}`;
      if (existingKeys.has(key)) { stats.skippedDup++; return; }

      // Zip-aware county lookup — falls back to zip when city is unrecognized.
      const county = classifyCounty(c.city, c.zip);
      const icp = classifyICP(c.company, c.title);
      const titleClass = classifyTitle(c.title);

      if (!county) {
        stats.skippedOutOfTerritory++;
        return;
      }
      existingKeys.add(key);
      newOnes.push({
        id: `csv_${now}_${i}`,
        name: c.name,
        title: c.title || '',
        company: c.company,
        email: c.email || '',
        phone: c.phone || '',
        city: c.city || '',
        county,
        state: c.state || 'FL',
        zip: c.zip || '',
        segment: icp.segment,
        icpStatus: icp.status,
        titleAltitude: titleClass.altitude,
        status: icp.status === 'in' ? 'Ready' : icp.status === 'unknown' ? 'Review Needed' : 'Out of ICP',
        source: 'CSV Import',
        priority: 90 + (icp.status === 'in' ? 5 : 0) + (c.email ? 5 : 0),
        linkedinUrl: c.linkedinUrl || '',
      });
      stats.added++;
    });

    setProspects(prev => [...newOnes, ...prev]);
    return stats;
  };

  // === Manual add ===
  const addManualProspect = () => {
    if (!manualForm.name || !manualForm.company) {
      showToast('Name and company required', 'error');
      return;
    }
    const county = manualForm.county || classifyCounty(manualForm.city) || '';
    const icp = manualForm.segment === 'auto'
      ? classifyICP(manualForm.company, manualForm.title)
      : { segment: manualForm.segment, status: 'in' };
    const titleClass = classifyTitle(manualForm.title);

    const newProspect = {
      id: `manual_${Date.now()}`,
      name: manualForm.name,
      title: manualForm.title,
      company: manualForm.company,
      email: manualForm.email,
      phone: manualForm.phone,
      city: manualForm.city,
      county,
      state: 'FL',
      zip: '',
      segment: icp.segment,
      icpStatus: icp.status,
      titleAltitude: titleClass.altitude,
      status: icp.status === 'in' ? 'Ready' : 'Review Needed',
      source: 'Manual',
      priority: 100,
    };
    setProspects(prev => [newProspect, ...prev]);
    setManualForm({ name: '', title: '', company: '', email: '', phone: '', city: '', county: '', segment: 'auto' });
    showToast(`Added ${newProspect.name} to your pool`);
  };

  // === Research ===
  const researchProspect = async (prospect) => {
    // Defensive guard — shouldn't be reachable from UI for Customer/Dead but protects bypassed entry points
    const status = overrides[prospect.id]?.outreachStatus;
    if (status === 'Customer') {
      showToast('This is marked as a customer — no cold outreach', 'info');
      return;
    }
    if (status === 'Dead') {
      showToast('This prospect is marked Dead — restore to Active first', 'info');
      return;
    }
    setSelectedProspect(prospect);
    setIsResearching(true);
    setView('research');

    // Diagnostic state — captured for visibility into what actually happened
    const diagnostic = {
      apiCallSucceeded: false,
      webSearchInvoked: false,
      webSearchCount: 0,
      webSearchQueries: [],
      sourceCount: 0,
      sources: [],
      errorMessage: null,
      rawResponseBlocks: [],
    };

    try {
      let data;
      try {
        data = await postJson('/api/anthropic', {
          model: ANTHROPIC_MODEL,
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `You are researching a sales prospect for Superior Hardware Products, a commercial door & hardware distributor in Central Florida. The prospect is:

Name: ${prospect.name || '(no contact name)'}
Title: ${prospect.title || '(unknown)'}
Organization: ${prospect.company}
Location: ${prospect.city}, ${prospect.county || 'Florida'}
ICP segment: ${prospect.segment}

YOUR TASK: Use web_search to find SPECIFIC, CONCRETE information about THIS organization. Don't return generic segment-level pain points. Search for:
1. Their facilities footprint — number of buildings, square footage, recent construction or renovation news
2. Recent news, board meeting items, or budget discussions about facilities/maintenance/security
3. Capital improvement plans, master plans, RFPs related to doors/hardware/access control
4. Anything specific that suggests a current or upcoming facility need

If you can't find specifics about the organization, search broader (the school district, the city's CIP, etc.). Try at least 2 different search queries before giving up.

Return ONLY a JSON object (no preamble, no markdown). Be honest about specificity:
{
  "companySnapshot": "1-2 sentences about the org. Reference specific facts when found.",
  "facilityProfile": "1-2 sentences on facility footprint. Use real numbers when found, otherwise say 'inferred from segment'.",
  "painSignals": ["3 specific pain points. Mark with [SPECIFIC] if grounded in research, [INFERRED] if from segment defaults."],
  "openingHook": "ONE assumptive question that applies BROADLY to the segment (K-12 / Higher Ed / Local Gov), not narrowly to this specific org. Research informs WHICH segment-universal pain to pick — never reveal what you researched. AVOID category-level disclosures that only apply to a subset of the segment: 'donor-driven', 'tax-funded', 'union-staffed', 'recently-renovated', '5-year CIP', 'aging buildings', 'new construction', etc. Stay segment-universal. Good patterns: K-12 → 'managing facilities across multiple campuses', 'coordinating door work between school years', 'balancing summer-window repairs with year-round operations'. Higher Ed → 'balancing residential, athletic, and academic facilities', 'coordinating hardware specs across the campus mix'. Local Gov → 'across departments with different access needs', 'mixing older infrastructure with newer builds'. The question must work for ANY org in this segment — if you couldn't send it to a peer at a different school district, it's too specific. NEVER quote numbers, building names, news items, dates, project codes, or fiscal years.",
  "fitScore": 85,
  "fitReasoning": "1 sentence on SHP fit",
  "specificityRating": "high | medium | low",
  "specificityNote": "1 sentence explaining what you found vs. couldn't find"
}`
          }],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        }, { retries: 1, timeoutMs: 90_000 });
        diagnostic.apiCallSucceeded = true;
      } catch (httpErr) {
        diagnostic.apiCallSucceeded = false;
        diagnostic.errorMessage = httpErr.message;
        throw httpErr;
      }

      const blocks = Array.isArray(data?.content) ? data.content : [];
      diagnostic.rawResponseBlocks = blocks.map(b => b?.type).filter(Boolean);

      // Detect web search activity in the response — Claude returns server_tool_use blocks for web searches
      const searchInvocations = blocks.filter(b =>
        b && (b.type === 'server_tool_use' || b.type === 'tool_use') &&
        (b.name === 'web_search' || (typeof b.name === 'string' && b.name.startsWith('web_search')))
      );
      diagnostic.webSearchInvoked = searchInvocations.length > 0;
      diagnostic.webSearchCount = searchInvocations.length;
      diagnostic.webSearchQueries = searchInvocations
        .map(b => b?.input?.query || b?.input?.queries?.[0] || '(unknown query)')
        .slice(0, 10);

      // Count citations / sources in the text content
      const textBlocks = blocks.filter(b => b?.type === 'text');
      const citationsAll = textBlocks.flatMap(b => Array.isArray(b.citations) ? b.citations : []);
      diagnostic.sourceCount = citationsAll.length;
      diagnostic.sources = citationsAll.slice(0, 10).map(c => ({
        url: c?.url || c?.source?.url || '',
        title: c?.title || (typeof c?.cited_text === 'string' ? c.cited_text.slice(0, 80) : ''),
      }));

      // Parse the JSON output from Claude
      const text = textBlocks.map(b => b.text).filter(Boolean).join('\n');
      const cleaned = text.replace(/```json|```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        diagnostic.errorMessage = 'Claude returned no parseable JSON';
        throw new Error(diagnostic.errorMessage);
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        diagnostic.errorMessage = `JSON parse failed: ${parseErr.message}`;
        throw new Error(diagnostic.errorMessage);
      }
      // Guarantee shape so downstream UI doesn't crash on a malformed response
      parsed.painSignals = Array.isArray(parsed.painSignals) ? parsed.painSignals : [];
      parsed.fitScore = Number.isFinite(parsed.fitScore) ? parsed.fitScore : 70;

      // Attach diagnostic data to research object so it's visible in the UI
      const enriched = { ...parsed, _diagnostic: diagnostic };
      setResearchData(prev => ({ ...prev, [prospect.id]: enriched }));

      // Surface result in toast — three distinct states
      if (diagnostic.webSearchInvoked && diagnostic.sourceCount > 0) {
        showToast(`Research complete · ${diagnostic.webSearchCount} searches, ${diagnostic.sourceCount} sources`);
      } else if (diagnostic.webSearchInvoked) {
        showToast(`Research complete · ${diagnostic.webSearchCount} searches but no clean citations`, 'info');
      } else {
        showToast(`Research complete · NO web search fired (Claude answered from training data)`, 'info');
      }
    } catch (err) {
      // Fallback: pain library only, with diagnostic still attached
      const segPains = PAIN_LIBRARY[prospect.segment]?.tactical || [];
      const fallback = {
        companySnapshot: `${prospect.company} operates in ${prospect.county || 'CFL North'} as a ${prospect.segment} organization.`,
        facilityProfile: `Likely manages multiple buildings with typical high-traffic doors, mechanical hardware, and access control needs.`,
        painSignals: segPains.slice(0, 3).map(p => `[INFERRED] ${p}`),
        openingHook: `When you're juggling everything across a ${prospect.segment.toLowerCase()} portfolio, what's your usual fallback for door and hardware when something fails?`,
        fitScore: 75,
        fitReasoning: `${prospect.segment} multi-building operator is a fit for SHP's ICP.`,
        specificityRating: 'low',
        specificityNote: `Fallback used. ${diagnostic.errorMessage || 'Live research unavailable.'}`,
        _diagnostic: { ...diagnostic, errorMessage: diagnostic.errorMessage || err.message },
      };
      setResearchData(prev => ({ ...prev, [prospect.id]: fallback }));
      showToast(`Research FALLBACK — ${diagnostic.errorMessage || err.message || 'unknown error'}`, 'error');
    } finally {
      setIsResearching(false);
    }
  };

  // === Cold email draft — AI-generated in Anthony's voice, with deterministic fallback ===
  // Sends the prospect, research (incl. openingHook), proof points, voice guide, and
  // real email examples to Claude. Returns { subject, body }.
  // Falls back to the deterministic composer if the API call fails for any reason.
  const draftOutreach = async () => {
    if (!selectedProspect) return;
    setIsDrafting(true);
    setView('compose');

    // Research is treated as background context only by buildColdEmailPrompt
    // (informs capability emphasis + proof point selection — never quoted in
    // the email). No more openingHook-as-opener strategy.
    const research = researchData[selectedProspect.id] || null;
    const proofs = pickProofPoints(selectedProspect, 3);

    // Build the signature-with-address that goes into BOTH paths (AI + fallback).
    // The user's signature already starts with their personal block; we ensure the
    // physical postal address line is appended at the end if it isn't already
    // there (CAN-SPAM compliance — the address must be in every commercial email).
    const sigWithAddress = ensureAddressInSignature(config.signature, config.companyAddress);

    // Helper: deterministic fallback (the previous behavior — kept as a safety net
    // so the user always gets *something* reviewable even when Claude is down).
    const fallbackCompose = (reason) => {
      const result = composeEmail({
        prospect: selectedProspect,
        signature: sigWithAddress,
        proofPoints: proofs,
        avoid: recentVariants,
        softOptOut: config.softOptOut,
      });
      setDraftEmail({ subject: result.subject, body: result.body });
      setDraftDiagnostic({ ...result.diagnostic, fallback: true, fallbackReason: reason });
      setRecentVariants(prev => {
        const next = [...prev, result.diagnostic.openerId, result.diagnostic.bodyId, result.diagnostic.ctaId];
        return next.slice(-6);
      });
      showToast(`Draft composed (fallback) · ${reason}`, 'info');
    };

    try {
      const prompt = buildColdEmailPrompt(
        selectedProspect,
        research,
        selectedProspect.segment,
        sigWithAddress,
        config.softOptOut,
      );

      const data = await postJson('/api/anthropic', {
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }, { retries: 1, timeoutMs: 60_000 });

      const blocks = Array.isArray(data?.content) ? data.content : [];
      const text = blocks
        .filter(b => b?.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n')
        .trim();

      if (!text) {
        return fallbackCompose('Anthropic returned no text');
      }

      // The prompt asks for {"subject":"...","body":"..."} — extract robustly.
      const cleaned = text.replace(/```json|```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return fallbackCompose('No JSON in Claude response');
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        return fallbackCompose(`JSON parse failed: ${e.message}`);
      }
      if (!parsed?.subject || !parsed?.body) {
        return fallbackCompose('Claude response missing subject/body');
      }

      setDraftEmail({ subject: parsed.subject, body: parsed.body });
      setDraftDiagnostic({
        composer: 'ai',
        model: ANTHROPIC_MODEL,
        usedResearch: !!research,
        proofPointsAvailable: proofs.map(p => p.name),
        fallback: false,
      });
      showToast('Draft composed in Anthony\'s voice');
    } catch (err) {
      console.error('[shp] AI draft failed:', err);
      fallbackCompose(err.message || 'API error');
    } finally {
      setIsDrafting(false);
    }
  };

  // === Push to Pipedrive as a Lead ===
  // Creates Person + Org + Lead (in Lead Inbox) + Day-14 follow-up activity attached to Lead.
  // Lead → Deal conversion is done manually in Pipedrive web app when the prospect qualifies
  // (defined as: site walk scheduled).
  const pushToPipedrive = async () => {
    if (!pdConnected) {
      showToast('Pipedrive not connected', 'error');
      setView('settings');
      return;
    }
    if (!selectedProspect) return;
    if (pdRecords[selectedProspect.id]?.leadId || pdRecords[selectedProspect.id]?.dealId) {
      showToast('Already in Pipedrive', 'info');
      return;
    }
    setIsPushing(true);
    try {
      // 1. Create or reuse the Organization
      const orgResp = await pdRequest('POST', '/organizations', {
        name: selectedProspect.company,
        owner_id: pdMeta.userId,
      });
      const orgId = orgResp.data.id;

      // 2. Create the Person (linked to org)
      const personBody = {
        name: selectedProspect.name,
        org_id: orgId,
        owner_id: pdMeta.userId,
      };
      if (selectedProspect.email) {
        personBody.email = [{ value: selectedProspect.email, primary: true, label: 'work' }];
      }
      if (selectedProspect.phone) {
        personBody.phone = [{ value: selectedProspect.phone, primary: true, label: 'work' }];
      }
      const personResp = await pdRequest('POST', '/persons', personBody);
      const personId = personResp.data.id;

      // 3. Create a Lead in the Lead Inbox (NOT a Deal)
      // Pipedrive Leads docs: requires title + (person_id or org_id). Returns lead with `id` (UUID).
      const leadResp = await pdRequest('POST', '/leads', {
        title: buildLeadTitle(selectedProspect, selectedProspect.segment),
        person_id: personId,
        organization_id: orgId,
        owner_id: pdMeta.userId,
      });
      const leadId = leadResp.data.id; // Pipedrive lead IDs are UUIDs (strings), not integers

      // 4. Attach Lead Profile note — honest facts, no synthetic scoring.
      // Includes proof points used in the cold draft so we have an audit trail.
      const proofs = pickProofPoints(selectedProspect, 3);
      const proofList = proofs.length > 0
        ? proofs.map(p => `<li>${p.name} (${p.county})</li>`).join('')
        : '<li><i>No matching customer references for this segment/area</i></li>';

      const profileNote = [
        `<b>Lead Profile — ${selectedProspect.segment}</b>`,
        ``,
        `<b>Organization:</b> ${selectedProspect.company}`,
        `<b>Location:</b> ${selectedProspect.city || '(unknown)'}, ${selectedProspect.county || '(unknown)'} County`,
        `<b>Contact:</b> ${selectedProspect.name || '(no name)'}`,
        `<b>Title:</b> ${selectedProspect.title || '(unknown)'}`,
        selectedProspect.email ? `<b>Email:</b> ${selectedProspect.email}` : '',
        selectedProspect.phone ? `<b>Phone:</b> ${selectedProspect.phone}` : '',
        ``,
        `<b>Source:</b> ${selectedProspect.source || 'manual'}`,
        selectedProspect.sourceNotes ? `<b>Source notes:</b> ${selectedProspect.sourceNotes}` : '',
        selectedProspect.enrollmentOrPop ? `<b>Enrollment / Population:</b> ${selectedProspect.enrollmentOrPop}` : '',
        ``,
        `<b>Customer references used in the cold draft:</b>`,
        `<ul>${proofList}</ul>`,
      ].filter(Boolean).join('<br>');

      await pdRequest('POST', '/notes', {
        content: profileNote,
        lead_id: leadId, person_id: personId, org_id: orgId,
      });

      // 5. Day-14 resource-framed follow-up activity, attached to Lead.
      // Convert local follow-up hour → UTC for Pipedrive (their due_time field is UTC).
      const followUp = new Date();
      followUp.setDate(followUp.getDate() + FOLLOW_UP_DAYS);
      const followUpHour = config.followUpHour ?? 9; // local hour
      // Build a Date at the local hour, then read the UTC hour off it
      followUp.setHours(followUpHour, 0, 0, 0);
      const utcHour = followUp.getUTCHours();
      const utcMinute = followUp.getUTCMinutes();
      const dueDate = followUp.toISOString().split('T')[0];
      const dueTime = `${String(utcHour).padStart(2, '0')}:${String(utcMinute).padStart(2, '0')}`;
      await pdRequest('POST', '/activities', {
        subject: `Day ${FOLLOW_UP_DAYS} resource follow-up — ${selectedProspect.name}`,
        type: 'email',
        due_date: dueDate,
        due_time: dueTime,
        lead_id: leadId, person_id: personId, org_id: orgId,
        user_id: pdMeta.userId,
        note: `Resource-framed follow-up. If no reply by today, share something useful (fire door inspection guide, ADA upgrade checklist, segment-specific resource). Don't pitch — stay in resource frame. CONVERT THIS LEAD TO A DEAL only if a site walk is scheduled.`,
      });

      // Pipedrive lead URL format: https://[domain].pipedrive.com/leads/inbox/[uuid]
      // We use a generic format that works regardless of subdomain
      const leadUrl = `https://app.pipedrive.com/leads/inbox/${leadId}`;

      setPdRecords(prev => ({
        ...prev,
        [selectedProspect.id]: { orgId, personId, leadId, leadUrl },
      }));
      showToast(`Created lead in Pipedrive — convert to deal when site walk scheduled`);
      // Don't sync the deal pipeline since we didn't create a deal
    } catch (err) {
      showToast(`Pipedrive push failed: ${err.message}`, 'error');
    } finally {
      setIsPushing(false);
    }
  };

  // === Apollo enrichment ===
  // Calls the Vercel proxy /api/apollo-enrich which calls Apollo's people-match endpoint.
  // Returns Apollo's verified work email + title + LinkedIn URL when found.
  // Result lands in proposedEnrichment[prospectId] for human review before applying.
  // Cost: 1 Apollo credit per match found, 0 if not found. Free tier = 50/month.
  const enrichProspect = async (prospect) => {
    if (!prospect) return;
    if (isEnriching) {
      showToast('Already enriching another prospect — wait for it to finish', 'info');
      return;
    }

    // Confirm with user before spending a credit
    const confirmed = window.confirm(
      `Enrich ${prospect.name} at ${prospect.company} via Apollo?\n\n` +
      `Cost: 1 credit if Apollo finds a match, 0 if not found.\n` +
      `Apollo will look up their verified work email, phone, and LinkedIn URL.`
    );
    if (!confirmed) return;

    setIsEnriching(prospect.id);
    try {
      const [firstName, ...rest] = (prospect.name || '').trim().split(/\s+/);
      const lastName = rest.join(' ');

      let data;
      try {
        data = await postJson('/api/apollo-enrich', {
          firstName,
          lastName,
          name: prospect.name,
          organizationName: prospect.company,
        }, { retries: 2, timeoutMs: 30_000 });
      } catch (e) {
        showToast(`Apollo error: ${e.message}`, 'error');
        return;
      }

      if (!data || data.error) {
        showToast(`Apollo error: ${data?.error || 'unknown'}`, 'error');
        return;
      }

      if (!data.matched) {
        showToast(`Apollo: no match for ${prospect.name} (0 credits used)`, 'info');
        setProposedEnrichment(prev => ({
          ...prev,
          [prospect.id]: { matched: false, message: data.message || 'No match found' },
        }));
        return;
      }

      if (!data.person) {
        showToast('Apollo response missing person data', 'error');
        return;
      }

      // Apollo found a match — store proposed enrichment for user to review
      setProposedEnrichment(prev => ({
        ...prev,
        [prospect.id]: { matched: true, person: data.person },
      }));
      showToast(`Apollo found ${data.person.name || prospect.name} — review and apply`);
      // Refresh quota in the background so the warning ticker stays accurate
      fetchApolloQuota();
    } catch (err) {
      console.error('[shp] enrichProspect failed:', err);
      showToast(`Enrichment failed: ${err.message}`, 'error');
    } finally {
      setIsEnriching(null);
    }
  };

  // === Multi-thread: find peers at the same org ===
  // Free Apollo search (no credit cost). Returns candidates for user review.
  // User then picks which to add to the pool (also free); enrichment happens
  // separately when they want a verified email (1 credit each).
  const multiThreadAccount = async (prospect) => {
    if (!prospect?.company) {
      showToast('No organization on this prospect', 'error');
      return;
    }
    setFindPeersFor(prospect);
    setFindPeersResults(null);
    setIsFindingPeers(true);

    const titles = getMultiThreadTitles(prospect.title, prospect.segment);

    try {
      const data = await postJson('/api/apollo-people-search', {
        organizationName: prospect.company,
        titles,
        limit: 15,
      }, { retries: 1, timeoutMs: 30_000 });

      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

      // Mark candidates that are already in the pool so the modal can disable them.
      const normalize = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const existingNames = new Set(
        prospects.map(p => normalize(p.name)).filter(Boolean)
      );
      const annotated = candidates.map(c => ({
        ...c,
        alreadyInPool: existingNames.has(normalize(c.name)),
      }));

      setFindPeersResults(annotated);

      const newCount = annotated.filter(c => !c.alreadyInPool).length;
      showToast(`Found ${annotated.length} peer${annotated.length === 1 ? '' : 's'} at ${prospect.company}${newCount < annotated.length ? ` (${annotated.length - newCount} already in pool)` : ''}`);
    } catch (err) {
      console.error('[shp] multiThreadAccount failed:', err);
      const isPlanLimit = err?.status === 403 || /apollo_plan_required|invalid access credentials/i.test(err?.message || '');
      if (isPlanLimit) {
        showToast(
          `"Find peers" needs Apollo paid plan. Try Find → Import CSV instead.`,
          'info',
        );
      } else {
        showToast(`Peer search failed: ${err.message}`, 'error');
      }
      setFindPeersResults([]);
    } finally {
      setIsFindingPeers(false);
    }
  };

  // Add selected peers to the pool. Each new prospect inherits geography from the
  // parent and is flagged needsEnrichment (no email yet — enrich them later).
  const addPeersToPool = (parent, picked) => {
    if (!picked || picked.length === 0) return;
    const now = Date.now();
    const newProspects = picked.map((c, i) => {
      const icp = classifyICP(parent.company, c.title);
      const titleClass = classifyTitle(c.title);
      return {
        id: `peer_${now}_${i}`,
        name: c.name,
        title: c.title || '',
        company: parent.company,
        email: '', // Apollo search doesn't return verified emails — must enrich
        phone: '',
        city: parent.city || c.city || '',
        county: parent.county || '',
        state: parent.state || c.state || 'FL',
        zip: '',
        segment: parent.segment || icp.segment,
        icpStatus: icp.status,
        titleAltitude: titleClass.altitude,
        status: 'Ready',
        source: `Apollo (peer of ${parent.name || parent.company})`,
        priority: 80,
        parentProspectId: parent.id,
        apolloId: c.apolloId,
        linkedinUrl: c.linkedinUrl,
        photoUrl: c.photoUrl,
      };
    });
    setProspects(prev => [...newProspects, ...prev]);
    showToast(`Added ${newProspects.length} peer${newProspects.length === 1 ? '' : 's'} to the pool — enrich them when you have credits`);
    setFindPeersFor(null);
    setFindPeersResults(null);
  };

  // === Bulk cross-thread the entire pool ===
  // Iterates the unique orgs in your prospect pool, runs a free Apollo
  // people-search on each, and aggregates the results. Apollo people-search
  // costs zero credits — only enrichment (verified email) costs 1 credit each.
  // Strategy:
  //   - Score every unique org by cross-thread opportunity:
  //       +5  has only 1 contact (highest leverage — net-new ladder coverage)
  //       +3  has no Tier 4 (decision-maker) contact yet
  //       +2  is in a high-trip-score county
  //       +1  has been pushed to Pipedrive (active deal)
  //   - Process the top N orgs (default 60) with a 220ms throttle so we
  //     stay polite to Apollo's rate limits.
  //   - Open a modal that streams progress and lets the user cancel.
  //   - On completion, the modal pivots to a review screen with all candidates
  //     across all orgs — bulk-select + bulk-add.
  const crossThreadPool = async ({ maxOrgs = 60 } = {}) => {
    if (bulkCrossThreadRunning) return;

    // Group existing pool by normalized company name so we run one search per org.
    const normalizeOrg = (s) => (s || '').toLowerCase().replace(/\b(inc|llc|corp|company|co|ltd|the)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
    const orgs = new Map(); // normalizedKey → { displayName, parents: [Prospect] }
    for (const p of prospectsWithOverrides) {
      if (!p.company) continue;
      if (p.outreachStatus === 'Dead' || p.outreachStatus === 'Customer') continue; // don't waste searches
      const key = normalizeOrg(p.company);
      if (!key) continue;
      if (!orgs.has(key)) orgs.set(key, { displayName: p.company, parents: [] });
      orgs.get(key).parents.push(p);
    }

    if (orgs.size === 0) {
      showToast('No orgs to cross-thread', 'info');
      return;
    }

    // Compute trip-score-weighted county set for scoring.
    const highTripCounties = new Set(clusters.slice(0, 5).map(c => c.county));

    // Score and rank each org.
    const scored = Array.from(orgs.entries()).map(([key, group]) => {
      const parents = group.parents;
      const tiers = new Set(parents.map(p => classifyTier(p.title)));
      let score = 0;
      if (parents.length === 1) score += 5;
      if (!tiers.has(4)) score += 3;
      if (parents.some(p => p.county && highTripCounties.has(p.county))) score += 2;
      if (parents.some(p => pdRecords[p.id]?.leadId || pdRecords[p.id]?.dealId)) score += 1;
      return { key, displayName: group.displayName, parents, score };
    }).sort((a, b) => b.score - a.score).slice(0, maxOrgs);

    // Reset state, open modal, kick off the run.
    setBulkCrossThreadOpen(true);
    setBulkCrossThreadRunning(true);
    setBulkCrossThreadCancel(false);
    setBulkCrossThreadProgress({ done: 0, total: scored.length, currentOrg: '' });
    setBulkCrossThreadResults([]);

    const results = [];
    let abortedDueToPlanLimit = false;
    for (let i = 0; i < scored.length; i++) {
      // Read latest cancel flag via a state-bypass closure trick — we can't
      // read state directly in a loop, so use a local mutable ref via the setter.
      // Cleanest: bail if the user closed the modal mid-run.
      let cancelled = false;
      setBulkCrossThreadCancel(c => { cancelled = c; return c; });
      if (cancelled) break;

      const item = scored[i];
      setBulkCrossThreadProgress({ done: i, total: scored.length, currentOrg: item.displayName });

      // Pick a representative parent (highest-tier existing contact) so the
      // title-ladder logic biases toward the OTHER tiers we don't yet cover.
      const representative = item.parents.slice().sort((a, b) =>
        classifyTier(b.title) - classifyTier(a.title)
      )[0];
      const titles = getMultiThreadTitles(representative.title, representative.segment);

      try {
        const data = await postJson('/api/apollo-people-search', {
          organizationName: item.displayName,
          titles,
          limit: 10,
        }, { retries: 1, timeoutMs: 20_000 });

        // First success — implicitly confirms plan tier is OK. Continue.

        const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

        // Annotate with already-in-pool flag and a per-candidate priority score.
        const normName = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const existingNames = new Set(prospects.map(p => normName(p.name)).filter(Boolean));

        const annotated = candidates
          .filter(c => c.name) // drop anything Apollo couldn't name
          .map(c => {
            const tier = classifyTier(c.title);
            return {
              ...c,
              tier,
              alreadyInPool: existingNames.has(normName(c.name)),
              // Per-candidate score: tier-3/4 > others; bonus if org is small.
              candScore: tier * 2 + (item.parents.length === 1 ? 2 : 0),
            };
          });

        results.push({
          orgKey: item.key,
          orgName: item.displayName,
          parents: item.parents,
          county: representative.county,
          segment: representative.segment,
          candidates: annotated,
        });
      } catch (err) {
        const isPlanLimit = err?.status === 403 || /apollo_plan_required|invalid access credentials/i.test(err?.message || '');
        if (isPlanLimit && results.length === 0) {
          // First request failed with the plan-tier error — short-circuit the
          // entire loop rather than wasting 60 throttled round-trips.
          abortedDueToPlanLimit = true;
          break;
        }
        results.push({
          orgKey: item.key,
          orgName: item.displayName,
          parents: item.parents,
          candidates: [],
          error: err.message || String(err),
        });
      }

      // Throttle: 220ms between requests. Apollo's free-tier rate limit is
      // permissive but it's polite to pace ourselves.
      if (i < scored.length - 1) await new Promise(r => setTimeout(r, 220));
    }

    setBulkCrossThreadResults(results);
    setBulkCrossThreadProgress({ done: scored.length, total: scored.length, currentOrg: '' });
    setBulkCrossThreadRunning(false);

    if (abortedDueToPlanLimit) {
      setBulkCrossThreadOpen(false);
      showToast(
        `Cross-threading needs Apollo paid plan. Use Find → Import CSV to bulk-add from Apollo's web UI export.`,
        'info',
      );
      return;
    }

    const totalCandidates = results.reduce((sum, r) => sum + (r.candidates?.length || 0), 0);
    const errored = results.filter(r => r.error).length;
    showToast(
      `Searched ${results.length} orgs · found ${totalCandidates} candidates${errored > 0 ? ` · ${errored} errored` : ''}`,
    );
  };

  // Bulk-add picked candidates from a cross-thread run. `picks` is an array of
  // { result, candidate } pairs so we can attach each new prospect to its
  // correct parent org.
  const addCrossThreadPicks = (picks) => {
    if (!picks || picks.length === 0) return;
    const now = Date.now();
    const newProspects = picks.map(({ result, candidate }, i) => {
      // Use the first parent as the geographic anchor; the org is the same.
      const parent = result.parents[0];
      const icp = classifyICP(result.orgName, candidate.title);
      const titleClass = classifyTitle(candidate.title);
      return {
        id: `peer_${now}_${i}`,
        name: candidate.name,
        title: candidate.title || '',
        company: result.orgName,
        email: '',
        phone: '',
        city: parent?.city || candidate.city || '',
        county: parent?.county || result.county || '',
        state: parent?.state || candidate.state || 'FL',
        zip: '',
        segment: parent?.segment || result.segment || icp.segment,
        icpStatus: icp.status,
        titleAltitude: titleClass.altitude,
        status: 'Ready',
        source: `Apollo (cross-thread of ${result.orgName})`,
        priority: 85,
        parentProspectId: parent?.id || null,
        apolloId: candidate.apolloId,
        linkedinUrl: candidate.linkedinUrl,
        photoUrl: candidate.photoUrl,
      };
    });
    setProspects(prev => [...newProspects, ...prev]);
    showToast(`Added ${newProspects.length} cross-thread peer${newProspects.length === 1 ? '' : 's'} — enrich them with leftover credits`);
    setBulkCrossThreadOpen(false);
    setBulkCrossThreadResults([]);
  };

  // === Net-new account discovery ===
  // Runs Apollo organization search across the three ICP segments
  // (K-12, Higher Ed, Local Gov) restricted to the CFL North territory,
  // then for each new org chains a free people-search to surface
  // facilities decision-makers. Apollo charges 0 credits for either —
  // credits are only spent later when the user enriches a candidate.
  //
  // Strategy:
  //   - Phase 1 (search): three parallel-ish org searches with location +
  //     keyword filters. Excludes healthcare via keywordsExclude.
  //   - Filter results: drop orgs already in the pool (normalized name match).
  //   - Cap: top 24 unique new orgs ordered by employee count (proxy for
  //     facility footprint = TAM = priority).
  //   - Phase 2 (people): for each org, run a people-search with the
  //     facilities title ladder. 220ms throttle.
  //   - Open the modal that streams progress; on complete, pivot to review.
  const findNewAccounts = async () => {
    if (newAccountsRunning) return;

    setNewAccountsOpen(true);
    setNewAccountsRunning(true);
    setNewAccountsCancel(false);
    setNewAccountsResults([]);
    setNewAccountsProgress({ phase: 'orgs', done: 0, total: 3, currentOrg: 'Searching organizations…' });

    // Send Apollo each CFL North county as a separate location filter so we
    // don't pull orgs from the whole state and filter client-side. Healthcare
    // is the only segment-wide exclusion.
    const locations = APOLLO_LOCATION_STRINGS;
    const excludeKeywords = ['hospital', 'health system', 'medical center', 'physician', 'clinic'];

    const segmentSearches = [
      {
        segment: 'K-12 Education',
        keywords: ['school district', 'public schools', 'k-12', 'county schools'],
      },
      {
        segment: 'Higher Education',
        keywords: ['college', 'university', 'community college', 'state college'],
      },
      {
        segment: 'Local Government',
        keywords: ['city of', 'county government', 'town of', 'public works', 'county board of commissioners'],
      },
    ];

    // Phase 1 — fire all three segment searches.
    const orgsBySegment = [];
    let abortedDueToPlanLimit = false;
    for (let i = 0; i < segmentSearches.length; i++) {
      let cancelled = false;
      setNewAccountsCancel(c => { cancelled = c; return c; });
      if (cancelled) break;

      const s = segmentSearches[i];
      setNewAccountsProgress({ phase: 'orgs', done: i, total: segmentSearches.length, currentOrg: s.segment });

      try {
        const data = await postJson('/api/apollo-org-search', {
          keywords: s.keywords,
          locations,
          keywordsExclude: excludeKeywords,
          limit: 25,
        }, { retries: 1, timeoutMs: 30_000 });
        orgsBySegment.push({ segment: s.segment, orgs: data.organizations || [] });
      } catch (err) {
        console.error('[shp] org-search failed for', s.segment, err);
        const isPlanLimit = err?.status === 403 || /apollo_plan_required|invalid access credentials/i.test(err?.message || '');
        if (isPlanLimit) {
          abortedDueToPlanLimit = true;
          break;
        }
        orgsBySegment.push({ segment: s.segment, orgs: [], error: err.message });
      }
      if (i < segmentSearches.length - 1) await new Promise(r => setTimeout(r, 220));
    }

    if (abortedDueToPlanLimit) {
      setNewAccountsRunning(false);
      setNewAccountsOpen(false);
      setNewAccountsResults([]);
      showToast(
        `Finding new accounts needs Apollo paid plan. Use Find → Import CSV instead.`,
        'info',
      );
      return;
    }

    // Dedup against existing pool + collapse cross-segment duplicates.
    const normalize = (s) => (s || '').toLowerCase().replace(/\b(inc|llc|corp|company|co|ltd|the)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
    const existingOrgKeys = new Set(prospects.map(p => normalize(p.company)).filter(Boolean));
    const seen = new Set();
    const newOrgs = [];

    // Order: keep the segment ordering above, then by employee count desc within each.
    for (const { segment, orgs } of orgsBySegment) {
      const sorted = orgs
        .filter(o => o.name && o.country && /united states|usa/i.test(o.country))
        .filter(o => /(florida|fl)\b/i.test([o.state, o.city].filter(Boolean).join(' ')))
        .sort((a, b) => (b.estimatedEmployees || 0) - (a.estimatedEmployees || 0));
      for (const o of sorted) {
        const key = normalize(o.name);
        if (!key || seen.has(key) || existingOrgKeys.has(key)) continue;
        // Filter to in-territory by city (best-effort using classifyCounty)
        const county = classifyCounty(o.city) || '';
        if (!county) continue; // out of CFL North 15 counties
        seen.add(key);
        newOrgs.push({ ...o, county, segment });
        if (newOrgs.length >= 24) break;
      }
      if (newOrgs.length >= 24) break;
    }

    if (newOrgs.length === 0) {
      setNewAccountsProgress({ phase: 'done', done: 0, total: 0, currentOrg: '' });
      setNewAccountsResults([]);
      setNewAccountsRunning(false);
      showToast('No net-new in-territory orgs found across the three ICPs', 'info');
      return;
    }

    // Phase 2 — for each new org, chained people-search.
    setNewAccountsProgress({ phase: 'people', done: 0, total: newOrgs.length, currentOrg: '' });
    const peopleResults = [];
    for (let i = 0; i < newOrgs.length; i++) {
      let cancelled = false;
      setNewAccountsCancel(c => { cancelled = c; return c; });
      if (cancelled) break;

      const org = newOrgs[i];
      setNewAccountsProgress({ phase: 'people', done: i, total: newOrgs.length, currentOrg: org.name });

      // Use full facilities ladder for net-new accounts (no existing contact to anchor on)
      const titles = getMultiThreadTitles(null, org.segment);

      try {
        const data = await postJson('/api/apollo-people-search', {
          organizationName: org.name,
          titles,
          limit: 8,
        }, { retries: 1, timeoutMs: 20_000 });
        const candidates = (data?.candidates || []).filter(c => c.name).map(c => ({
          ...c,
          tier: classifyTier(c.title),
        }));
        peopleResults.push({ org, candidates });
      } catch (err) {
        peopleResults.push({ org, candidates: [], error: err.message });
      }
      if (i < newOrgs.length - 1) await new Promise(r => setTimeout(r, 220));
    }

    setNewAccountsResults(peopleResults);
    setNewAccountsProgress({ phase: 'done', done: newOrgs.length, total: newOrgs.length, currentOrg: '' });
    setNewAccountsRunning(false);

    const totalCandidates = peopleResults.reduce((s, r) => s + (r.candidates?.length || 0), 0);
    showToast(`Found ${peopleResults.length} new orgs with ${totalCandidates} candidates`);
  };

  // Bulk-add picks from the new-accounts wizard. Picks shape: [{ org, candidate }, ...]
  const addNewAccountPicks = (picks) => {
    if (!picks || picks.length === 0) return;
    const now = Date.now();
    const newProspects = picks.map(({ org, candidate }, i) => {
      const icp = classifyICP(org.name, candidate.title);
      const titleClass = classifyTitle(candidate.title);
      return {
        id: `newaccount_${now}_${i}`,
        name: candidate.name,
        title: candidate.title || '',
        company: org.name,
        email: '',
        phone: '',
        city: org.city || candidate.city || '',
        county: org.county || classifyCounty(org.city) || '',
        state: 'FL',
        zip: '',
        segment: org.segment || icp.segment,
        icpStatus: icp.status,
        titleAltitude: titleClass.altitude,
        status: 'Ready',
        source: `Apollo (new account: ${org.name})`,
        priority: 95, // higher than cross-thread peers — these are net-new accounts
        apolloId: candidate.apolloId,
        organizationApolloId: org.apolloId,
        linkedinUrl: candidate.linkedinUrl,
        photoUrl: candidate.photoUrl,
        organizationDomain: org.domain,
      };
    });
    setProspects(prev => [...newProspects, ...prev]);
    showToast(`Added ${newProspects.length} contact${newProspects.length === 1 ? '' : 's'} from net-new accounts`);
    setNewAccountsOpen(false);
    setNewAccountsResults([]);
  };

  // === Batch enrich (end-of-month "Spend remaining credits" wizard) ===
  // Runs sequential Apollo enrichments on the user's chosen candidates with a
  // small delay between calls (rate-limit etiquette). Updates progress live.
  const runBatchEnrich = async (prospectIds) => {
    if (!prospectIds || prospectIds.length === 0) return;
    setBatchEnrichRunning(true);
    setBatchEnrichProgress({ done: 0, total: prospectIds.length });

    let success = 0;
    let misses = 0;
    let errors = 0;

    for (let i = 0; i < prospectIds.length; i++) {
      const target = prospects.find(p => p.id === prospectIds[i]);
      if (!target) { errors++; continue; }

      try {
        const [firstName, ...rest] = (target.name || '').trim().split(/\s+/);
        const lastName = rest.join(' ');
        const data = await postJson('/api/apollo-enrich', {
          firstName,
          lastName,
          name: target.name,
          organizationName: target.company,
        }, { retries: 1, timeoutMs: 30_000 });

        if (data?.matched && data.person) {
          // Apply enrichment immediately (no review step in batch mode)
          setProspects(prev => prev.map(p => {
            if (p.id !== target.id) return p;
            const update = { ...p };
            const apollo = data.person;
            if (apollo.email) update.email = apollo.email;
            if (apollo.phone && !p.phone) update.phone = apollo.phone;
            if (apollo.title && (!p.title || p.title.toLowerCase() === 'student')) update.title = apollo.title;
            if (apollo.linkedinUrl) update.linkedinUrl = apollo.linkedinUrl;
            update.enrichedAt = new Date().toISOString();
            update.enrichedBy = 'apollo-batch';
            return update;
          }));
          success++;
        } else {
          misses++;
        }
      } catch (e) {
        console.warn('[shp] batch enrich error for', target.name, e.message);
        errors++;
      }

      setBatchEnrichProgress({ done: i + 1, total: prospectIds.length });
      // Light rate-limit pause between Apollo calls
      await new Promise(r => setTimeout(r, 350));
    }

    fetchApolloQuota(); // refresh quota after the batch
    setBatchEnrichRunning(false);
    setBatchEnrichOpen(false);
    showToast(`Batch enrich complete · ${success} matched · ${misses} no-match · ${errors} error${errors === 1 ? '' : 's'}`);
  };

  // Apply Apollo's findings to the prospect record (updates email, phone, title in-place)
  const applyEnrichment = (prospectId) => {
    const proposal = proposedEnrichment[prospectId];
    if (!proposal?.matched || !proposal.person) return;
    const apollo = proposal.person;

    setProspects(prev => prev.map(p => {
      if (p.id !== prospectId) return p;
      // Update fields where Apollo has data — but never overwrite a non-empty existing value
      // unless Apollo's email is "verified" and the existing one is personal
      const update = { ...p };
      if (apollo.email && apollo.emailStatus === 'verified') {
        // Always prefer Apollo's verified email
        update.email = apollo.email;
      } else if (apollo.email && (!p.email || /(gmail|yahoo|hotmail|aol|comcast)/i.test(p.email))) {
        // Use Apollo email if existing is personal/missing, even if not "verified"
        update.email = apollo.email;
      }
      if (apollo.phone && !p.phone) update.phone = apollo.phone;
      if (apollo.title && (!p.title || p.title.toLowerCase() === 'student')) update.title = apollo.title;
      if (apollo.linkedinUrl) update.linkedinUrl = apollo.linkedinUrl;
      update.enrichedAt = new Date().toISOString();
      update.enrichedBy = 'apollo';
      return update;
    }));

    // Clear the proposal
    setProposedEnrichment(prev => {
      const next = { ...prev };
      delete next[prospectId];
      return next;
    });

    showToast('Enrichment applied');
  };

  // Reject Apollo's findings — clears the proposal so the user can decide what to do
  const dismissEnrichment = (prospectId) => {
    setProposedEnrichment(prev => {
      const next = { ...prev };
      delete next[prospectId];
      return next;
    });
  };

  // === Open Outlook web compose with email pre-filled ===
  // Anthony is on M365 with two-way Pipedrive sync, so Outlook-sent emails auto-log to deals.
  // No Smart BCC needed (sync handles it). One click: pre-fill → review → click Send in Outlook.
  // Now also tracks touch count per prospect — guards against accidentally
  // emailing the same person past the maxTouches cap (default 3) which damages
  // domain reputation via spam complaints.
  const sendViaOutlook = () => {
    if (!selectedProspect?.email) {
      showToast('No email address — add one first', 'error');
      return;
    }

    // Pre-flight: warn if we're at or beyond the touch cap.
    const prevRec = pdRecords[selectedProspect.id] || {};
    const prevHistory = Array.isArray(prevRec.sentHistory) ? prevRec.sentHistory : (prevRec.sentAt ? [prevRec.sentAt] : []);
    const currentCount = prevHistory.length;
    const cap = Number.isFinite(config.maxTouches) ? config.maxTouches : DEFAULT_MAX_TOUCHES;
    if (currentCount >= cap) {
      const ok = window.confirm(
        `This prospect has already received ${currentCount} email${currentCount === 1 ? '' : 's'} from you ` +
        `(your cap is ${cap}).\n\n` +
        `Continuing risks domain-reputation damage from spam complaints. ` +
        `Consider marking them "Pursue Later" or "Dead" instead.\n\n` +
        `Send anyway?`
      );
      if (!ok) {
        showToast(`Held back — ${currentCount} prior touch${currentCount === 1 ? '' : 'es'} already`, 'info');
        return;
      }
    }

    // IMPORTANT: build the URL manually with encodeURIComponent so spaces become %20.
    // URLSearchParams encodes spaces as '+', which the Outlook deeplink does NOT decode back to spaces
    // (it displays them literally as '+' signs in the email body and subject).
    const enc = encodeURIComponent;
    const parts = [
      `to=${enc(selectedProspect.email)}`,
      `subject=${enc(draftEmail.subject)}`,
      `body=${enc(draftEmail.body)}`,
    ];
    if (config.smartBcc) parts.push(`bcc=${enc(config.smartBcc)}`);
    const url = `https://outlook.office.com/mail/deeplink/compose?${parts.join('&')}`;
    window.open(url, '_blank', 'noopener,noreferrer');

    const now = new Date().toISOString();
    const nextHistory = [...prevHistory, now];
    setPdRecords(prev => ({
      ...prev,
      [selectedProspect.id]: {
        ...prev[selectedProspect.id],
        sentAt: now,                  // kept for backward compatibility
        sentHistory: nextHistory,     // full timeline of touches
        touchCount: nextHistory.length,
      },
    }));
    showToast(`Opened in Outlook · touch #${nextHistory.length} of ${cap}`);
  };

  // === Open the lead/deal in Pipedrive's web UI to compose there ===
  // Alt path: if user prefers Pipedrive's compose UI (which sends through M365 sync)
  const openInPipedrive = () => {
    if (!selectedProspect) return;
    const rec = pdRecords[selectedProspect.id];
    if (!rec?.leadId && !rec?.dealId) {
      showToast('Push to Pipedrive first', 'info');
      return;
    }
    // Prefer lead URL if we created a lead; fall back to deal URL if it was converted
    const url = rec.leadUrl || rec.dealUrl
      || (rec.leadId ? `https://app.pipedrive.com/leads/inbox/${rec.leadId}` : `https://app.pipedrive.com/deal/${rec.dealId}`);
    window.open(url, '_blank', 'noopener,noreferrer');
    showToast('Opened in Pipedrive — click Email in the panel to compose');
  };

  // === Send email directly through Pipedrive (primary send path) ===
  // Pipedrive's connected email routes the message so open tracking works natively.
  // Requires: (a) a lead/deal already pushed to PD, (b) email connected in Pipedrive settings.
  // On failure: surfaces the error + leaves Outlook as a fallback the user can click manually.
  const sendViaPipedrive = async () => {
    if (!selectedProspect?.email) {
      showToast('No email address — add one first', 'error');
      return;
    }
    const rec = pdRecords[selectedProspect.id] || {};
    if (!rec.leadId && !rec.dealId) {
      showToast('Push to Pipedrive first (Step 1) — the email must be linked to a lead', 'info');
      return;
    }

    // Touch cap guard (same logic as sendViaOutlook)
    const prevHistory = Array.isArray(rec.sentHistory) ? rec.sentHistory : (rec.sentAt ? [rec.sentAt] : []);
    const currentCount = prevHistory.length;
    const cap = Number.isFinite(config.maxTouches) ? config.maxTouches : DEFAULT_MAX_TOUCHES;
    if (currentCount >= cap) {
      const ok = window.confirm(
        `This prospect has already received ${currentCount} email${currentCount === 1 ? '' : 's'} from you ` +
        `(your cap is ${cap}).\n\n` +
        `Continuing risks domain-reputation damage from spam complaints. ` +
        `Consider marking them "Pursue Later" or "Dead" instead.\n\nSend anyway?`
      );
      if (!ok) {
        showToast(`Held back — ${currentCount} prior touch${currentCount === 1 ? '' : 'es'} already`, 'info');
        return;
      }
    }

    setIsSendingPD(true);
    try {
      // Convert plain-text body to minimal HTML paragraphs so PD renders it cleanly
      const htmlBody = draftEmail.body
        .split(/\n\n+/)
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');

      const payload = {
        subject: draftEmail.subject,
        body: htmlBody,
        to: [{ email: selectedProspect.email, name: selectedProspect.name || '' }],
        from: {
          email: config.fromEmail || 'anthony@superiorhardwareproducts.com',
          name: config.fromName || 'Anthony Koscielecki',
        },
        sent_flag: true,
      };
      if (rec.leadId)   payload.lead_id   = rec.leadId;
      if (rec.dealId)   payload.deal_id   = rec.dealId;
      if (rec.personId) payload.person_id = rec.personId;
      if (rec.orgId)    payload.org_id    = rec.orgId;

      await pdRequest('POST', '/mailbox/mailMessages', payload);

      const now = new Date().toISOString();
      const nextHistory = [...prevHistory, now];
      setPdRecords(prev => ({
        ...prev,
        [selectedProspect.id]: {
          ...prev[selectedProspect.id],
          sentAt: now,
          sentHistory: nextHistory,
          touchCount: nextHistory.length,
        },
      }));
      showToast(`Sent via Pipedrive · touch #${nextHistory.length} of ${cap}`);
    } catch (err) {
      showToast(`Pipedrive send failed: ${err.message} — use Outlook fallback below`, 'error');
    } finally {
      setIsSendingPD(false);
    }
  };

  // Batch variant — called by BatchDraftModal with explicit prospect/subject/body args.
  // Does NOT enforce touch cap (batch users pre-screened the list).
  const sendViaPipedriveForBatch = async (prospect, subject, body) => {
    if (!prospect?.email) throw new Error('No email address');
    const rec = pdRecords[prospect.id] || {};

    const htmlBody = body
      .split(/\n\n+/)
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    const payload = {
      subject,
      body: htmlBody,
      to: [{ email: prospect.email, name: prospect.name || '' }],
      from: {
        email: config.fromEmail || 'anthony@superiorhardwareproducts.com',
        name: config.fromName || 'Anthony Koscielecki',
      },
      sent_flag: true,
    };
    if (rec.leadId)   payload.lead_id   = rec.leadId;
    if (rec.dealId)   payload.deal_id   = rec.dealId;
    if (rec.personId) payload.person_id = rec.personId;
    if (rec.orgId)    payload.org_id    = rec.orgId;

    await pdRequest('POST', '/mailbox/mailMessages', payload);

    const now = new Date().toISOString();
    const prevHistory = Array.isArray(rec.sentHistory) ? rec.sentHistory : (rec.sentAt ? [rec.sentAt] : []);
    const nextHistory = [...prevHistory, now];
    setPdRecords(prev => ({
      ...prev,
      [prospect.id]: {
        ...prev[prospect.id],
        sentAt: now,
        sentHistory: nextHistory,
        touchCount: nextHistory.length,
      },
    }));
  };

  // Backwards-compatible alias for any UI still calling sendViaGmail
  const sendViaGmail = sendViaOutlook;

  // === Batch Draft Queue ===
  // Research + AI-draft N selected prospects sequentially.
  // Re-uses cached research when available (same research that was already done
  // for a prospect via the single-prospect flow). Falls back to the deterministic
  // composer when the AI draft call fails so every prospect always gets something.
  const runBatchDraft = async (ids) => {
    if (!ids || ids.length === 0) return;
    setBatchDraftOpen(true);
    setBatchDraftRunning(true);
    setBatchDraftCancel(false);
    setBatchDraftProgress({ done: 0, total: ids.length, currentName: '' });
    setBatchDraftQueue(Object.fromEntries(ids.map(id => [id, { status: 'pending' }])));

    for (let i = 0; i < ids.length; i++) {
      let cancelled = false;
      setBatchDraftCancel(c => { cancelled = c; return c; });
      if (cancelled) break;

      const id = ids[i];
      const prospect = prospectsWithOverrides.find(p => p.id === id);
      if (!prospect) continue;

      setBatchDraftProgress({ done: i, total: ids.length, currentName: prospect.name || prospect.company });

      // === RESEARCH (skip if already cached) ===
      setBatchDraftQueue(prev => ({ ...prev, [id]: { status: 'researching' } }));
      let research = researchData[id] || null;
      if (!research) {
        try {
          const data = await postJson('/api/anthropic', {
            model: ANTHROPIC_MODEL,
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: `You are researching a sales prospect for Superior Hardware Products, a commercial door & hardware distributor in Central Florida. The prospect is:

Name: ${prospect.name || '(no contact name)'}
Title: ${prospect.title || '(unknown)'}
Organization: ${prospect.company}
Location: ${prospect.city}, ${prospect.county || 'Florida'}
ICP segment: ${prospect.segment}

YOUR TASK: Use web_search to find SPECIFIC, CONCRETE information about THIS organization. Don't return generic segment-level pain points. Search for:
1. Their facilities footprint — number of buildings, square footage, recent construction or renovation news
2. Recent news, board meeting items, or budget discussions about facilities/maintenance/security
3. Capital improvement plans, master plans, RFPs related to doors/hardware/access control
4. Anything specific that suggests a current or upcoming facility need

If you can't find specifics about the organization, search broader (the school district, the city's CIP, etc.). Try at least 2 different search queries before giving up.

Return ONLY a JSON object (no preamble, no markdown). Be honest about specificity:
{
  "companySnapshot": "1-2 sentences about the org. Reference specific facts when found.",
  "facilityProfile": "1-2 sentences on facility footprint. Use real numbers when found, otherwise say 'inferred from segment'.",
  "painSignals": ["3 specific pain points. Mark with [SPECIFIC] if grounded in research, [INFERRED] if from segment defaults."],
  "openingHook": "ONE assumptive question that applies BROADLY to the segment — never reveal research. Stay segment-universal.",
  "fitScore": 85,
  "fitReasoning": "1 sentence on SHP fit",
  "specificityRating": "high | medium | low",
  "specificityNote": "1 sentence explaining what you found vs. couldn't find"
}`,
            }],
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          }, { retries: 1, timeoutMs: 90_000 });

          const blocks = Array.isArray(data?.content) ? data.content : [];
          const text = blocks.filter(b => b?.type === 'text').map(b => b.text).filter(Boolean).join('\n');
          const cleaned = text.replace(/```json|```/g, '').trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            parsed.painSignals = Array.isArray(parsed.painSignals) ? parsed.painSignals : [];
            parsed.fitScore = Number.isFinite(parsed.fitScore) ? parsed.fitScore : 70;
            research = parsed;
            setResearchData(prev => ({ ...prev, [id]: research }));
          }
        } catch {
          // Research failed — use segment-default pain signals as fallback context
          const segPains = PAIN_LIBRARY[prospect.segment]?.tactical || [];
          research = {
            companySnapshot: `${prospect.company} — ${prospect.segment} in ${prospect.county || 'CFL North'}.`,
            facilityProfile: 'Multi-building operator, inferred from segment.',
            painSignals: segPains.slice(0, 3).map(p => `[INFERRED] ${p}`),
            fitScore: 75,
            fitReasoning: `${prospect.segment} is in-ICP for SHP.`,
            specificityRating: 'low',
            specificityNote: 'Research unavailable — segment defaults used.',
          };
          setResearchData(prev => ({ ...prev, [id]: research }));
        }
      }
      setBatchDraftQueue(prev => ({ ...prev, [id]: { ...prev[id], status: 'drafting', research } }));

      // === DRAFT ===
      const proofs = pickProofPoints(prospect, 3);
      const sigWithAddress = ensureAddressInSignature(config.signature, config.companyAddress);
      let draft;
      let draftFallback = false;
      try {
        const prompt = buildColdEmailPrompt(prospect, research, prospect.segment, sigWithAddress, config.softOptOut);
        const data = await postJson('/api/anthropic', {
          model: ANTHROPIC_MODEL,
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }, { retries: 1, timeoutMs: 60_000 });

        const blocks = Array.isArray(data?.content) ? data.content : [];
        const text = blocks.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').trim();
        const cleaned = text.replace(/```json|```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed?.subject && parsed?.body) {
            draft = { subject: parsed.subject, body: parsed.body };
          }
        }
      } catch { /* fall through to deterministic below */ }

      if (!draft) {
        const result = composeEmail({ prospect, signature: sigWithAddress, proofPoints: proofs, softOptOut: config.softOptOut });
        draft = { subject: result.subject, body: result.body };
        draftFallback = true;
      }

      setBatchDraftQueue(prev => ({ ...prev, [id]: { status: 'ready', research, draft, fallback: draftFallback } }));
    }

    setBatchDraftProgress(prev => ({ ...prev, done: ids.length, currentName: '' }));
    setBatchDraftRunning(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  };

  // === Layer overrides + computed flags onto prospects ===
  // Each prospect gets:
  // - outreachStatus / revisitDate from overrides
  // - customerMatch (computed from CUSTOMERS — auto-overrides Active to Customer if matched)
  // - needsEnrichment + enrichmentReasons (computed from data quality rules)
  const prospectsWithOverrides = useMemo(() => {
    return prospects.map(p => {
      const o = overrides[p.id];
      const explicitStatus = o?.outreachStatus;

      // Check customer collision (only if user hasn't explicitly set status)
      let customerMatch = null;
      let computedStatus = explicitStatus || 'Active';
      if (!explicitStatus) {
        const check = customerCheck(p);
        if (check.result === 'match') {
          customerMatch = check.matchedCustomer;
          computedStatus = 'Customer'; // auto-promote
        }
      }

      // Detect enrichment needs (always computed — independent of status)
      const enrichment = detectEnrichmentNeeds(p);

      return {
        ...p,
        outreachStatus: computedStatus,
        revisitDate: o?.revisitDate || null,
        customerMatch, // present when org auto-matched a customer
        needsEnrichment: enrichment.needsEnrichment,
        enrichmentReasons: enrichment.reasons,
      };
    });
  }, [prospects, overrides]);

  // === Filtered prospect list (memoized) ===
  // Default Active view excludes enrichment-needed prospects (they're broken data, not real prospects yet).
  // The "Needs Enrichment" filter option surfaces them when you want to work through them.
  const filteredProspects = useMemo(() => {
    return prospectsWithOverrides.filter(p => {
      // Outreach filter — special handling for 'NeedsEnrichment'
      if (filterOutreach === 'NeedsEnrichment') {
        if (!p.needsEnrichment) return false;
      } else if (filterOutreach !== 'all') {
        if (p.outreachStatus !== filterOutreach) return false;
        // When viewing Active (default), hide enrichment-needed prospects (they need data work first)
        if (filterOutreach === 'Active' && p.needsEnrichment) return false;
      }
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      if (filterSegment !== 'all' && p.segment !== filterSegment) return false;
      if (filterCounty !== 'all' && p.county !== filterCounty) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${p.name} ${p.company} ${p.city} ${p.title}`.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }, [prospectsWithOverrides, filterOutreach, filterStatus, filterSegment, filterCounty, search]);

  // Clusters: only Ready + Active + clean data (no Customers, Dead, PursueLater, or enrichment-needed)
  const clusters = useMemo(() => buildClusters(
    prospectsWithOverrides.filter(p =>
      p.status === 'Ready' && p.outreachStatus === 'Active' && !p.needsEnrichment
    )
  ), [prospectsWithOverrides]);

  // Pursue Later items whose revisit date has hit (today or earlier).
  // Re-evaluates whenever `nowTick` changes — visibilitychange and the 30-min
  // interval tick — so a tab left open past midnight surfaces newly-due items.
  const pursueLaterDue = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return prospectsWithOverrides.filter(p =>
      p.outreachStatus === 'PursueLater' && p.revisitDate && p.revisitDate <= today
    );
  }, [prospectsWithOverrides, nowTick]);

  // === Effective Apollo quota ===
  // Apollo's free-tier API doesn't expose usage data via auth/health, so
  // /api/apollo-quota returns nulls there. The local cycle tracker is the
  // ground truth: we know how many credits we've spent because we count
  // them on each successful enrich. Merge the two sources, preferring
  // server data when present.
  const effectiveQuota = useMemo(() => {
    const serverHasData = apolloQuota?.total != null;
    if (serverHasData) {
      return {
        used: apolloQuota.used ?? apolloCycle.creditsUsedThisCycle ?? 0,
        total: apolloQuota.total,
        remaining: apolloQuota.remaining ?? Math.max(0, apolloQuota.total - (apolloCycle.creditsUsedThisCycle ?? 0)),
        plan: apolloQuota.plan,
        source: 'server',
      };
    }
    // Server data unavailable — fall back to local tracker + configured cap.
    const cap = Number.isFinite(config.apolloMonthlyCredits) ? config.apolloMonthlyCredits : 50;
    const used = apolloCycle.creditsUsedThisCycle ?? 0;
    return {
      used,
      total: cap,
      remaining: Math.max(0, cap - used),
      plan: 'local tracker',
      source: 'local',
    };
  }, [apolloQuota, apolloCycle, config.apolloMonthlyCredits]);

  // === Stats ===
  // pushedLeads / pushedDeals split so the dashboard can label honestly.
  // Previous "Leads Pushed: 0" was misleading because it assumed pushes always
  // landed in the Lead Inbox; some users convert immediately to Deals.
  const stats = useMemo(() => {
    const records = Object.values(pdRecords);
    const pushedLeads = records.filter(r => r.leadId && !r.dealId).length;
    const pushedDeals = records.filter(r => r.dealId).length;
    return {
      total: prospectsWithOverrides.length,
      ready: prospectsWithOverrides.filter(p =>
        p.status === 'Ready' && p.outreachStatus === 'Active' && !p.needsEnrichment
      ).length,
      customers: prospectsWithOverrides.filter(p => p.outreachStatus === 'Customer').length,
      pursueLater: prospectsWithOverrides.filter(p => p.outreachStatus === 'PursueLater').length,
      needsEnrichment: prospectsWithOverrides.filter(p => p.needsEnrichment && p.outreachStatus === 'Active').length,
      pushed: pushedLeads + pushedDeals, // total touched in PD
      pushedLeads,
      pushedDeals,
      sent: records.filter(r => r.sentAt).length,
      openDeals: Object.values(stageDeals).reduce((a, arr) => a + arr.length, 0),
      pursueLaterDueCount: pursueLaterDue.length,
    };
  }, [prospectsWithOverrides, pdRecords, stageDeals, pursueLaterDue]);

  // === STYLES ===
  const styles = makeStyles(pdConnected, pdMeta.stages.length);

  return (
    <div style={styles.container}>
      <Header
        styles={styles}
        view={view}
        setView={setView}
        pdConnected={pdConnected}
        isConnecting={isConnecting}
        userName={pdMeta.userName}
      />
      <div className="shp-main" style={styles.main}>
        {view === 'dashboard' && <DashboardView styles={styles} stats={stats} pdConnected={pdConnected} pdConnectError={pdConnectError} hasAttemptedConnect={hasAttemptedConnect} apolloQuota={effectiveQuota} apolloCycle={apolloCycle} openBatchEnrich={() => setBatchEnrichOpen(true)} crossThreadPool={crossThreadPool} bulkCrossThreadRunning={bulkCrossThreadRunning} findNewAccounts={findNewAccounts} newAccountsRunning={newAccountsRunning} pdMeta={pdMeta} setView={setView} setFilterOutreach={setFilterOutreach} clusters={clusters} fromName={config.fromName} pursueLaterDue={pursueLaterDue} researchProspect={researchProspect} researchData={researchData} pdRecords={pdRecords} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} enrichProspect={enrichProspect} applyEnrichment={applyEnrichment} dismissEnrichment={dismissEnrichment} isEnriching={isEnriching} proposedEnrichment={proposedEnrichment} multiThreadAccount={multiThreadAccount} />}
        {view === 'find' && <FindView styles={styles} apolloCriteria={apolloCriteria} setApolloCriteria={setApolloCriteria} runApolloSearch={runApolloSearch} isApolloSearching={isApolloSearching} manualForm={manualForm} setManualForm={setManualForm} addManualProspect={addManualProspect} importCsvRows={importCsvRows} showToast={showToast} prospects={filteredProspects} researchProspect={researchProspect} researchData={researchData} pdRecords={pdRecords} filterSegment={filterSegment} setFilterSegment={setFilterSegment} filterCounty={filterCounty} setFilterCounty={setFilterCounty} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterOutreach={filterOutreach} setFilterOutreach={setFilterOutreach} search={search} setSearch={setSearch} totalProspects={prospects.length} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} enrichProspect={enrichProspect} applyEnrichment={applyEnrichment} dismissEnrichment={dismissEnrichment} isEnriching={isEnriching} proposedEnrichment={proposedEnrichment} apolloQuota={effectiveQuota} multiThreadAccount={multiThreadAccount} selectedProspectIds={selectedProspectIds} onToggleSelect={(id) => setSelectedProspectIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; })} onSelectAll={(ids) => setSelectedProspectIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; })} onClearSelection={() => setSelectedProspectIds(new Set())} onBatchDraft={(ids) => runBatchDraft(ids)} />}
        {view === 'clusters' && <ClustersView styles={styles} clusters={clusters} researchProspect={researchProspect} researchData={researchData} pdRecords={pdRecords} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} enrichProspect={enrichProspect} applyEnrichment={applyEnrichment} dismissEnrichment={dismissEnrichment} isEnriching={isEnriching} proposedEnrichment={proposedEnrichment} multiThreadAccount={multiThreadAccount} />}
        {view === 'research' && selectedProspect && <ResearchView styles={styles} prospect={selectedProspect} research={researchData[selectedProspect.id]} isResearching={isResearching} setView={setView} draftOutreach={draftOutreach} />}
        {view === 'compose' && selectedProspect && <ComposeView styles={styles} prospect={selectedProspect} setProspect={setSelectedProspect} draftEmail={draftEmail} setDraftEmail={setDraftEmail} isDrafting={isDrafting} draftOutreach={draftOutreach} draftDiagnostic={draftDiagnostic} pushToPipedrive={pushToPipedrive} sendViaPipedrive={sendViaPipedrive} isSendingPD={isSendingPD} sendViaOutlook={sendViaOutlook} openInPipedrive={openInPipedrive} pdRecords={pdRecords} pdConnected={pdConnected} isPushing={isPushing} config={config} setView={setView} followUpDays={FOLLOW_UP_DAYS} />}
        {view === 'pipeline' && <PipelineView styles={styles} pdConnected={pdConnected} pdMeta={pdMeta} stageDeals={stageDeals} syncPipeline={syncPipeline} isSyncing={isSyncing} setView={setView} />}
        {view === 'coach' && <CoachView styles={styles} coachTab={coachTab} setCoachTab={setCoachTab} coachSelectedSegment={coachSelectedSegment} setCoachSelectedSegment={setCoachSelectedSegment} copyToClipboard={copyToClipboard} />}
        {view === 'settings' && <SettingsView styles={styles} config={config} setConfig={setConfig} saveConfig={saveConfig} pdConnected={pdConnected} pdConnectError={pdConnectError} pdMeta={pdMeta} autoConnect={autoConnect} isConnecting={isConnecting} syncPipeline={syncPipeline} isSyncing={isSyncing} apolloQuota={effectiveQuota} fetchApolloQuota={fetchApolloQuota} prospects={prospects} overrides={overrides} pdRecords={pdRecords} researchData={researchData} showToast={showToast} />}
      </div>
      {toast && <Toast styles={styles} toast={toast} />}
      {pursueLaterFor && <PursueLaterModal styles={styles} date={pursueLaterDate} setDate={setPursueLaterDate} onSave={savePursueLater} onCancel={() => setPursueLaterFor(null)} />}
      {deleteConfirm && <DeleteConfirmModal styles={styles} prospect={deleteConfirm} onConfirm={executeDelete} onCancel={() => setDeleteConfirm(null)} />}
      {batchDraftOpen && (
        <BatchDraftModal
          styles={styles}
          isRunning={batchDraftRunning}
          progress={batchDraftProgress}
          queue={batchDraftQueue}
          prospects={prospectsWithOverrides}
          config={config}
          pdRecords={pdRecords}
          onSendViaPipedrive={sendViaPipedriveForBatch}
          onCancel={() => {
            if (batchDraftRunning) setBatchDraftCancel(true);
            else setBatchDraftOpen(false);
          }}
          onClose={() => setBatchDraftOpen(false)}
        />
      )}
      {findPeersFor && (
        <FindPeersModal
          styles={styles}
          parent={findPeersFor}
          isLoading={isFindingPeers}
          results={findPeersResults}
          onAdd={(picked) => addPeersToPool(findPeersFor, picked)}
          onCancel={() => { setFindPeersFor(null); setFindPeersResults(null); }}
        />
      )}
      {batchEnrichOpen && (
        <BatchEnrichModal
          styles={styles}
          prospects={prospectsWithOverrides}
          clusters={clusters}
          pdRecords={pdRecords}
          apolloQuota={effectiveQuota}
          apolloCycle={apolloCycle}
          isRunning={batchEnrichRunning}
          progress={batchEnrichProgress}
          onConfirm={runBatchEnrich}
          onCancel={() => setBatchEnrichOpen(false)}
        />
      )}
      {bulkCrossThreadOpen && (
        <BulkCrossThreadModal
          styles={styles}
          isRunning={bulkCrossThreadRunning}
          progress={bulkCrossThreadProgress}
          results={bulkCrossThreadResults}
          onAdd={addCrossThreadPicks}
          onCancel={() => {
            // If still running, the run loop will see cancel and exit cleanly.
            setBulkCrossThreadCancel(true);
            setBulkCrossThreadOpen(false);
          }}
          onCancelRun={() => setBulkCrossThreadCancel(true)}
        />
      )}
      {newAccountsOpen && (
        <NewAccountsModal
          styles={styles}
          isRunning={newAccountsRunning}
          progress={newAccountsProgress}
          results={newAccountsResults}
          onAdd={addNewAccountPicks}
          onCancel={() => {
            setNewAccountsCancel(true);
            setNewAccountsOpen(false);
          }}
          onCancelRun={() => setNewAccountsCancel(true)}
        />
      )}
      {/* Mobile bottom tab bar — only visible on small screens (CSS-gated). */}
      <MobileNav
        view={view}
        setView={(v) => { setView(v); setMoreOpen(false); }}
        openMore={() => setMoreOpen(true)}
      />
      {moreOpen && (
        <MoreSheet
          styles={styles}
          view={view}
          setView={setView}
          onClose={() => setMoreOpen(false)}
        />
      )}
      <GlobalStyles />
    </div>
  );
}

// =================================================================
// === HEADER ===
// =================================================================
// Single source-of-truth for the nav items — used by Header (desktop)
// and MobileNav (bottom tab bar on phones).
const NAV_ITEMS = [
  { id: 'dashboard', icon: TrendingUp, label: 'Dashboard',  short: 'Home'    },
  { id: 'find',      icon: Search,     label: 'Find',       short: 'Find'    },
  { id: 'clusters',  icon: Compass,    label: 'Clusters',   short: 'Trips'   },
  { id: 'pipeline',  icon: Briefcase,  label: 'Pipeline',   short: 'Deals'   },
  { id: 'coach',     icon: BookOpen,   label: 'Coach',      short: 'Coach'   },
  { id: 'settings',  icon: Settings,   label: 'Settings',   short: 'Setup'   },
];

// Mobile bottom-tab primaries: 4 most-used flows are one-thumb reachable.
// Coach / Settings live in the "More" sheet.
const MOBILE_PRIMARY = ['dashboard', 'find', 'clusters', 'pipeline'];

function Header({ styles, view, setView, pdConnected, isConnecting, userName }) {
  const longChipLabel = pdConnected
    ? `Pipedrive · ${userName || 'connected'}`
    : isConnecting ? 'Connecting…' : 'Pipedrive disconnected';
  const shortChipLabel = pdConnected
    ? (userName ? userName.split(' ')[0] : 'Connected')
    : isConnecting ? 'Connecting…' : 'Disconnected';

  return (
    <div className="shp-header" style={styles.header}>
      <div style={styles.logo}>
        <div style={styles.logoMark}>SHP</div>
        <div>
          <div style={styles.logoText}>Outbound Agent</div>
          <div style={styles.logoSub}>CFL North · v3</div>
        </div>
      </div>

      {/* Desktop right side: full connection chip + horizontal nav */}
      <div className="shp-show-desktop" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={styles.pdBadge(pdConnected)} onClick={() => setView('settings')} title={longChipLabel}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: pdConnected ? 'var(--ok)' : isConnecting ? 'var(--warn)' : 'var(--danger)' }} />
          {/* Order matters: "Connecting…" wins over the stale "disconnected" label
              while a connection attempt is in flight, so the badge never lies. */}
          {longChipLabel}
        </div>
        <div style={styles.nav}>
          {NAV_ITEMS.map(item => (
            <button key={item.id} style={styles.navBtn(view === item.id)} onClick={() => setView(item.id)}>
              <item.icon size={14} /> {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile right side: compact connection chip only — nav lives in MobileNav at the bottom */}
      <div className="shp-show-mobile" style={{ display: 'none', alignItems: 'center' }}>
        <button
          aria-label={longChipLabel}
          onClick={() => setView('settings')}
          title={longChipLabel}
          style={{
            ...styles.pdBadge(pdConnected),
            padding: '6px 10px',
            fontSize: 'var(--fs-12)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: pdConnected ? 'var(--ok)' : isConnecting ? 'var(--warn)' : 'var(--danger)' }} />
          {shortChipLabel}
        </button>
      </div>
    </div>
  );
}

// Bottom-fixed mobile nav. CSS @media gates visibility — only renders on small screens.
function MobileNav({ view, setView, openMore }) {
  return (
    <nav className="shp-mobile-nav" aria-label="Primary">
      {MOBILE_PRIMARY.map(id => {
        const item = NAV_ITEMS.find(n => n.id === id);
        if (!item) return null;
        const Icon = item.icon;
        const active = view === item.id;
        return (
          <button
            key={item.id}
            className="shp-mobile-nav-btn"
            data-active={active}
            onClick={() => setView(item.id)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} />
            {item.short}
          </button>
        );
      })}
      <button
        className="shp-mobile-nav-btn"
        data-active={view === 'coach' || view === 'settings'}
        onClick={openMore}
        aria-haspopup="menu"
      >
        <Hash size={20} />
        More
      </button>
    </nav>
  );
}

// Bottom-sheet for overflow tabs (Coach, Settings). Reuses modal styling so it
// gets the bottom-sheet @media treatment automatically.
function MoreSheet({ styles, view, setView, onClose }) {
  const overflow = NAV_ITEMS.filter(n => !MOBILE_PRIMARY.includes(n.id));
  return (
    <div className="shp-modal-overlay" style={styles.modalOverlay} onClick={onClose}>
      <div className="shp-modal-card" style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
          More
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {overflow.map(item => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setView(item.id); onClose(); }}
                style={{
                  ...styles.secondaryBtn,
                  justifyContent: 'flex-start',
                  padding: 'var(--space-4)',
                  borderColor: active ? 'var(--shp-red)' : 'var(--border)',
                  color: active ? 'var(--shp-red)' : 'var(--text)',
                  fontSize: 'var(--fs-15)',
                }}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
          <button onClick={onClose} style={{ ...styles.secondaryBtn, justifyContent: 'center', marginTop: 'var(--space-3)' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// =================================================================
// === DASHBOARD ===
// =================================================================
function DashboardView({ styles, stats, pdConnected, pdConnectError, hasAttemptedConnect, apolloQuota, apolloCycle, openBatchEnrich, crossThreadPool, bulkCrossThreadRunning, findNewAccounts, newAccountsRunning, pdMeta, setView, setFilterOutreach, clusters, fromName, pursueLaterDue, researchProspect, researchData, pdRecords, markCustomer, markDead, markActive, openPursueLater, confirmDelete, enrichProspect, applyEnrichment, dismissEnrichment, isEnriching, proposedEnrichment, multiThreadAccount }) {
  const topClusters = clusters.slice(0, 5);
  const firstName = (fromName || 'Anthony').split(' ')[0];

  // Only show the disconnected banner once we've actually tried to connect AND it failed.
  // Prevents the stale "Pipedrive disconnected — check Vercel env vars" from flashing on
  // every page load while the connect request is in flight.
  const showDisconnectedBanner = hasAttemptedConnect && !pdConnected;

  // Subtitle now reflects connection state honestly:
  //   - connected → pipeline name + stage count
  //   - attempted but failed → real error message
  //   - still attempting → "Connecting…" so we don't flash a false "disconnected"
  const subtitle = pdConnected
    ? `Connected to ${pdMeta.defaultPipelineName} · ${pdMeta.stages.length} stages`
    : hasAttemptedConnect
      ? (pdConnectError ? `Pipedrive connection failed — ${pdConnectError}` : 'Pipedrive disconnected — check Vercel env vars')
      : 'Connecting to Pipedrive…';

  // Apollo low-credit warning thresholds. Below 20% remaining → soft warning.
  const apolloLow = apolloQuota?.remaining != null && apolloQuota.total > 0 && (apolloQuota.remaining / apolloQuota.total) < 0.2;

  // Click handler for the "Needs Enrichment" stat card → drops user into Find with the right filter applied.
  const goToNeedsEnrichment = () => {
    if (typeof setFilterOutreach === 'function') setFilterOutreach('NeedsEnrichment');
    setView('find');
  };

  return (
    <>
      <div className="shp-page-title" style={styles.pageTitle}>Welcome back, {firstName}</div>
      <div style={styles.pageSubtitle}>{subtitle}</div>

      {showDisconnectedBanner && (
        <div style={{ ...styles.card, borderColor: 'color-mix(in oklch, var(--danger) 30%, transparent)', background: 'var(--danger-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <AlertCircle size={20} color="#ff6b85" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Pipedrive not connected</div>
              <div style={{ fontSize: '13px', color: 'var(--text-2)' }}>
                {pdConnectError
                  ? <>Last error: <code style={{ background: 'var(--bg-sunk)', padding: '1px 6px', borderRadius: '4px' }}>{pdConnectError}</code>. Check <code>PIPEDRIVE_API_TOKEN</code> in Vercel and redeploy.</>
                  : 'Set PIPEDRIVE_API_TOKEN in Vercel project settings, then redeploy.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {apolloLow && (
        <div style={{ ...styles.card, borderColor: 'color-mix(in oklch, var(--warn) 30%, transparent)', background: 'var(--warn-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <AlertCircle size={20} color="#fbbf24" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Apollo credits running low</div>
              <div style={{ fontSize: '13px', color: 'var(--text-2)' }}>
                {apolloQuota.remaining} of {apolloQuota.total} credits remaining{apolloQuota.plan ? ` on ${apolloQuota.plan}` : ''}. Each enrichment match costs 1 credit.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="shp-stats-grid" style={styles.statsGrid}>
        <StatCard styles={styles} label="Active Pool" value={stats.ready} sub="Ready, in-ICP, clean data" />
        <StatCard styles={styles} label="Customers" value={stats.customers} sub="Auto-detected from invoice list" />
        <StatCard
          styles={styles}
          label="Needs Enrichment"
          value={stats.needsEnrichment}
          sub={stats.needsEnrichment > 0 ? 'Click to filter in Find →' : 'All clean'}
          onClick={stats.needsEnrichment > 0 ? goToNeedsEnrichment : undefined}
        />
        <StatCard
          styles={styles}
          label="In Pipedrive"
          value={stats.pushed}
          sub={
            stats.pursueLaterDueCount > 0
              ? `${stats.pursueLaterDueCount} pursue-later due`
              : `${stats.pushedLeads} lead${stats.pushedLeads === 1 ? '' : 's'} · ${stats.pushedDeals} deal${stats.pushedDeals === 1 ? '' : 's'}`
          }
        />
      </div>

      {pursueLaterDue.length > 0 && (
        <div style={{ ...styles.card, borderColor: 'color-mix(in oklch, var(--warn) 30%, transparent)', background: 'var(--warn-soft)' }}>
          <div style={styles.sectionTitle}><RefreshCw size={14} /> Pursue Later — Revisit Time</div>
          <div style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }}>
            {pursueLaterDue.length} prospect{pursueLaterDue.length === 1 ? '' : 's'} {pursueLaterDue.length === 1 ? 'is' : 'are'} ready to revisit. Review and decide: re-activate, push the date, or mark dead.
          </div>
          {pursueLaterDue.slice(0, 5).map(p => (
            <ProspectRow key={p.id} styles={styles} prospect={p} researchData={researchData} pdRecords={pdRecords} researchProspect={researchProspect} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} enrichProspect={enrichProspect} applyEnrichment={applyEnrichment} dismissEnrichment={dismissEnrichment} isEnriching={isEnriching} proposedEnrichment={proposedEnrichment} multiThreadAccount={multiThreadAccount} />
          ))}
          {pursueLaterDue.length > 5 && (
            <button style={{ ...styles.secondaryBtn, marginTop: '8px' }} onClick={() => setView('find')}>
              View all {pursueLaterDue.length} <ArrowRight size={13} />
            </button>
          )}
        </div>
      )}

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Sparkles size={14} /> Quick Actions</div>
        <div className="shp-grid3" style={styles.grid3}>
          <ActionTile styles={styles} icon={Target} color="var(--shp-red)" title="Find Prospects" sub="Apollo search · Manual add · Filter pool" onClick={() => setView('find')} />
          <ActionTile styles={styles} icon={Compass} color="var(--warn)" title="View Clusters" sub={`${clusters.length} trip-worthy clusters`} onClick={() => setView('clusters')} />
          <ActionTile styles={styles} icon={BookOpen} color="var(--info)" title="Sandler Coach" sub="Pain Funnel · UFC · Reversing" onClick={() => setView('coach')} />
        </div>
      </div>

      {/* Pool Expansion — three coordinated actions to maximize end-of-cycle
          credit spend:
            1. Cross-thread existing orgs (free)  — find peers at known accounts
            2. Find new in-ICP accounts (free)    — net-new orgs + decision-makers
            3. Batch enrich (1 credit/match)      — spend remaining quota on the best
      */}
      <div style={{ ...styles.card, borderColor: 'color-mix(in oklch, var(--shp-red) 25%, transparent)' }}>
        <div style={styles.sectionTitle}><UserPlus size={14} /> Pool Expansion</div>
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-2)', marginBottom: 'var(--space-4)', lineHeight: 1.6 }}>
          Three free Apollo searches, then spend leftover credits where it counts. Run in order: cross-thread existing → find net-new accounts → batch enrich.
        </div>
        <div className="shp-grid3" style={{ ...styles.grid3, marginBottom: 'var(--space-3)' }}>
          {/* 1. Cross-thread */}
          <button
            style={{ ...styles.secondaryBtn, justifyContent: 'flex-start', padding: 'var(--space-4)', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-2)', borderColor: 'color-mix(in oklch, var(--shp-red) 30%, transparent)' }}
            onClick={() => crossThreadPool({ maxOrgs: 60 })}
            disabled={bulkCrossThreadRunning || newAccountsRunning}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--shp-red)', fontWeight: 700, fontSize: 'var(--fs-13)' }}>
              {bulkCrossThreadRunning ? <Loader2 size={16} className="spin" /> : <UserPlus size={16} />}
              1 · Cross-thread existing
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-2)', textAlign: 'left' }}>
              {bulkCrossThreadRunning ? 'Running…' : 'Find peers at top 60 orgs you already work'}
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>Free · ~12 sec</div>
          </button>

          {/* 2. Find new accounts */}
          <button
            style={{ ...styles.secondaryBtn, justifyContent: 'flex-start', padding: 'var(--space-4)', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-2)', borderColor: 'color-mix(in oklch, var(--info) 30%, transparent)' }}
            onClick={findNewAccounts}
            disabled={newAccountsRunning || bulkCrossThreadRunning}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--info)', fontWeight: 700, fontSize: 'var(--fs-13)' }}>
              {newAccountsRunning ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
              2 · Find new accounts
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-2)', textAlign: 'left' }}>
              {newAccountsRunning ? 'Searching…' : 'Net-new K-12 / Higher Ed / Local Gov in CFL North'}
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>Free · ~30 sec</div>
          </button>

          {/* 3. Batch enrich */}
          <button
            style={{ ...styles.secondaryBtn, justifyContent: 'flex-start', padding: 'var(--space-4)', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-2)', borderColor: 'color-mix(in oklch, var(--ok) 30%, transparent)' }}
            onClick={openBatchEnrich}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--ok)', fontWeight: 700, fontSize: 'var(--fs-13)' }}>
              <Sparkles size={16} />
              3 · Batch enrich
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-2)', textAlign: 'left' }}>
              Spend remaining credits on the best unenriched candidates
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>1 credit per match</div>
          </button>
        </div>
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', textAlign: 'right' }}>
          {apolloQuota?.remaining != null
            ? `${apolloQuota.remaining} credits left this cycle${apolloQuota.total ? ` of ${apolloQuota.total}` : ''}`
            : 'Apollo quota loading…'}
        </div>
      </div>

      {topClusters.length > 0 && (
        <div style={styles.card}>
          <div style={styles.sectionTitle}><Compass size={14} /> Top Clusters by Trip Score</div>
          {topClusters.map(c => (
            <div key={c.county} style={{ padding: '10px 12px', borderBottom: '1px solid rgba(232, 236, 243, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{c.county} County</div>
                <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                  {c.size} prospects · {c.withEmail} with email · {Object.entries(c.bySegment).map(([s, n]) => `${n} ${s.replace(' Education', '').replace(' Government', ' Gov')}`).join(' · ')}
                </div>
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--warn)' }}>{c.tripScore}</div>
            </div>
          ))}
          <button style={{ ...styles.secondaryBtn, marginTop: '12px' }} onClick={() => setView('clusters')}>
            View all clusters <ArrowRight size={13} />
          </button>
        </div>
      )}

      {/* End-of-month nudge: when there are leftover credits and the cycle is
          almost over, prompt the user to batch-enrich their highest-leverage
          candidates. Threshold: 5 days left AND 10+ credits remaining. */}
      {apolloQuota?.remaining != null && daysUntilMonthEnd() <= 5 && apolloQuota.remaining >= 10 && (
        <div style={{ ...styles.card, borderColor: 'color-mix(in oklch, var(--info) 30%, transparent)', background: 'var(--info-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <Calendar size={20} color="#93b0d6" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>You have {apolloQuota.remaining} Apollo credits left this month</div>
              <div style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }}>
                Cycle resets in {daysUntilMonthEnd()} day{daysUntilMonthEnd() === 1 ? '' : 's'}. Spend them on your highest-leverage unenriched candidates — net-new accounts and multi-thread completions.
              </div>
              <button style={styles.primaryBtn} onClick={openBatchEnrich}>
                <Sparkles size={14} /> Spend remaining credits →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Today-at-a-glance — replaces the static "Three Pillars" filler with
          actionable numbers: outreach pushed, emails sent, open deals in PD,
          and Apollo credits remaining. */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>
          <Hash size={14} /> Today at a glance
          {apolloQuota?.remaining != null && (
            <button style={{ ...styles.secondaryBtn, marginLeft: 'auto', padding: '5px 10px', fontSize: '11px' }} onClick={openBatchEnrich}>
              <Sparkles size={11} /> Batch enrich
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          <MiniStat label="Pushed to PD" value={stats.pushed} sub={`${stats.pushedLeads} lead${stats.pushedLeads === 1 ? '' : 's'} · ${stats.pushedDeals} deal${stats.pushedDeals === 1 ? '' : 's'}`} />
          <MiniStat label="Emails sent" value={stats.sent} sub="Logged via M365 sync" />
          <MiniStat label="Open deals (PD)" value={stats.openDeals} sub="Live from pipeline" />
          <MiniStat
            label="Apollo credits"
            value={apolloQuota?.remaining ?? '—'}
            sub={apolloQuota?.total
              ? `of ${apolloQuota.total} · resets in ${daysUntilMonthEnd()}d`
              : 'unavailable'}
            color={apolloLow ? 'var(--warn)' : undefined}
          />
        </div>
      </div>
    </>
  );
}

function MiniStat({ label, value, sub, color }) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--bg-sunk)', borderRadius: '8px' }}>
      <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '4px', color: color || 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{sub}</div>
    </div>
  );
}

function StatCard({ styles, label, value, sub, onClick }) {
  // Clickable stat cards (e.g. "Needs Enrichment" → Find filter) get hover lift +
  // a chevron in the corner so users know they can drill in.
  const isClickable = typeof onClick === 'function';
  return (
    <div
      style={{
        ...styles.statCard,
        cursor: isClickable ? 'pointer' : 'default',
        position: 'relative',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div style={styles.statLabel}>{label}</div>
      <div className="shp-stat-value" style={styles.statValue}>{value}</div>
      <div style={styles.statSub}>{sub}</div>
      {isClickable && (
        <ArrowRight size={14} style={{ position: 'absolute', top: '20px', right: '16px', color: 'var(--text-3)' }} />
      )}
    </div>
  );
}

function ActionTile({ styles, icon: Icon, color, title, sub, onClick }) {
  return (
    <button style={{ ...styles.secondaryBtn, justifyContent: 'flex-start', padding: '20px', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }} onClick={onClick}>
      <Icon size={18} color={color} />
      <div style={{ fontWeight: 600, fontSize: '14px' }}>{title}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-3)', textAlign: 'left' }}>{sub}</div>
    </button>
  );
}

// =================================================================
// === FIND VIEW ===
// =================================================================
function FindView({ styles, apolloCriteria, setApolloCriteria, runApolloSearch, isApolloSearching, manualForm, setManualForm, addManualProspect, importCsvRows, showToast, prospects, researchProspect, researchData, pdRecords, filterSegment, setFilterSegment, filterCounty, setFilterCounty, filterStatus, setFilterStatus, filterOutreach, setFilterOutreach, search, setSearch, totalProspects, markCustomer, markDead, markActive, openPursueLater, confirmDelete, enrichProspect, applyEnrichment, dismissEnrichment, isEnriching, proposedEnrichment, apolloQuota, multiThreadAccount, selectedProspectIds, onToggleSelect, onSelectAll, onClearSelection, onBatchDraft }) {
  const [findTab, setFindTab] = useState('pool');

  return (
    <>
      <div className="shp-page-title" style={styles.pageTitle}>Find Prospects</div>
      <div style={styles.pageSubtitle}>{totalProspects} prospects in pool · {prospects.length} matching filters</div>

      <div style={{ ...styles.nav, marginBottom: '20px', display: 'inline-flex', flexWrap: 'wrap' }}>
        {[
          { id: 'pool', label: 'Browse Pool', count: totalProspects },
          { id: 'apollo', label: 'Apollo Search' },
          { id: 'manual', label: 'Manual Add' },
          { id: 'csv', label: 'Import CSV' },
        ].map(t => (
          <button key={t.id} style={styles.navBtn(findTab === t.id)} onClick={() => setFindTab(t.id)}>
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {findTab === 'csv' && (
        <CSVImportTab styles={styles} importCsvRows={importCsvRows} showToast={showToast} />
      )}

      {findTab === 'apollo' && (
        <div style={styles.card}>
          <div style={styles.sectionTitle}><Filter size={14} /> Apollo Search Criteria</div>
          <div style={{ marginBottom: '16px' }}>
            <label style={styles.label}>Job Titles <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(comma-separated)</span></label>
            <input style={styles.input} value={apolloCriteria.titles} onChange={e => setApolloCriteria({ ...apolloCriteria, titles: e.target.value })} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={styles.label}>Segments <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(comma-separated)</span></label>
            <input style={styles.input} value={apolloCriteria.segments} onChange={e => setApolloCriteria({ ...apolloCriteria, segments: e.target.value })} />
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '14px', padding: '10px 12px', background: 'var(--bg-sunk)', borderRadius: '6px', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--text)' }}>Filters applied:</strong> orgs HQ'd in your 15 CFL North counties · healthcare excluded · only contacts with deliverable emails (verified, extrapolated-verified, or likely-to-engage).
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
            {/* Primary path on free tier: open Apollo's web UI with criteria
                pre-filled. User reviews/refines there, exports CSV, comes
                back to Find → Import CSV. */}
            <button
              style={styles.primaryBtn}
              onClick={() => {
                const titles = apolloCriteria.titles.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                const segments = apolloCriteria.segments.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                if (titles.length === 0) {
                  showToast('Add at least one job title first', 'error');
                  return;
                }
                const url = buildApolloSearchUrl({
                  titles,
                  segments,
                  locations: APOLLO_LOCATION_STRINGS,
                  keywordsExclude: ['hospital', 'health system', 'medical center', 'physician', 'clinic'],
                });
                window.open(url, '_blank', 'noopener,noreferrer');
                showToast(`Opened Apollo filtered to ${APOLLO_LOCATION_STRINGS.length} CFL North counties. Export to CSV → Import CSV tab.`, 'info');
              }}
            >
              <ExternalLink size={14} /> Search in Apollo (opens web UI)
            </button>

            {/* Secondary: try the API search anyway — works on paid plans, surfaces
                a clear error on free tier pointing back to the Apollo deep link. */}
            <button style={styles.secondaryBtn} onClick={runApolloSearch} disabled={isApolloSearching}>
              {isApolloSearching ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
              {isApolloSearching ? 'Searching…' : 'Try API search (paid plan)'}
            </button>
          </div>

          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--info-soft)', borderRadius: 'var(--r-md)', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--info)' }}>Free-tier workflow:</strong> click <em>Search in Apollo</em> → review and refine results in Apollo's UI → click Apollo's <em>Export</em> button to download a CSV → come back to <em>Import CSV</em> tab and drop the file in.
          </div>
        </div>
      )}

      {findTab === 'manual' && (
        <div style={styles.card}>
          <div style={styles.sectionTitle}><Plus size={14} /> Add a Prospect Manually</div>
          <div className="shp-grid2" style={styles.grid2}>
            <div>
              <label style={styles.label}>Full Name *</label>
              <input style={styles.input} value={manualForm.name} onChange={e => setManualForm({ ...manualForm, name: e.target.value })} placeholder="e.g. Jane Smith" />
            </div>
            <div>
              <label style={styles.label}>Title</label>
              <input style={styles.input} value={manualForm.title} onChange={e => setManualForm({ ...manualForm, title: e.target.value })} placeholder="e.g. Director of Facilities" />
            </div>
            <div>
              <label style={styles.label}>Company / Organization *</label>
              <input style={styles.input} value={manualForm.company} onChange={e => setManualForm({ ...manualForm, company: e.target.value })} placeholder="e.g. Volusia County Schools" />
            </div>
            <div>
              <label style={styles.label}>Segment</label>
              <select style={styles.input} value={manualForm.segment} onChange={e => setManualForm({ ...manualForm, segment: e.target.value })}>
                <option value="auto">Auto-detect</option>
                <option value="K-12 Education">K-12 Education</option>
                <option value="Higher Education">Higher Education</option>
                <option value="Local Government">Local Government</option>
              </select>
            </div>
            <div>
              <label style={styles.label}>Email</label>
              <input style={styles.input} value={manualForm.email} onChange={e => setManualForm({ ...manualForm, email: e.target.value })} placeholder="email@org.com" />
            </div>
            <div>
              <label style={styles.label}>Phone</label>
              <input style={styles.input} value={manualForm.phone} onChange={e => setManualForm({ ...manualForm, phone: e.target.value })} placeholder="407-555-1234" />
            </div>
            <div>
              <label style={styles.label}>City</label>
              <input style={styles.input} value={manualForm.city} onChange={e => setManualForm({ ...manualForm, city: e.target.value })} placeholder="e.g. Sanford" />
            </div>
            <div>
              <label style={styles.label}>County (auto-detected from city)</label>
              <input style={styles.input} value={manualForm.county || classifyCounty(manualForm.city) || ''} onChange={e => setManualForm({ ...manualForm, county: e.target.value })} placeholder="e.g. Seminole" />
            </div>
          </div>
          <button style={{ ...styles.primaryBtn, marginTop: '16px' }} onClick={addManualProspect}>
            <Plus size={16} /> Add to Pool
          </button>
        </div>
      )}

      {findTab === 'pool' && (
        <>
          <div style={{ ...styles.card, padding: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
              <div>
                <label style={styles.label}>Search</label>
                <input style={styles.input} value={search} onChange={e => setSearch(e.target.value)} placeholder="name, company, city…" />
              </div>
              <div>
                <label style={styles.label}>Outreach</label>
                <select style={styles.input} value={filterOutreach} onChange={e => setFilterOutreach(e.target.value)}>
                  <option value="Active">Active</option>
                  <option value="Customer">Customers</option>
                  <option value="PursueLater">Pursue Later</option>
                  <option value="NeedsEnrichment">Needs Enrichment</option>
                  <option value="Dead">Dead</option>
                  <option value="all">All</option>
                </select>
              </div>
              <div>
                <label style={styles.label}>ICP Status</label>
                <select style={styles.input} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="all">All</option>
                  <option value="Ready">Ready</option>
                  <option value="Review Needed">Review Needed</option>
                </select>
              </div>
              <div>
                <label style={styles.label}>Segment</label>
                <select style={styles.input} value={filterSegment} onChange={e => setFilterSegment(e.target.value)}>
                  <option value="all">All</option>
                  <option value="K-12 Education">K-12 Education</option>
                  <option value="Higher Education">Higher Education</option>
                  <option value="Local Government">Local Government</option>
                  <option value="Unclassified">Unclassified</option>
                </select>
              </div>
              <div>
                <label style={styles.label}>County</label>
                <select style={styles.input} value={filterCounty} onChange={e => setFilterCounty(e.target.value)}>
                  <option value="all">All</option>
                  {TERRITORY.counties.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={styles.card}>
            {/* Section header with select-all toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
              <div style={styles.sectionTitle}><Users size={14} /> Prospects ({prospects.length})</div>
              {prospects.length > 0 && (
                <button
                  style={{ ...styles.secondaryBtn, fontSize: 'var(--fs-12)', padding: '4px 10px' }}
                  onClick={() => {
                    const visibleIds = prospects.slice(0, 50).map(p => p.id);
                    const allSelected = visibleIds.every(id => selectedProspectIds.has(id));
                    if (allSelected) {
                      onClearSelection && onClearSelection();
                    } else {
                      onSelectAll && onSelectAll(visibleIds);
                    }
                  }}
                >
                  {prospects.slice(0, 50).every(p => selectedProspectIds.has(p.id)) ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>

            {/* Floating action bar — appears when any prospects are selected */}
            {selectedProspectIds.size > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--shp-red-soft)',
                border: '1px solid color-mix(in oklch, var(--shp-red) 25%, transparent)',
                borderRadius: 'var(--r-md)',
                marginBottom: 'var(--space-4)',
                flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--text)' }}>
                  {selectedProspectIds.size} prospect{selectedProspectIds.size === 1 ? '' : 's'} selected
                </span>
                <button
                  style={{ ...styles.primaryBtn, fontSize: 'var(--fs-13)' }}
                  onClick={() => onBatchDraft && onBatchDraft(Array.from(selectedProspectIds))}
                >
                  <Sparkles size={14} /> Draft {selectedProspectIds.size} email{selectedProspectIds.size === 1 ? '' : 's'}
                </button>
                <button
                  style={{ ...styles.secondaryBtn, fontSize: 'var(--fs-13)' }}
                  onClick={() => onClearSelection && onClearSelection()}
                >
                  <X size={13} /> Clear
                </button>
              </div>
            )}

            {prospects.slice(0, 50).map(p => (
              <ProspectRow key={p.id} styles={styles} prospect={p} researchData={researchData} pdRecords={pdRecords} researchProspect={researchProspect} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} enrichProspect={enrichProspect} applyEnrichment={applyEnrichment} dismissEnrichment={dismissEnrichment} isEnriching={isEnriching} proposedEnrichment={proposedEnrichment} multiThreadAccount={multiThreadAccount} selected={selectedProspectIds.has(p.id)} onToggleSelect={() => onToggleSelect && onToggleSelect(p.id)} />
            ))}
            {prospects.length > 50 && (
              <div style={{ textAlign: 'center', padding: '14px', fontSize: '12px', color: 'var(--text-3)', fontStyle: 'italic' }}>
                Showing top 50 of {prospects.length}. Refine filters to narrow.
              </div>
            )}
            {prospects.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)', fontSize: '13px' }}>
                No prospects match your filters.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// =================================================================
// === CSV IMPORT TAB ==============================================
// =================================================================
// Self-contained tab inside FindView. File pick → column mapping →
// preview → bulk import. All state is local; the import call goes through
// the parent's importCsvRows handler which adds to the global pool.
function CSVImportTab({ styles, importCsvRows, showToast }) {
  const [fileName, setFileName] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importedStats, setImportedStats] = useState(null);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportedStats(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const { headers: hs, rows: rs } = parseCsv(text);
      if (hs.length === 0) {
        showToast('Could not parse CSV — make sure the first row contains column names', 'error');
        return;
      }
      setFileName(f.name);
      setHeaders(hs);
      setRows(rs);
      setMapping(autoMapCsvColumns(hs));
    };
    reader.onerror = () => showToast('Failed to read file', 'error');
    reader.readAsText(f);
  };

  // Live-derive parsed prospects and import preview stats from the mapping.
  const parsedCandidates = useMemo(() => {
    if (rows.length === 0) return [];
    const out = [];
    rows.forEach((r, idx) => {
      const p = csvRowToProspect(r, mapping, idx);
      if (p) out.push(p);
    });
    return out;
  }, [rows, mapping]);

  const previewStats = useMemo(() => {
    const total = rows.length;
    const valid = parsedCandidates.length;
    const inTerritory = parsedCandidates.filter(p => classifyCounty(p.city, p.zip)).length;
    return { total, valid, inTerritory, dropped: total - valid };
  }, [rows.length, parsedCandidates]);

  const requiredMissing = !mapping.company;
  const nameMissing = !mapping.name && !(mapping.firstName && mapping.lastName);

  const doImport = () => {
    if (requiredMissing || nameMissing) {
      showToast('Map Company and Name (or First+Last) before importing', 'error');
      return;
    }
    const stats = importCsvRows(parsedCandidates);
    setImportedStats(stats);
    const msg = `Imported ${stats.added}${stats.skippedDup ? ` · ${stats.skippedDup} dup` : ''}${stats.skippedOutOfTerritory ? ` · ${stats.skippedOutOfTerritory} out-of-territory` : ''}`;
    showToast(msg);
  };

  const reset = () => {
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setImportedStats(null);
  };

  return (
    <div style={styles.card}>
      <div style={styles.sectionTitle}><Plus size={14} /> Import CSV</div>
      <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-2)', marginBottom: 'var(--space-4)', lineHeight: 1.6 }}>
        Search in Apollo's web UI (free), export to CSV, drop the file here. The agent classifies each row by ICP and county, drops duplicates, and adds the rest to your pool.
      </div>

      {/* File picker */}
      {!fileName && (
        <label
          style={{
            display: 'block',
            padding: 'var(--space-7) var(--space-5)',
            border: '2px dashed var(--border-strong)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-sunk)',
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <Plus size={28} style={{ color: 'var(--text-3)', marginBottom: 'var(--space-3)' }} />
          <div style={{ fontSize: 'var(--fs-15)', fontWeight: 600, marginBottom: '4px' }}>Choose a CSV file</div>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
            Apollo exports work directly · any CSV with First/Last/Company columns will parse
          </div>
          <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
        </label>
      )}

      {/* Mapping + preview */}
      {fileName && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <div>
              <div style={{ fontSize: 'var(--fs-14)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fileName}</div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
                {previewStats.total} rows · {previewStats.valid} with required fields · {previewStats.inTerritory} in CFL North
              </div>
            </div>
            <button style={styles.secondaryBtn} onClick={reset}>
              <X size={13} /> Clear
            </button>
          </div>

          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
            Column Mapping
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--space-2) var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            {CSV_FIELDS.map(f => (
              <React.Fragment key={f.key}>
                <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text)' }}>
                  {f.label}
                  {!f.optional && <span style={{ color: 'var(--shp-red)', marginLeft: 4 }}>*</span>}
                  {f.notes && <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>{f.notes}</div>}
                </div>
                <select
                  style={styles.input}
                  value={mapping[f.key] || ''}
                  onChange={e => setMapping({ ...mapping, [f.key]: e.target.value || null })}
                >
                  <option value="">— not mapped —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </React.Fragment>
            ))}
          </div>

          {/* Sample preview */}
          {parsedCandidates.length > 0 && (
            <>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
                Preview (first 5)
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 'var(--space-4)' }}>
                {parsedCandidates.slice(0, 5).map((p, i) => {
                  const county = classifyCounty(p.city, p.zip);
                  const icp = classifyICP(p.company, p.title);
                  return (
                    <div key={i} style={{
                      padding: 'var(--space-3) var(--space-4)',
                      borderBottom: i < 4 ? '1px solid var(--border-subtle)' : 'none',
                      fontSize: 'var(--fs-13)',
                    }}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ color: 'var(--text-2)' }}>
                        {p.title || '(no title)'} · {p.company}
                      </div>
                      <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
                        {p.city || '?'}{p.zip ? ` ${p.zip}` : ''} · {county ? `${county} County` : 'out-of-territory'} · {icp.segment} · {p.email || 'no email'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Import button */}
          {!importedStats && (
            <button
              style={{ ...styles.primaryBtn, opacity: (requiredMissing || nameMissing || previewStats.valid === 0) ? 0.5 : 1 }}
              disabled={requiredMissing || nameMissing || previewStats.valid === 0}
              onClick={doImport}
            >
              <Plus size={14} /> Import {previewStats.inTerritory} prospect{previewStats.inTerritory === 1 ? '' : 's'} to pool
            </button>
          )}

          {/* Post-import summary */}
          {importedStats && (
            <div style={{ padding: 'var(--space-4)', background: 'var(--ok-soft)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-13)' }}>
              <div style={{ fontWeight: 600, color: 'var(--ok)', marginBottom: '4px' }}>
                <CheckCircle2 size={14} style={{ verticalAlign: 'middle' }} /> Import complete
              </div>
              <div style={{ color: 'var(--text-2)' }}>
                Added <strong>{importedStats.added}</strong> · Skipped <strong>{importedStats.skippedDup}</strong> duplicates · Skipped <strong>{importedStats.skippedOutOfTerritory}</strong> out-of-territory
              </div>
              <button style={{ ...styles.secondaryBtn, marginTop: 'var(--space-3)' }} onClick={reset}>
                Import another CSV
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProspectRow({ styles, prospect, researchData, pdRecords, researchProspect, markCustomer, markDead, markActive, openPursueLater, confirmDelete, enrichProspect, applyEnrichment, dismissEnrichment, isEnriching, proposedEnrichment, multiThreadAccount, selected, onToggleSelect }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const research = researchData[prospect.id];
  const rec = pdRecords[prospect.id];
  const status = prospect.outreachStatus || 'Active';

  // Visual treatment based on outreach status
  const isCustomer = status === 'Customer';
  const isDead = status === 'Dead';
  const isPursueLater = status === 'PursueLater';
  const cardStyle = isDead
    ? { ...styles.prospectCard, opacity: 0.5, borderStyle: 'dashed' }
    : isCustomer
    ? { ...styles.prospectCard, borderColor: 'color-mix(in oklch, var(--ok) 30%, transparent)', background: 'var(--ok-soft)' }
    : isPursueLater
    ? { ...styles.prospectCard, borderColor: 'color-mix(in oklch, var(--info) 30%, transparent)' }
    : prospect.needsEnrichment
    ? { ...styles.prospectCard, borderColor: 'color-mix(in oklch, var(--warn) 30%, transparent)', background: 'var(--warn-soft)' }
    : styles.prospectCard;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
        {onToggleSelect && (
          <div style={{ paddingTop: '2px', flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--shp-red)' }}
            />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>{prospect.name || <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>(no contact name)</span>}</div>
            <span style={styles.badge(segmentBadgeColor(prospect.segment))}>{prospect.segment}</span>
            {isCustomer && (
              <span style={styles.badge('green')} title={prospect.customerMatch ? `Auto-matched to existing customer: ${prospect.customerMatch.name}` : 'Manually marked as customer'}>
                <CheckCircle2 size={10} /> Customer{prospect.customerMatch ? ' (auto)' : ''}
              </span>
            )}
            {isDead && <span style={styles.badge('gray')}>Dead</span>}
            {isPursueLater && <span style={styles.badge('navy')}>Pursue {prospect.revisitDate}</span>}
            {prospect.needsEnrichment && !isDead && (
              <span style={styles.badge('amber')} title={`Needs enrichment: ${(prospect.enrichmentReasons || []).join('; ')}`}>
                <AlertCircle size={10} /> Needs enrichment
              </span>
            )}
            {research && !isCustomer && !isDead && <span style={styles.badge('green')}><CheckCircle2 size={10} /> Fit {research.fitScore}</span>}
            {rec?.leadId && !rec?.dealId && <span style={styles.badge('navy')}>Lead</span>}
            {rec?.dealId && <span style={styles.badge('navy')}>Deal #{rec.dealId}</span>}
            {rec?.sentAt && (() => {
              // touchCount falls back to history length, then to a single-touch
              // (legacy records that pre-date sentHistory[]).
              const tc = rec.touchCount ?? (Array.isArray(rec.sentHistory) ? rec.sentHistory.length : 1);
              return (
                <span style={styles.badge('amber')} title={`Last sent ${new Date(rec.sentAt).toLocaleDateString()}`}>
                  <Send size={10} /> {tc === 1 ? 'Sent' : `Sent ×${tc}`}
                </span>
              );
            })()}
            {prospect.parentProspectId && <span style={styles.badge('navy')} title={`Multi-thread peer · added from ${prospect.source || 'a parent prospect'}`}><UserPlus size={10} /> peer</span>}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }}>
            {prospect.title || <span style={{ fontStyle: 'italic' }}>(no title)</span>} · {prospect.company}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <span><MapPin size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {prospect.city || '?'}, {prospect.county || '?'}</span>
            {prospect.email && <span><Mail size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {prospect.email}</span>}
            <span style={{ color: 'var(--text-3)' }}>· source: {prospect.source}</span>
          </div>
          {prospect.needsEnrichment && (prospect.enrichmentReasons || []).length > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--warn)', marginTop: '6px', fontStyle: 'italic' }}>
              ⚠ {prospect.enrichmentReasons.join(' · ')}
            </div>
          )}
          {/* Apollo enrichment proposal — shown when Apollo returned data awaiting user approval */}
          {proposedEnrichment?.[prospect.id]?.matched && (
            <div style={{ marginTop: '12px', padding: '12px 14px', background: 'color-mix(in oklch, var(--info) 30%, transparent)', border: '1px solid rgba(99, 130, 175, 0.3)', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '8px' }}>
                Apollo found a match
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text)', display: 'grid', gap: '4px' }}>
                <div><strong>Name:</strong> {proposedEnrichment[prospect.id].person.name}</div>
                {proposedEnrichment[prospect.id].person.title && <div><strong>Title:</strong> {proposedEnrichment[prospect.id].person.title}</div>}
                {proposedEnrichment[prospect.id].person.email && (
                  <div>
                    <strong>Email:</strong> {proposedEnrichment[prospect.id].person.email}
                    {proposedEnrichment[prospect.id].person.emailStatus && (
                      <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: proposedEnrichment[prospect.id].person.emailStatus === 'verified' ? 'color-mix(in oklch, var(--ok) 30%, transparent)' : 'color-mix(in oklch, var(--warn) 30%, transparent)', color: proposedEnrichment[prospect.id].person.emailStatus === 'verified' ? 'var(--ok)' : 'var(--warn)' }}>
                        {proposedEnrichment[prospect.id].person.emailStatus}
                      </span>
                    )}
                  </div>
                )}
                {proposedEnrichment[prospect.id].person.phone && <div><strong>Phone:</strong> {proposedEnrichment[prospect.id].person.phone}</div>}
                {proposedEnrichment[prospect.id].person.linkedinUrl && (
                  <div><strong>LinkedIn:</strong> <a href={proposedEnrichment[prospect.id].person.linkedinUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>profile</a></div>
                )}
                {proposedEnrichment[prospect.id].person.organizationName && (
                  <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>Apollo says they work at: {proposedEnrichment[prospect.id].person.organizationName}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button style={{ ...styles.primaryBtn, fontSize: '12px', padding: '6px 12px' }} onClick={() => applyEnrichment(prospect.id)}>
                  <CheckCircle2 size={12} /> Apply enrichment
                </button>
                <button style={{ ...styles.secondaryBtn, fontSize: '12px', padding: '6px 12px' }} onClick={() => dismissEnrichment(prospect.id)}>
                  Reject — wrong person
                </button>
              </div>
            </div>
          )}
          {proposedEnrichment?.[prospect.id]?.matched === false && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-3)', fontStyle: 'italic' }}>
              Apollo: no match found · {proposedEnrichment[prospect.id].message}
              <button style={{ marginLeft: '8px', background: 'transparent', border: 'none', color: 'var(--info)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => dismissEnrichment(prospect.id)}>
                dismiss
              </button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', position: 'relative' }}>
          {!isDead && !isCustomer && !prospect.needsEnrichment && (
            <button style={styles.primaryBtn} onClick={() => researchProspect(prospect)}>
              {research ? 'Open' : 'Research'} <ArrowRight size={14} />
            </button>
          )}
          {prospect.needsEnrichment && !isDead && !isCustomer && !proposedEnrichment?.[prospect.id] && (
            <button
              style={styles.primaryBtn}
              onClick={() => enrichProspect(prospect)}
              disabled={isEnriching === prospect.id || !!isEnriching}
              title="Look up verified contact info via Apollo (1 credit if found)"
            >
              {isEnriching === prospect.id ? <><Loader2 size={13} className="spin" /> Enriching…</> : <><Sparkles size={13} /> Enrich</>}
            </button>
          )}
          <button
            style={{ ...styles.secondaryBtn, padding: '8px 10px' }}
            onClick={() => setMenuOpen(o => !o)}
            title="Change status"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
              <div style={styles.statusMenu} data-status-menu="true">
                {multiThreadAccount && prospect.company && !isDead && (
                  <>
                    <button style={styles.statusMenuItem} onClick={() => { multiThreadAccount(prospect); setMenuOpen(false); }}>
                      <UserPlus size={12} color="#93b0d6" /> Find peers at {prospect.company.length > 24 ? prospect.company.slice(0, 22) + '…' : prospect.company}
                    </button>
                    <div style={{ borderTop: '1px solid rgba(232, 236, 243, 0.08)', margin: '4px 0' }} />
                  </>
                )}
                {status !== 'Active' && (
                  <button style={styles.statusMenuItem} onClick={() => { markActive(prospect.id); setMenuOpen(false); }}>
                    <RefreshCw size={12} /> Restore to Active
                  </button>
                )}
                {status !== 'Customer' && (
                  <button style={styles.statusMenuItem} onClick={() => { markCustomer(prospect.id); setMenuOpen(false); }}>
                    <CheckCircle2 size={12} color="#4ade80" /> Mark as Customer
                  </button>
                )}
                {status !== 'PursueLater' && (
                  <button style={styles.statusMenuItem} onClick={() => { openPursueLater(prospect); setMenuOpen(false); }}>
                    <RefreshCw size={12} color="#93b0d6" /> Pursue Later…
                  </button>
                )}
                {status !== 'Dead' && (
                  <button style={styles.statusMenuItem} onClick={() => { markDead(prospect.id); setMenuOpen(false); }}>
                    <X size={12} color="#9ca3af" /> Mark as Dead
                  </button>
                )}
                <div style={{ borderTop: '1px solid rgba(232, 236, 243, 0.08)', margin: '4px 0' }} />
                <button style={{ ...styles.statusMenuItem, color: 'var(--danger)' }} onClick={() => { confirmDelete(prospect); setMenuOpen(false); }}>
                  <X size={12} /> Delete from pool
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function segmentBadgeColor(seg) {
  if (seg === 'K-12 Education') return 'navy';
  if (seg === 'Higher Education') return 'purple';
  if (seg === 'Local Government') return 'amber';
  if (seg === 'Unclassified') return 'gray';
  return 'red';
}

// =================================================================
// === CLUSTERS VIEW ===
// =================================================================
function ClustersView({ styles, clusters, researchProspect, researchData, pdRecords, markCustomer, markDead, markActive, openPursueLater, confirmDelete, enrichProspect, applyEnrichment, dismissEnrichment, isEnriching, proposedEnrichment, multiThreadAccount }) {
  const [expanded, setExpanded] = useState({});

  return (
    <>
      <div className="shp-page-title" style={styles.pageTitle}>Clusters</div>
      <div style={styles.pageSubtitle}>Geographic pockets of in-ICP prospects ranked by trip score (size + reachable contacts).</div>

      {clusters.length === 0 ? (
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>
            <Compass size={32} style={{ marginBottom: '12px' }} />
            <div style={{ fontSize: '14px' }}>No clusters yet. Add prospects via Find → Apollo or Manual Add.</div>
          </div>
        </div>
      ) : clusters.map(cluster => {
        const isOpen = expanded[cluster.county];
        return (
          <div key={cluster.county} style={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setExpanded(e => ({ ...e, [cluster.county]: !e[cluster.county] }))}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '18px', fontWeight: 700 }}>{cluster.county} County</div>
                  <span style={styles.badge('amber')}>Trip Score: {cluster.tripScore}</span>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-2)', marginTop: '4px' }}>
                  {cluster.size} prospects · {cluster.withEmail} reachable by email · {Object.entries(cluster.bySegment).map(([s, n]) => `${n} ${s}`).join(' · ')}
                </div>
              </div>
              {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </div>
            {isOpen && (
              <div style={{ marginTop: '16px', borderTop: '1px solid rgba(232, 236, 243, 0.08)', paddingTop: '16px' }}>
                {cluster.prospects.slice(0, 20).map(p => (
                  <ProspectRow key={p.id} styles={styles} prospect={p} researchData={researchData} pdRecords={pdRecords} researchProspect={researchProspect} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} enrichProspect={enrichProspect} applyEnrichment={applyEnrichment} dismissEnrichment={dismissEnrichment} isEnriching={isEnriching} proposedEnrichment={proposedEnrichment} multiThreadAccount={multiThreadAccount} />
                ))}
                {cluster.prospects.length > 20 && (
                  <div style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: 'var(--text-3)', fontStyle: 'italic' }}>
                    +{cluster.prospects.length - 20} more in this cluster
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// =================================================================
// === RESEARCH VIEW ===
// =================================================================
function ResearchView({ styles, prospect, research, isResearching, setView, draftOutreach }) {
  const [diagOpen, setDiagOpen] = useState(false);
  const diag = research?._diagnostic;
  const specificity = research?.specificityRating || 'unknown';
  const specColor = specificity === 'high' ? 'var(--ok)' : specificity === 'medium' ? 'var(--warn)' : 'var(--danger)';

  return (
    <>
      <button style={{ ...styles.secondaryBtn, marginBottom: '16px' }} onClick={() => setView('find')}>← Back</button>
      <div className="shp-page-title" style={styles.pageTitle}>{prospect.name || 'Unnamed contact'}</div>
      <div style={styles.pageSubtitle}>{prospect.title} · {prospect.company} · {prospect.city}, {prospect.county}</div>

      {isResearching ? (
        <div style={{ ...styles.card, textAlign: 'center', padding: '60px' }}>
          <Loader2 size={32} className="spin" style={{ color: 'var(--danger)', marginBottom: '16px' }} />
          <div style={{ fontSize: '15px', fontWeight: 500 }}>Researching {prospect.company}…</div>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '8px' }}>Running multiple web searches…</div>
        </div>
      ) : research && (
        <>
          {/* Diagnostic banner — shows whether real research happened */}
          {diag && (
            <div style={{ ...styles.card, marginBottom: '12px', padding: '14px 18px',
              background: diag.webSearchInvoked && diag.sourceCount > 0 ? 'var(--ok-soft)'
                : diag.webSearchInvoked ? 'var(--warn-soft)'
                : 'var(--danger-soft)',
              borderColor: diag.webSearchInvoked && diag.sourceCount > 0 ? 'color-mix(in oklch, var(--ok) 30%, transparent)'
                : diag.webSearchInvoked ? 'color-mix(in oklch, var(--warn) 30%, transparent)'
                : 'color-mix(in oklch, var(--danger) 30%, transparent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setDiagOpen(!diagOpen)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {diag.webSearchInvoked && diag.sourceCount > 0 ? (
                    <CheckCircle2 size={16} color="#4ade80" />
                  ) : diag.webSearchInvoked ? (
                    <AlertCircle size={16} color="#fbbf24" />
                  ) : (
                    <AlertCircle size={16} color="#ff6b85" />
                  )}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>
                      {diag.webSearchInvoked && diag.sourceCount > 0
                        ? `Live research · ${diag.webSearchCount} searches, ${diag.sourceCount} sources`
                        : diag.webSearchInvoked
                        ? `Searches ran · ${diag.webSearchCount}, but no sources cited`
                        : diag.errorMessage
                        ? `Research failed · ${diag.errorMessage}`
                        : `No web search invoked · Claude answered from training data`}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>
                      Specificity: <span style={{ color: specColor, fontWeight: 600 }}>{specificity}</span>
                      {research.specificityNote ? ` · ${research.specificityNote}` : ''}
                    </div>
                  </div>
                </div>
                <button style={{ ...styles.secondaryBtn, padding: '5px 10px', fontSize: '11px' }}>
                  {diagOpen ? 'Hide' : 'Show'} details
                </button>
              </div>
              {diagOpen && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(232, 236, 243, 0.08)', fontSize: '12px', color: 'var(--text-2)' }}>
                  <div style={{ marginBottom: '8px' }}><strong>Searches performed ({diag.webSearchCount}):</strong></div>
                  {diag.webSearchQueries.length > 0 ? (
                    <ul style={{ margin: '0 0 12px 18px', padding: 0 }}>
                      {diag.webSearchQueries.map((q, i) => (
                        <li key={i} style={{ marginBottom: '3px', fontFamily: 'monospace', fontSize: '11px' }}>"{q}"</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ marginBottom: '12px', fontStyle: 'italic' }}>No searches were performed.</div>
                  )}
                  <div style={{ marginBottom: '8px' }}><strong>Sources cited ({diag.sourceCount}):</strong></div>
                  {diag.sources.length > 0 ? (
                    <ul style={{ margin: '0 0 12px 18px', padding: 0 }}>
                      {diag.sources.map((s, i) => (
                        <li key={i} style={{ marginBottom: '3px' }}>
                          {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>{s.title || s.url}</a> : s.title || '(no title)'}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ marginBottom: '12px', fontStyle: 'italic' }}>No citations returned.</div>
                  )}
                  <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '10px' }}>
                    API call: {diag.apiCallSucceeded ? '✓ succeeded' : '✗ failed'} · Response blocks: {diag.rawResponseBlocks.join(', ') || '(none)'}
                    {diag.errorMessage ? ` · Error: ${diag.errorMessage}` : ''}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div style={styles.sectionTitle}><Sparkles size={14} /> AI Research</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>Fit Score</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: research.fitScore > 75 ? 'var(--ok)' : 'var(--warn)' }}>{research.fitScore}</div>
              </div>
            </div>

            <Section label="Company">{research.companySnapshot}</Section>
            <Section label="Facility Profile">{research.facilityProfile}</Section>

            <div style={{ marginBottom: '20px' }}>
              <SectionLabel>Pain Signals</SectionLabel>
              <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-2)' }}>
                {research.painSignals.map((p, i) => {
                  // Detect [SPECIFIC] / [INFERRED] prefix and render as a tag
                  const tagMatch = (p || '').match(/^\[(SPECIFIC|INFERRED)\]\s*/i);
                  const tag = tagMatch ? tagMatch[1].toUpperCase() : null;
                  const text = tag ? p.slice(tagMatch[0].length) : p;
                  const isSpecific = tag === 'SPECIFIC';
                  return (
                    <li key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 'var(--space-3)', alignItems: 'baseline', padding: 'var(--space-2) 0' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', fontWeight: 600, color: 'var(--text-3)', textAlign: 'right' }}>{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        {tag && (
                          <span style={{
                            display: 'inline-block',
                            fontSize: '10px',
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            padding: '1px 6px',
                            borderRadius: 'var(--r-pill)',
                            marginRight: 'var(--space-2)',
                            background: isSpecific ? 'var(--ok-soft)' : 'var(--bg-sunk)',
                            color: isSpecific ? 'var(--ok)' : 'var(--text-3)',
                          }}>{tag}</span>
                        )}
                        <span style={{ fontSize: 'var(--fs-14)', lineHeight: 1.55, color: 'var(--text)' }}>{text}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <Section label="Why This Fits SHP">{research.fitReasoning}</Section>

            <div style={{ padding: '16px', background: 'var(--ok-soft)', border: '1px solid rgba(34, 197, 94, 0.15)', borderRadius: '10px' }}>
              <div style={{ fontSize: '11px', color: 'var(--ok)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 600 }}>Suggested Opening</div>
              <div style={{ fontSize: '14px', lineHeight: '1.6' }}>"{research.openingHook}"</div>
            </div>
          </div>
          <button style={styles.primaryBtn} onClick={draftOutreach}>
            <Edit3 size={16} /> Draft Cold Email
          </button>
        </>
      )}
    </>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ fontSize: '14px', lineHeight: '1.6' }}>{children}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 500 }}>{children}</div>;
}

// =================================================================
// === COMPOSE VIEW ===
// =================================================================
function ComposeView({ styles, prospect, setProspect, draftEmail, setDraftEmail, isDrafting, draftOutreach, draftDiagnostic, pushToPipedrive, sendViaPipedrive, isSendingPD, sendViaOutlook, openInPipedrive, pdRecords, pdConnected, isPushing, config, setView, followUpDays }) {
  const isAiDraft = draftDiagnostic?.composer === 'ai' && !draftDiagnostic?.fallback;
  return (
    <>
      <button style={{ ...styles.secondaryBtn, marginBottom: '16px' }} onClick={() => setView('research')}>← Back</button>
      <div className="shp-page-title" style={styles.pageTitle}>Review & Send</div>
      <div style={styles.pageSubtitle}>To: {prospect.email || <span style={{ color: 'var(--warn)' }}>no email — add manually</span>}</div>

      {!isDrafting && draftDiagnostic && (
        <div style={{ ...styles.card, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px',
          background: isAiDraft ? 'var(--ok-soft)' : 'var(--warn-soft)',
          borderColor: isAiDraft ? 'color-mix(in oklch, var(--ok) 30%, transparent)' : 'color-mix(in oklch, var(--warn) 30%, transparent)' }}>
          {isAiDraft
            ? <CheckCircle2 size={16} color="#4ade80" />
            : <AlertCircle size={16} color="#fbbf24" />}
          <div style={{ fontSize: '13px' }}>
            {isAiDraft
              ? <>Drafted by Claude in Anthony's voice · short direct opener, research used as background only</>
              : <>Fallback composer used {draftDiagnostic.fallbackReason ? `· ${draftDiagnostic.fallbackReason}` : ''} — review carefully and regenerate if needed</>}
          </div>
        </div>
      )}

      {isDrafting ? (
        <div style={{ ...styles.card, textAlign: 'center', padding: '60px' }}>
          <Loader2 size={32} className="spin" style={{ color: 'var(--danger)', marginBottom: '16px' }} />
          <div style={{ fontSize: '15px', fontWeight: 500 }}>Writing personalized email in Anthony's voice…</div>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '6px' }}>Weaving in research findings, voice guide, and proof points.</div>
        </div>
      ) : (
        <>
          <div style={styles.card}>
            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Recipient email</label>
              <input style={styles.input} value={prospect.email || ''} onChange={e => setProspect({ ...prospect, email: e.target.value })} placeholder="email@company.com" />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Subject</label>
              <input style={styles.input} value={draftEmail.subject} onChange={e => setDraftEmail({ ...draftEmail, subject: e.target.value })} />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={styles.label}>Body (review and edit before sending)</label>
              <textarea style={{ ...styles.input, minHeight: '380px', fontFamily: 'inherit', lineHeight: '1.6', resize: 'vertical' }} value={draftEmail.body} onChange={e => setDraftEmail({ ...draftEmail, body: e.target.value })} />
            </div>
            <button style={styles.secondaryBtn} onClick={() => draftOutreach()}>
              <Sparkles size={13} /> Regenerate
            </button>
          </div>

          <div style={styles.card}>
            <div style={styles.sectionTitle}><Briefcase size={14} /> Two-Step Send</div>
            <SendStep styles={styles} num="1" title="Push to Pipedrive (as Lead)" sub={`Creates Person + Org + Lead in Lead Inbox + Day ${followUpDays} resource follow-up activity. Convert to Deal in Pipedrive when site walk is scheduled.`} done={!!pdRecords[prospect.id]?.leadId || !!pdRecords[prospect.id]?.dealId} disabled={!pdConnected} loading={isPushing} onClick={pushToPipedrive} btnLabel={pdRecords[prospect.id]?.leadId ? 'View Lead' : pdRecords[prospect.id]?.dealId ? 'View Deal' : 'Push to PD'} icon={Briefcase} />
            <SendStep styles={styles} num="2" title="Send via Pipedrive" sub="Routes through Pipedrive's connected email — open tracking records when they read it. Requires Step 1 first." done={!!pdRecords[prospect.id]?.sentAt} disabled={!prospect.email || (!pdRecords[prospect.id]?.leadId && !pdRecords[prospect.id]?.dealId)} loading={isSendingPD} onClick={sendViaPipedrive} btnLabel="Send" icon={Send} />

            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(232, 236, 243, 0.06)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Fallback options</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button style={{ ...styles.secondaryBtn, fontSize: '12px' }} onClick={sendViaOutlook} disabled={!prospect.email}>
                  <Send size={12} /> Open in Outlook
                </button>
                {(pdRecords[prospect.id]?.leadId || pdRecords[prospect.id]?.dealId) && (
                  <button style={{ ...styles.secondaryBtn, fontSize: '12px' }} onClick={openInPipedrive}>
                    <ExternalLink size={12} /> Open {pdRecords[prospect.id]?.leadId ? 'lead' : 'deal'} in Pipedrive
                  </button>
                )}
              </div>
            </div>

            <div style={{ marginTop: '14px', padding: '10px 12px', background: 'var(--ok-soft)', borderRadius: '8px', fontSize: '12px', color: 'var(--ok)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Open tracking is on.</strong> Pipedrive logs the send and records opens in the lead timeline. Enable in Pipedrive → Settings → Email Sync if not already active.
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function SendStep({ styles, num, title, sub, done, disabled, loading, onClick, btnLabel, icon: Icon }) {
  return (
    <div style={{ display: 'flex', gap: '14px', marginBottom: '14px', alignItems: 'center' }}>
      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: done ? 'var(--ok)' : 'var(--border-strong)', color: done ? 'var(--shp-red-on)' : 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>{num}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>{sub}</div>
      </div>
      <button style={done ? styles.secondaryBtn : styles.primaryBtn} onClick={onClick} disabled={disabled || loading}>
        {loading ? <Loader2 size={14} className="spin" /> : <Icon size={14} />}
        {loading ? 'Working…' : btnLabel}
      </button>
    </div>
  );
}

// =================================================================
// === PIPELINE VIEW ===
// =================================================================
function PipelineView({ styles, pdConnected, pdMeta, stageDeals, syncPipeline, isSyncing, setView }) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="shp-page-title" style={styles.pageTitle}>Pipeline</div>
          <div style={styles.pageSubtitle}>{pdConnected ? `Live from ${pdMeta.defaultPipelineName}` : 'Connect Pipedrive to see live deals'}</div>
        </div>
        {pdConnected && (
          <button style={styles.secondaryBtn} onClick={syncPipeline} disabled={isSyncing}>
            {isSyncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        )}
      </div>

      {!pdConnected ? (
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Briefcase size={32} style={{ color: 'var(--text-3)', marginBottom: '12px' }} />
            <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '6px' }}>Pipedrive not connected</div>
            <button style={styles.primaryBtn} onClick={() => setView('settings')}><Key size={14} /> Settings</button>
          </div>
        </div>
      ) : (
        <div className="shp-pipeline-grid" style={styles.pipelineGrid}>
          {pdMeta.stages.map(stage => (
            <div key={stage.id} style={styles.pipelineCol}>
              <div style={styles.pipelineHeader}>
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }} title={stage.name}>{stage.name}</span>
                <span style={{ background: 'var(--border)', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', flexShrink: 0 }}>{(stageDeals[stage.id] || []).length}</span>
              </div>
              {(stageDeals[stage.id] || []).map(deal => (
                <div key={deal.id} style={styles.pipelineCard}>
                  <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '3px' }}>{deal.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '6px' }}>{deal.org_name || ''}{deal.person_name ? ` · ${deal.person_name}` : ''}</div>
                  <a href={`https://app.pipedrive.com/deal/${deal.id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '10px', color: 'var(--info)', display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}>
                    <ExternalLink size={9} /> Open in PD
                  </a>
                </div>
              ))}
              {(stageDeals[stage.id] || []).length === 0 && (
                <div style={{ fontSize: '11px', color: 'var(--text-3)', textAlign: 'center', padding: '20px 8px', fontStyle: 'italic' }}>No deals</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// =================================================================
// === SANDLER COACH VIEW ===
// =================================================================
function CoachView({ styles, coachTab, setCoachTab, coachSelectedSegment, setCoachSelectedSegment, copyToClipboard }) {
  return (
    <>
      <div className="shp-page-title" style={styles.pageTitle}>Sandler Coach</div>
      <div style={styles.pageSubtitle}>Pain Funnel prep · Up-Front Contracts · Reversing helpers — for warm conversations after the cold touch</div>

      <div style={{ ...styles.nav, marginBottom: '20px', display: 'inline-flex' }}>
        {[
          { id: 'painFunnel', label: 'Pain Funnel', icon: Target },
          { id: 'ufc', label: 'Up-Front Contracts', icon: MessageCircle },
          { id: 'reversing', label: 'Reversing', icon: RefreshCw },
        ].map(t => (
          <button key={t.id} style={styles.navBtn(coachTab === t.id)} onClick={() => setCoachTab(t.id)}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {coachTab === 'painFunnel' && (
        <>
          <div style={{ ...styles.card, padding: '16px' }}>
            <label style={styles.label}>Tune Pain Funnel for segment:</label>
            <select style={{ ...styles.input, maxWidth: '320px' }} value={coachSelectedSegment} onChange={e => setCoachSelectedSegment(e.target.value)}>
              <option value="K-12 Education">K-12 Education</option>
              <option value="Higher Education">Higher Education</option>
              <option value="Local Government">Local Government</option>
            </select>
          </div>

          {Object.entries(PAIN_FUNNEL_TEMPLATES).map(([level, t]) => (
            <div key={level} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: level === 'level1' ? 'var(--ok)' : level === 'level2' ? 'var(--warn)' : 'var(--danger)' }}>{t.title}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }}>{t.purpose}</div>
                </div>
                <button style={{ ...styles.secondaryBtn, padding: '6px 12px', fontSize: '12px' }} onClick={() => copyToClipboard(t.questions.join('\n'))}>
                  <Copy size={11} /> Copy
                </button>
              </div>
              {t.questions.map((q, i) => (
                <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-sunk)', borderRadius: '6px', marginBottom: '6px', fontSize: '13px', lineHeight: '1.5' }}>
                  {q}
                </div>
              ))}
            </div>
          ))}

          <div style={{ ...styles.card, background: 'var(--info-soft)', borderColor: 'color-mix(in oklch, var(--info) 30%, transparent)' }}>
            <div style={{ fontSize: '13px', color: 'var(--info)', display: 'flex', gap: '10px' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>Reminder</div>
                The Pain Funnel is for live conversations — discovery calls, site walks, post-reply emails. The cold email itself stays resource-framed (no funnel questions on the first touch).
              </div>
            </div>
          </div>
        </>
      )}

      {coachTab === 'ufc' && (
        <>
          {Object.entries(UFC_TEMPLATES).map(([key, template]) => (
            <div key={key} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ fontSize: '15px', fontWeight: 700 }}>
                  {key === 'preCall' && 'Pre-Call UFC'}
                  {key === 'preSiteWalk' && 'Pre-Site-Walk UFC'}
                  {key === 'preProposalReview' && 'Pre-Proposal-Review UFC'}
                </div>
                <button style={{ ...styles.secondaryBtn, padding: '6px 12px', fontSize: '12px' }} onClick={() => copyToClipboard(template)}>
                  <Copy size={11} /> Copy
                </button>
              </div>
              <pre style={{ background: 'var(--bg-sunk)', padding: '14px', borderRadius: '8px', fontSize: '12px', lineHeight: '1.6', whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
                {template}
              </pre>
            </div>
          ))}
        </>
      )}

      {coachTab === 'reversing' && (
        <>
          <div style={{ ...styles.card, background: 'var(--info-soft)', borderColor: 'color-mix(in oklch, var(--info) 30%, transparent)', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: 'var(--info)' }}>
              When a prospect replies with a vague brush-off, don't accept it at face value. Reverse it back to surface the real signal.
            </div>
          </div>
          {Object.entries(REVERSING_RESPONSES).map(([key, r]) => (
            <div key={key} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--warn)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warn)' }} />
                  When they say
                </div>
                <button style={{ ...styles.secondaryBtn, padding: '6px 12px', fontSize: 'var(--fs-12)' }} onClick={() => copyToClipboard(r.reversal)}>
                  <Copy size={11} /> Copy reversal
                </button>
              </div>
              {/* Quote pattern: large quote glyph + indented italic body. No side stripe. */}
              <blockquote style={{ margin: '0 0 var(--space-5) 0', padding: '0 0 0 var(--space-5)', position: 'relative', fontStyle: 'italic', fontSize: 'var(--fs-16)', lineHeight: 1.5, color: 'var(--text)' }}>
                <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: -4, fontSize: 32, lineHeight: 1, color: 'var(--warn)', fontFamily: 'serif' }}>“</span>
                {r.pattern}
                <span aria-hidden="true" style={{ fontSize: 32, lineHeight: 0, color: 'var(--warn)', fontFamily: 'serif', marginLeft: 2 }}>”</span>
              </blockquote>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--ok)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--space-2)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)' }} />
                You reverse with
              </div>
              <div style={{ fontSize: 'var(--fs-15)', padding: 'var(--space-3) var(--space-4)', background: 'var(--ok-soft)', borderRadius: 'var(--r-md)', marginBottom: 'var(--space-3)', lineHeight: 1.6, color: 'var(--text)' }}>
                {r.reversal}
              </div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-2)' }}>
                <strong style={{ color: 'var(--text)' }}>Why it works:</strong> {r.why}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

// =================================================================
// === SETTINGS VIEW ===
// =================================================================
function SettingsView({ styles, config, setConfig, saveConfig, pdConnected, pdConnectError, pdMeta, autoConnect, isConnecting, syncPipeline, isSyncing, apolloQuota, fetchApolloQuota, prospects, overrides, pdRecords, researchData, showToast }) {
  const exportAllData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 'shp-v3',
      config,
      prospects,
      overrides,
      pdRecords,
      researchData,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shp-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Export downloaded');
  };

  return (
    <>
      <div className="shp-page-title" style={styles.pageTitle}>Settings</div>
      <div style={styles.pageSubtitle}>Pipedrive token is set on the server (Vercel env vars). Other settings save to your browser and sync to Vercel KV when configured.</div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Key size={14} /> Pipedrive Connection</div>
        <div style={{ padding: '14px', background: pdConnected ? 'var(--ok-soft)' : 'var(--danger-soft)', border: `1px solid ${pdConnected ? 'color-mix(in oklch, var(--ok) 30%, transparent)' : 'color-mix(in oklch, var(--danger) 30%, transparent)'}`, borderRadius: '10px', fontSize: '13px', marginBottom: '20px' }}>
          {pdConnected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--ok)', fontWeight: 600 }}><CheckCircle2 size={14} /> Connected as {pdMeta.userName} ({pdMeta.userEmail})</div>
              <div style={{ color: 'var(--text-2)', fontSize: '12px' }}>Pipeline: <strong>{pdMeta.defaultPipelineName}</strong></div>
              <div style={{ color: 'var(--text-2)', fontSize: '12px', marginTop: '4px' }}>Stages: {pdMeta.stages.map(s => s.name).join(' → ')}</div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--danger)', fontWeight: 600 }}><AlertCircle size={14} /> Not connected</div>
              <div style={{ color: 'var(--text-2)', fontSize: '12px' }}>Set <code style={{ background: 'var(--bg-sunk)', padding: '2px 6px', borderRadius: '4px' }}>PIPEDRIVE_API_TOKEN</code> in Vercel project settings, then redeploy.</div>
              {pdConnectError && (
                <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '8px', fontFamily: 'monospace' }}>
                  Last error: {pdConnectError}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button style={styles.secondaryBtn} onClick={autoConnect} disabled={isConnecting}>
            {isConnecting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {isConnecting ? 'Connecting…' : 'Test Connection'}
          </button>
          {pdConnected && (
            <button style={styles.secondaryBtn} onClick={syncPipeline} disabled={isSyncing}>
              {isSyncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Sync Deals
            </button>
          )}
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Mail size={14} /> Sender Identity</div>
        <div className="shp-grid2" style={styles.grid2}>
          <div>
            <label style={styles.label}>Name</label>
            <input style={styles.input} value={config.fromName} onChange={e => setConfig({ ...config, fromName: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Title</label>
            <input style={styles.input} value={config.fromTitle || ''} onChange={e => setConfig({ ...config, fromTitle: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Direct phone</label>
            <input style={styles.input} value={config.fromDirectPhone || ''} onChange={e => setConfig({ ...config, fromDirectPhone: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Office phone</label>
            <input style={styles.input} value={config.fromOfficePhone || ''} onChange={e => setConfig({ ...config, fromOfficePhone: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>From email</label>
            <input style={styles.input} value={config.fromEmail} onChange={e => setConfig({ ...config, fromEmail: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Contact card URL (dot.cards)</label>
            <input style={styles.input} value={config.contactCardUrl || ''} onChange={e => setConfig({ ...config, contactCardUrl: e.target.value })} />
          </div>
        </div>
        <div style={{ marginTop: '16px' }}>
          <label style={styles.label}>Email signature (used at the bottom of every cold draft)</label>
          <textarea style={{ ...styles.input, minHeight: '180px', fontFamily: 'inherit', lineHeight: '1.5', resize: 'vertical' }} value={config.signature || ''} onChange={e => setConfig({ ...config, signature: e.target.value })} />
          <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '6px' }}>This exact text gets pasted at the bottom of every cold email draft. Edit freely.</div>
        </div>
        <button style={{ ...styles.primaryBtn, marginTop: '16px' }} onClick={saveConfig}>
          <CheckCircle2 size={14} /> Save Settings
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><AlertCircle size={14} /> Email Hygiene</div>
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-2)', marginBottom: 'var(--space-4)', lineHeight: 1.6 }}>
          Three guards that protect your domain reputation and keep cold outreach legal under CAN-SPAM. All three apply to every email the agent drafts.
        </div>

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={styles.label}>Company physical address (CAN-SPAM)</label>
          <input
            style={styles.input}
            value={config.companyAddress || ''}
            onChange={e => setConfig({ ...config, companyAddress: e.target.value })}
            placeholder="Superior Hardware Products · 123 Main St, Longwood, FL 32750"
          />
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: '6px' }}>
            Required by US 15 USC §7704: every commercial email must include a valid physical postal address. Auto-appended to your signature if it isn't already there.
          </div>
        </div>

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={styles.label}>Soft opt-out line (deliverability)</label>
          <textarea
            style={{ ...styles.input, minHeight: '60px', fontFamily: 'inherit', lineHeight: '1.5', resize: 'vertical' }}
            value={config.softOptOut || ''}
            onChange={e => setConfig({ ...config, softOptOut: e.target.value })}
          />
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: '6px' }}>
            Always included in every cold draft (AI and fallback composer). Gives recipients a friction-free way to decline so they don't mark you as spam.
          </div>
        </div>

        <div>
          <label style={styles.label}>Touch cap before warning</label>
          <select
            style={{ ...styles.input, maxWidth: '160px' }}
            value={config.maxTouches ?? DEFAULT_MAX_TOUCHES}
            onChange={e => setConfig({ ...config, maxTouches: parseInt(e.target.value, 10) })}
          >
            {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n} emails</option>)}
          </select>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: '6px' }}>
            After this many sends without a reply, the agent warns before letting you send again. Protects against spam complaints from over-emailing the same prospect.
          </div>
        </div>

        <button style={{ ...styles.primaryBtn, marginTop: 'var(--space-4)' }} onClick={saveConfig}>
          <CheckCircle2 size={14} /> Save Hygiene Settings
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Send size={14} /> Send Configuration</div>
        <div style={{ padding: '14px', background: 'var(--ok-soft)', border: '1px solid rgba(34, 197, 94, 0.15)', borderRadius: '10px', fontSize: '13px', marginBottom: '16px', color: 'var(--text-2)', lineHeight: '1.6' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', color: 'var(--ok)', fontWeight: 600 }}>
            <CheckCircle2 size={14} /> Microsoft 365 ↔ Pipedrive sync
          </div>
          When you click <strong>Open in Outlook</strong> on a draft, the email pre-fills in Outlook web. After you click Send in Outlook, your M365 ↔ Pipedrive sync auto-logs the email to the deal timeline. <strong>No Smart BCC required.</strong>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={styles.label}>Day-14 follow-up time (your local time)</label>
          <select
            style={styles.input}
            value={config.followUpHour ?? 9}
            onChange={e => setConfig({ ...config, followUpHour: parseInt(e.target.value, 10) })}
          >
            {[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(h => (
              <option key={h} value={h}>
                {h === 12 ? '12:00 PM (noon)' : h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`}
              </option>
            ))}
          </select>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '6px' }}>
            What time the Day-14 resource follow-up activity should fire in your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
            Pipedrive stores activity times in UTC; the agent converts your local hour automatically.
          </div>
        </div>
        <div>
          <label style={styles.label}>Smart BCC (optional — only if you want belt-and-suspenders logging)</label>
          <input style={{ ...styles.input, fontFamily: 'monospace' }} placeholder="leave blank if M365 sync handles logging — or paste your Pipedrive Smart BCC address" value={config.smartBcc || ''} onChange={e => setConfig({ ...config, smartBcc: e.target.value })} />
          <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '6px' }}>Find this in Pipedrive → Settings → Tools → BCC. Most users with M365 sync don't need it.</div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Sparkles size={14} /> Apollo Credits</div>
        {/* Quota display — works against effectiveQuota which always renders
            something even when Apollo's API doesn't expose usage data (the
            free-tier auth/health endpoint returns nulls). When `source` is
            'local', we're counting credits ourselves from successful enriches. */}
        <div style={{ padding: 'var(--space-4)', background: 'var(--bg-sunk)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-13)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              {apolloQuota?.remaining ?? '—'} of {apolloQuota?.total ?? '—'} remaining
              {apolloQuota?.plan && <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: '8px' }}>({apolloQuota.plan})</span>}
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-2)' }}>
              {apolloQuota?.source === 'local'
                ? 'Counted locally — Apollo\'s free-tier API doesn\'t expose usage. Update the cap below if you upgraded.'
                : '1 credit per Apollo person-match. Free tier = 50/mo.'}
            </div>
          </div>
          <button style={styles.secondaryBtn} onClick={fetchApolloQuota}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        <div>
          <label style={styles.label}>Monthly credit cap (used for the local fallback when server data is unavailable)</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input
              type="number"
              min="0"
              step="50"
              style={{ ...styles.input, maxWidth: '160px' }}
              value={config.apolloMonthlyCredits ?? 50}
              onChange={e => setConfig({ ...config, apolloMonthlyCredits: parseInt(e.target.value, 10) || 0 })}
            />
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
              credits / month
            </span>
          </div>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: '6px' }}>
            Free tier = 50. Set this to whatever your Apollo plan provides so the dashboard "credits remaining" stays accurate.
          </div>
          <button style={{ ...styles.primaryBtn, marginTop: 'var(--space-3)', fontSize: 'var(--fs-13)' }} onClick={saveConfig}>
            <CheckCircle2 size={13} /> Save cap
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Download size={14} /> Data Export</div>
        <div style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '14px', lineHeight: 1.6 }}>
          Download a JSON snapshot of your config, prospect overrides, Pipedrive record IDs, and cached research. Useful for backups or migrating to a new browser.
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '14px' }}>
          Includes: {prospects.length} prospects · {Object.keys(overrides).length} status overrides · {Object.keys(pdRecords).length} Pipedrive links · {Object.keys(researchData).length} cached research entries
        </div>
        <button style={styles.primaryBtn} onClick={exportAllData}>
          <Download size={14} /> Export all data (JSON)
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><AlertCircle size={14} /> How it works</div>
        <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.7' }}>
          <div style={{ marginBottom: '10px' }}><strong>1. Find:</strong> Browse your seed pool (602 prospects), search Apollo for new ones, or add manually.</div>
          <div style={{ marginBottom: '10px' }}><strong>2. Research:</strong> Claude pulls company snapshot, facility profile, segment-specific pain signals, and an opening hook.</div>
          <div style={{ marginBottom: '10px' }}><strong>3. Draft:</strong> Anthony's voice — humble, peer-tone, "arrow in the quiver" framing — with contextually-relevant SHP customer references when they fit.</div>
          <div style={{ marginBottom: '10px' }}><strong>4. Review:</strong> Edit the draft in the agent. Regenerate if it's off.</div>
          <div style={{ marginBottom: '10px' }}><strong>5. Push to Pipedrive (as Lead):</strong> Creates Person + Org + Lead in the Lead Inbox + Day 14 follow-up. Cold prospects stay as Leads — they don't pollute your pipeline. Convert to Deal in Pipedrive when a site walk is scheduled.</div>
          <div style={{ marginBottom: '10px' }}><strong>6. Open in Outlook:</strong> Pre-fills Outlook compose. Click Send. M365↔Pipedrive sync logs it automatically.</div>
          <div><strong>7. After they reply:</strong> Sandler Coach view — Pain Funnel prep, UFC scripts, Reversing helpers.</div>
        </div>
      </div>
    </>
  );
}

// =================================================================
// === TOAST + GLOBAL STYLES ===
// =================================================================
// =================================================================
// === FIND PEERS MODAL (multi-thread accounts) ===
// =================================================================
function FindPeersModal({ styles, parent, isLoading, results, onAdd, onCancel }) {
  const [picked, setPicked] = useState({});

  const togglePick = (apolloId) => {
    setPicked(prev => ({ ...prev, [apolloId]: !prev[apolloId] }));
  };

  const candidates = results || [];
  const newOnes = candidates.filter(c => !c.alreadyInPool);
  const pickedCount = newOnes.filter(c => picked[c.apolloId]).length;

  const tierColor = (t) => t >= 4 ? 'var(--ok)' : t === 3 ? 'var(--warn)' : t === 2 ? 'var(--info)' : 'var(--text-3)';
  const tierLabel = (t) => t === 4 ? 'Strategic' : t === 3 ? 'Mgmt' : t === 2 ? 'Tactical' : t === 1 ? 'Frontline' : 'Adjacent';

  const handleAdd = () => {
    const chosen = newOnes.filter(c => picked[c.apolloId]);
    onAdd(chosen);
  };

  return (
    <div className="shp-modal-overlay" style={styles.modalOverlay} onClick={onCancel}>
      <div style={{ ...styles.modalCard, maxWidth: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>Find peers at {parent.company}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>
            Multi-threading from <strong>{parent.name || '(unnamed)'}</strong> ({parent.title || 'unknown title'}). Search is free — adding to the pool is free. Verified emails cost 1 Apollo credit each, applied later when you enrich.
          </div>
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Loader2 size={28} className="spin" style={{ color: 'var(--danger)' }} />
            <div style={{ fontSize: '14px', marginTop: '12px' }}>Searching Apollo for peers…</div>
          </div>
        ) : candidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-3)' }}>
            <AlertCircle size={20} style={{ marginBottom: '8px' }} />
            <div style={{ fontSize: '13px' }}>No peers found at this org. Apollo may not index them — try Manual Add.</div>
          </div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1, marginTop: '12px', borderTop: '1px solid rgba(232, 236, 243, 0.08)' }}>
            {candidates.map(c => {
              const tier = classifyTier(c.title);
              const checked = !!picked[c.apolloId];
              return (
                <label
                  key={c.apolloId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 0', borderBottom: '1px solid rgba(232, 236, 243, 0.04)',
                    opacity: c.alreadyInPool ? 0.5 : 1,
                    cursor: c.alreadyInPool ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={c.alreadyInPool}
                    checked={checked}
                    onChange={() => togglePick(c.apolloId)}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--danger)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px' }}>{c.name}</strong>
                      {tier > 0 && (
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-sunk)', color: tierColor(tier), fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {tierLabel(tier)}
                        </span>
                      )}
                      {c.alreadyInPool && <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>· already in pool</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>{c.title || '(no title)'}</div>
                    {c.linkedinUrl && (
                      <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '11px', color: 'var(--info)' }}>
                        LinkedIn ↗
                      </a>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
            {newOnes.length > 0 && (
              <>{pickedCount} of {newOnes.length} selected · 0 credits cost (enrich separately later)</>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
            <button style={styles.primaryBtn} onClick={handleAdd} disabled={pickedCount === 0}>
              <Plus size={14} /> Add {pickedCount > 0 ? `${pickedCount} ` : ''}to pool
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =================================================================
// === BULK CROSS-THREAD MODAL ===
// =================================================================
// Two-state modal:
//   1. Running: progress bar showing "Searching X of Y orgs · {currentOrg}"
//      with a Cancel button.
// =================================================================
// === BATCH DRAFT MODAL ==========================================
// =================================================================
// Two phases:
//   1. Running: progress bar + current prospect name + cancel button
//   2. Review: list of all drafted emails — edit subject/body inline,
//      open each in Outlook, or open all at once. Fallback drafts
//      are flagged so Anthony knows which ones to double-check.
function BatchDraftModal({ styles, isRunning, progress, queue, prospects, config, pdRecords, onSendViaPipedrive, onCancel, onClose }) {
  const [expandedId, setExpandedId] = useState(null);
  // Local edits to subject/body — keyed by prospect id
  const [localEdits, setLocalEdits] = useState({});
  // Track which ids are currently being sent via PD (per-row loading state)
  const [sendingIds, setSendingIds] = useState(new Set());
  // Track which ids have been successfully sent via PD this session
  const [sentIds, setSentIds] = useState(new Set());
  // Toast-like feedback inside the modal
  const [modalToast, setModalToast] = useState(null);

  const entries = Object.entries(queue);
  const readyEntries = entries.filter(([, v]) => v.status === 'ready');
  const errorEntries = entries.filter(([, v]) => v.status === 'error');
  const pendingCount = entries.filter(([, v]) => ['pending', 'researching', 'drafting'].includes(v.status)).length;

  const getProspect = (id) => prospects.find(p => p.id === id);

  const showModalToast = (msg, type = 'ok') => {
    setModalToast({ msg, type });
    setTimeout(() => setModalToast(null), 3500);
  };

  const sendViaPD = async (id) => {
    const prospect = getProspect(id);
    if (!prospect?.email) { showModalToast('No email address', 'error'); return; }
    const item = queue[id];
    const edit = localEdits[id];
    const subject = edit?.subject ?? item?.draft?.subject ?? '';
    const body = edit?.body ?? item?.draft?.body ?? '';

    setSendingIds(prev => new Set([...prev, id]));
    try {
      await onSendViaPipedrive(prospect, subject, body);
      setSentIds(prev => new Set([...prev, id]));
      showModalToast(`Sent to ${prospect.name || prospect.email}`);
    } catch (err) {
      showModalToast(`Failed: ${err.message} — use Outlook fallback`, 'error');
    } finally {
      setSendingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const sendAllViaPD = async () => {
    const eligible = readyEntries.filter(([id]) => getProspect(id)?.email);
    for (const [id] of eligible) {
      await sendViaPD(id);
    }
  };

  const openInOutlook = (id) => {
    const prospect = getProspect(id);
    if (!prospect?.email) return;
    const item = queue[id];
    const edit = localEdits[id];
    const subject = edit?.subject ?? item?.draft?.subject ?? '';
    const body = edit?.body ?? item?.draft?.body ?? '';
    const enc = encodeURIComponent;
    const parts = [`to=${enc(prospect.email)}`, `subject=${enc(subject)}`, `body=${enc(body)}`];
    if (config?.smartBcc) parts.push(`bcc=${enc(config.smartBcc)}`);
    window.open(`https://outlook.office.com/mail/deeplink/compose?${parts.join('&')}`, '_blank', 'noopener,noreferrer');
  };

  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="shp-modal-overlay" style={styles.modalOverlay} onClick={isRunning ? undefined : onClose}>
      <div
        className="shp-modal-card"
        style={{ ...styles.modalCard, maxWidth: '860px', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-22)', fontWeight: 700, marginBottom: '4px' }}>
              {isRunning ? 'Drafting emails…' : 'Batch Draft Queue'}
            </div>
            <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-3)' }}>
              {isRunning
                ? `${progress.done} of ${progress.total} complete`
                : `${readyEntries.length} ready · ${errorEntries.length} failed · ${pendingCount} pending`}
            </div>
          </div>
          {!isRunning && (
            <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px' }} onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </div>

        {/* Progress bar (shown while running) */}
        {isRunning && (
          <div style={{ padding: 'var(--space-4)', background: 'var(--bg-sunk)', borderRadius: 'var(--r-md)', marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>
                {progress.currentName || 'Starting…'}
              </span>
              <button
                style={{ ...styles.secondaryBtn, padding: '5px 12px', fontSize: 'var(--fs-12)' }}
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progressPct}%`,
                background: 'var(--shp-red)',
                transition: 'width 0.3s var(--ease)',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
              <span>{progressPct}%</span>
              <span>{progress.done} / {progress.total}</span>
            </div>
          </div>
        )}

        {/* Live status list while running (compact) */}
        {isRunning && entries.length > 0 && (
          <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
            {entries.map(([id, item]) => {
              const p = getProspect(id);
              const statusIcon = item.status === 'ready' ? '✓' : item.status === 'error' ? '✗' : item.status === 'drafting' ? '✍' : item.status === 'researching' ? '🔍' : '·';
              const statusColor = item.status === 'ready' ? 'var(--ok)' : item.status === 'error' ? 'var(--err)' : 'var(--text-3)';
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: statusColor, width: 16, textAlign: 'center', fontSize: 'var(--fs-13)' }}>{statusIcon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-13)', fontWeight: 500 }}>{p?.name || id}</div>
                    <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>{p?.company}</div>
                  </div>
                  <span style={{ fontSize: 'var(--fs-12)', color: statusColor, textTransform: 'capitalize' }}>{item.status}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Review phase — shown when not running */}
        {!isRunning && entries.length > 0 && (
          <>
            {/* Modal-level toast feedback */}
            {modalToast && (
              <div style={{
                padding: '8px 14px',
                marginBottom: 'var(--space-3)',
                borderRadius: 'var(--r-md)',
                fontSize: 'var(--fs-12)',
                background: modalToast.type === 'error' ? 'var(--danger-soft)' : 'var(--ok-soft)',
                color: modalToast.type === 'error' ? 'var(--danger)' : 'var(--ok)',
              }}>
                {modalToast.msg}
              </div>
            )}
            {readyEntries.length > 0 && (
              <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
                <button
                  style={{ ...styles.primaryBtn }}
                  onClick={sendAllViaPD}
                >
                  <Send size={14} /> Send all via Pipedrive ({readyEntries.filter(([id]) => getProspect(id)?.email).length} with email)
                </button>
              </div>
            )}

            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
              {entries.map(([id, item]) => {
                const p = getProspect(id);
                const isExpanded = expandedId === id;
                const edit = localEdits[id] || {};
                const subject = edit.subject ?? item?.draft?.subject ?? '';
                const body = edit.body ?? item?.draft?.body ?? '';
                const hasEmail = !!p?.email;

                return (
                  <div key={id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {/* Row header */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-3) var(--space-4)',
                        cursor: item.status === 'ready' ? 'pointer' : 'default',
                        background: isExpanded ? 'var(--bg-sunk)' : 'transparent',
                      }}
                      onClick={() => item.status === 'ready' && setExpandedId(isExpanded ? null : id)}
                    >
                      <div style={{ width: 20, textAlign: 'center', flexShrink: 0 }}>
                        {item.status === 'ready' ? (
                          isExpanded ? <ChevronDown size={14} color="var(--text-3)" /> : <ChevronRight size={14} color="var(--text-3)" />
                        ) : item.status === 'error' ? (
                          <AlertCircle size={14} color="var(--err)" />
                        ) : (
                          <Loader2 size={14} color="var(--text-3)" className="spin" />
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>{p?.name || '(no name)'}</span>
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>· {p?.company}</span>
                          {item.fallback && (
                            <span style={{ ...styles.badge('amber'), fontSize: '10px' }}>deterministic</span>
                          )}
                          {!hasEmail && (
                            <span style={{ ...styles.badge('gray'), fontSize: '10px' }}>no email</span>
                          )}
                        </div>
                        {item.status === 'ready' && subject && (
                          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {subject}
                          </div>
                        )}
                        {item.status === 'error' && (
                          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--err)', marginTop: '2px' }}>
                            {item.error || 'Unknown error'}
                          </div>
                        )}
                      </div>

                      {item.status === 'ready' && (
                        <button
                          style={{
                            ...styles.primaryBtn,
                            fontSize: 'var(--fs-12)',
                            padding: '5px 12px',
                            flexShrink: 0,
                            opacity: hasEmail && !sentIds.has(id) ? 1 : 0.4,
                            cursor: hasEmail && !sentIds.has(id) ? 'pointer' : 'not-allowed',
                          }}
                          onClick={(e) => { e.stopPropagation(); hasEmail && !sentIds.has(id) && sendViaPD(id); }}
                          disabled={sendingIds.has(id) || sentIds.has(id)}
                          title={!hasEmail ? 'No email address — enrich this prospect first' : sentIds.has(id) ? 'Already sent' : 'Send via Pipedrive'}
                        >
                          {sendingIds.has(id)
                            ? <><Loader2 size={12} className="spin" /> Sending…</>
                            : sentIds.has(id)
                            ? <><CheckCircle2 size={12} /> Sent</>
                            : <><Send size={12} /> Send</>}
                        </button>
                      )}
                    </div>

                    {/* Expanded draft editor */}
                    {isExpanded && item.status === 'ready' && (
                      <div style={{ padding: 'var(--space-4)', background: 'var(--bg-sunk)', borderTop: '1px solid var(--border-subtle)' }}>
                        <div style={{ marginBottom: 'var(--space-3)' }}>
                          <label style={{ ...styles.label, marginBottom: 'var(--space-2)' }}>Subject</label>
                          <input
                            style={styles.input}
                            value={subject}
                            onChange={e => setLocalEdits(prev => ({ ...prev, [id]: { ...prev[id], subject: e.target.value } }))}
                          />
                        </div>
                        <div>
                          <label style={{ ...styles.label, marginBottom: 'var(--space-2)' }}>Body</label>
                          <textarea
                            style={{ ...styles.input, height: '240px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                            value={body}
                            onChange={e => setLocalEdits(prev => ({ ...prev, [id]: { ...prev[id], body: e.target.value } }))}
                          />
                        </div>
                        {item.fallback && (
                          <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--warn)' }}>
                            Deterministic fallback — AI draft failed. Review before sending.
                          </div>
                        )}
                        <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <span style={{ fontSize: 'var(--fs-11)', color: 'var(--text-3)' }}>Fallback:</span>
                          <button
                            style={{ ...styles.secondaryBtn, fontSize: 'var(--fs-12)', padding: '4px 10px' }}
                            onClick={() => openInOutlook(id)}
                            disabled={!hasEmail}
                          >
                            <Send size={11} /> Open in Outlook
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Footer */}
        {!isRunning && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
            <button style={styles.secondaryBtn} onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

//   2. Complete: aggregated review screen with all candidates from all orgs.
//      User filters / multi-selects / bulk-adds. Apollo searches were free —
//      only enrichment costs credits, which happens later via Batch Enrich.
function BulkCrossThreadModal({ styles, isRunning, progress, results, onAdd, onCancel, onCancelRun }) {
  const [picks, setPicks] = useState(new Set()); // Set of "orgKey::name" identifiers
  const [tierFilter, setTierFilter] = useState('all'); // 'all' | '34' (decision-makers) | '23' (managers)
  const [hideAlreadyInPool, setHideAlreadyInPool] = useState(true);

  // Flatten all candidates with their parent context so the review list is one
  // sortable/selectable surface.
  const allRows = useMemo(() => {
    const rows = [];
    for (const r of results) {
      if (!r.candidates) continue;
      for (const c of r.candidates) {
        rows.push({ result: r, candidate: c, key: `${r.orgKey}::${(c.name || '').toLowerCase()}` });
      }
    }
    // Sort: in-pool LAST, then by candidate score desc, then by tier desc.
    rows.sort((a, b) => {
      if (a.candidate.alreadyInPool !== b.candidate.alreadyInPool) {
        return a.candidate.alreadyInPool ? 1 : -1;
      }
      const sa = a.candidate.candScore ?? 0;
      const sb = b.candidate.candScore ?? 0;
      if (sa !== sb) return sb - sa;
      return (b.candidate.tier ?? 0) - (a.candidate.tier ?? 0);
    });
    return rows;
  }, [results]);

  const filteredRows = useMemo(() => {
    return allRows.filter(row => {
      if (hideAlreadyInPool && row.candidate.alreadyInPool) return false;
      if (tierFilter === '34' && (row.candidate.tier ?? 0) < 3) return false;
      if (tierFilter === '23' && ((row.candidate.tier ?? 0) < 2 || (row.candidate.tier ?? 0) > 3)) return false;
      return true;
    });
  }, [allRows, tierFilter, hideAlreadyInPool]);

  const togglePick = (key) => {
    setPicks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const selectAllVisible = () => {
    setPicks(prev => {
      const next = new Set(prev);
      filteredRows.forEach(row => { if (!row.candidate.alreadyInPool) next.add(row.key); });
      return next;
    });
  };
  const clearSelection = () => setPicks(new Set());
  const selectedCount = picks.size;

  const orgsWithCandidates = results.filter(r => (r.candidates?.length || 0) > 0).length;
  const orgsErrored = results.filter(r => r.error).length;

  const onConfirmAdd = () => {
    const pickedRows = allRows.filter(row => picks.has(row.key));
    const payload = pickedRows.map(({ result, candidate }) => ({ result, candidate }));
    onAdd(payload);
  };

  return (
    <div className="shp-modal-overlay" style={styles.modalOverlay} onClick={isRunning ? undefined : onCancel}>
      <div
        className="shp-modal-card"
        style={{ ...styles.modalCard, maxWidth: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--fs-22)', fontWeight: 700, marginBottom: '4px' }}>
            Cross-thread your pool
          </div>
          <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-3)' }}>
            {isRunning
              ? 'Running free Apollo people-searches — no credits spent yet.'
              : `${orgsWithCandidates} of ${results.length} orgs returned candidates${orgsErrored ? ` · ${orgsErrored} errors` : ''}`}
          </div>
        </div>

        {/* Running state: progress bar + cancel */}
        {isRunning && (
          <div style={{ padding: 'var(--space-5)', background: 'var(--bg-sunk)', borderRadius: 'var(--r-md)', marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <span style={{ fontSize: 'var(--fs-14)', fontWeight: 600 }}>
                Searching {progress.done} of {progress.total} orgs…
              </span>
              <button style={{ ...styles.secondaryBtn, padding: '6px 14px', fontSize: 'var(--fs-12)' }} onClick={onCancelRun}>
                Cancel
              </button>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
                background: 'var(--shp-red)',
                transition: 'width 0.2s var(--ease)',
              }} />
            </div>
            {progress.currentOrg && (
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>
                {progress.currentOrg}
              </div>
            )}
          </div>
        )}

        {/* Complete state: filters + results list */}
        {!isRunning && results.length > 0 && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <select
                style={{ ...styles.input, width: 'auto', minWidth: 160 }}
                value={tierFilter}
                onChange={e => setTierFilter(e.target.value)}
              >
                <option value="all">All tiers</option>
                <option value="34">Decision-makers (Tier 3-4)</option>
                <option value="23">Mid-level (Tier 2-3)</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--fs-13)', color: 'var(--text-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={hideAlreadyInPool} onChange={e => setHideAlreadyInPool(e.target.checked)} />
                Hide already in pool
              </label>
              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-3)', marginLeft: 'auto' }}>
                {filteredRows.length} candidates · {selectedCount} selected
              </span>
              <button style={{ ...styles.secondaryBtn, fontSize: 'var(--fs-12)' }} onClick={selectAllVisible}>
                Select all visible
              </button>
              {selectedCount > 0 && (
                <button style={{ ...styles.secondaryBtn, fontSize: 'var(--fs-12)' }} onClick={clearSelection}>
                  Clear
                </button>
              )}
            </div>

            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
              {filteredRows.length === 0 ? (
                <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-3)' }}>
                  No candidates match this filter.
                </div>
              ) : (
                filteredRows.map(row => {
                  const c = row.candidate;
                  const checked = picks.has(row.key);
                  const tierLabel = c.tier === 4 ? 'Strategic' : c.tier === 3 ? 'Manager' : c.tier === 2 ? 'Tactical' : c.tier === 1 ? 'Frontline' : '—';
                  return (
                    <label
                      key={row.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '24px 1fr auto',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-3)',
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: c.alreadyInPool ? 'not-allowed' : 'pointer',
                        opacity: c.alreadyInPool ? 0.5 : 1,
                        background: checked ? 'var(--shp-red-soft)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={c.alreadyInPool}
                        onChange={() => togglePick(row.key)}
                      />
                      <div>
                        <div style={{ fontSize: 'var(--fs-14)', fontWeight: 600 }}>
                          {c.name}
                          {c.alreadyInPool && <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontWeight: 400 }}>(already in pool)</span>}
                        </div>
                        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-2)' }}>
                          {c.title || '(no title)'} · {row.result.orgName}
                        </div>
                      </div>
                      <span style={styles.badge(
                        c.tier === 4 ? 'red' :
                        c.tier === 3 ? 'amber' :
                        c.tier === 2 ? 'navy' :
                        'gray'
                      )}>
                        {tierLabel}
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-4)', gap: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
                Adding {selectedCount} costs <strong>0 credits</strong> — they enter the pool flagged "Needs Enrichment".
                Enrich them later via the Batch Enrich wizard to spend remaining credits.
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button style={styles.secondaryBtn} onClick={onCancel}>Close</button>
                <button
                  style={{ ...styles.primaryBtn, opacity: selectedCount === 0 ? 0.5 : 1 }}
                  disabled={selectedCount === 0}
                  onClick={onConfirmAdd}
                >
                  <Plus size={14} /> Add {selectedCount} to pool
                </button>
              </div>
            </div>
          </>
        )}

        {/* Empty/post-run with no results */}
        {!isRunning && results.length === 0 && (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-3)' }}>
            No orgs to cross-thread. Add some prospects first.
            <div style={{ marginTop: 'var(--space-4)' }}>
              <button style={styles.secondaryBtn} onClick={onCancel}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =================================================================
// === NEW ACCOUNTS MODAL ===
// =================================================================
// Shows results of the chained org-search → people-search run.
// Phase 1 (orgs) and Phase 2 (people per org) are streamed via progress.
// On completion, the user reviews orgs grouped, picks specific people per
// org, and bulk-adds them to the pool.
function NewAccountsModal({ styles, isRunning, progress, results, onAdd, onCancel, onCancelRun }) {
  const [picks, setPicks] = useState(new Set());
  const [expandedOrgs, setExpandedOrgs] = useState(new Set());
  const [tierFilter, setTierFilter] = useState('all');

  // Auto-expand all orgs on first load when results arrive
  useEffect(() => {
    if (!isRunning && results.length > 0 && expandedOrgs.size === 0) {
      setExpandedOrgs(new Set(results.map((_, i) => i)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, results.length]);

  const filteredResults = useMemo(() => {
    return results.map(r => ({
      ...r,
      candidates: (r.candidates || []).filter(c => {
        if (tierFilter === '34' && (c.tier ?? 0) < 3) return false;
        if (tierFilter === '23' && ((c.tier ?? 0) < 2 || (c.tier ?? 0) > 3)) return false;
        return true;
      }),
    }));
  }, [results, tierFilter]);

  const togglePick = (k) => {
    setPicks(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const toggleOrg = (idx) => {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };
  const selectAllVisible = () => {
    setPicks(prev => {
      const next = new Set(prev);
      filteredResults.forEach((r, i) => {
        r.candidates.forEach(c => next.add(`${i}::${c.name}`));
      });
      return next;
    });
  };

  const onConfirmAdd = () => {
    const payload = [];
    for (let i = 0; i < filteredResults.length; i++) {
      const r = filteredResults[i];
      for (const c of r.candidates) {
        if (picks.has(`${i}::${c.name}`)) {
          payload.push({ org: r.org, candidate: c });
        }
      }
    }
    onAdd(payload);
  };

  const totalCandidates = results.reduce((s, r) => s + (r.candidates?.length || 0), 0);

  return (
    <div className="shp-modal-overlay" style={styles.modalOverlay} onClick={isRunning ? undefined : onCancel}>
      <div
        className="shp-modal-card"
        style={{ ...styles.modalCard, maxWidth: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--fs-22)', fontWeight: 700, marginBottom: '4px' }}>
            Find new in-ICP accounts
          </div>
          <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-3)' }}>
            {isRunning
              ? 'Apollo searching K-12, Higher Ed, Local Gov in CFL North — no credits spent.'
              : `${results.length} net-new orgs · ${totalCandidates} candidates`}
          </div>
        </div>

        {isRunning && (
          <div style={{ padding: 'var(--space-5)', background: 'var(--bg-sunk)', borderRadius: 'var(--r-md)', marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <span style={{ fontSize: 'var(--fs-14)', fontWeight: 600 }}>
                {progress.phase === 'orgs' ? `Searching orgs · ${progress.done}/${progress.total} segments` : `Searching contacts · ${progress.done}/${progress.total} orgs`}
              </span>
              <button style={{ ...styles.secondaryBtn, padding: '6px 14px', fontSize: 'var(--fs-12)' }} onClick={onCancelRun}>
                Cancel
              </button>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
                background: 'var(--shp-red)',
                transition: 'width 0.2s var(--ease)',
              }} />
            </div>
            {progress.currentOrg && (
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>
                {progress.currentOrg}
              </div>
            )}
          </div>
        )}

        {!isRunning && results.length > 0 && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <select
                style={{ ...styles.input, width: 'auto', minWidth: 160 }}
                value={tierFilter}
                onChange={e => setTierFilter(e.target.value)}
              >
                <option value="all">All tiers</option>
                <option value="34">Decision-makers (Tier 3-4)</option>
                <option value="23">Mid-level (Tier 2-3)</option>
              </select>
              <button style={{ ...styles.secondaryBtn, fontSize: 'var(--fs-12)' }} onClick={selectAllVisible}>
                Select all visible
              </button>
              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-3)', marginLeft: 'auto' }}>
                {picks.size} selected
              </span>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
              {filteredResults.map((r, idx) => {
                const isOpen = expandedOrgs.has(idx);
                const candidates = r.candidates;
                return (
                  <div key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => toggleOrg(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        width: '100%',
                        padding: 'var(--space-3)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 'var(--fs-14)', fontWeight: 600, color: 'var(--text)' }}>
                          {r.org.name}
                        </div>
                        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
                          {r.org.segment} · {r.org.county} County · {r.org.city}{r.org.estimatedEmployees ? ` · ${r.org.estimatedEmployees} employees` : ''}
                        </div>
                      </div>
                      <span style={styles.badge('navy')}>{candidates.length} {candidates.length === 1 ? 'contact' : 'contacts'}</span>
                    </button>
                    {isOpen && candidates.length > 0 && (
                      <div style={{ padding: '0 var(--space-3) var(--space-3) var(--space-7)' }}>
                        {candidates.map(c => {
                          const k = `${idx}::${c.name}`;
                          const checked = picks.has(k);
                          const tierLabel = c.tier === 4 ? 'Strategic' : c.tier === 3 ? 'Manager' : c.tier === 2 ? 'Tactical' : c.tier === 1 ? 'Frontline' : '—';
                          return (
                            <label
                              key={k}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '24px 1fr auto',
                                alignItems: 'center',
                                gap: 'var(--space-3)',
                                padding: 'var(--space-2) 0',
                                cursor: 'pointer',
                                background: checked ? 'var(--shp-red-soft)' : 'transparent',
                                borderRadius: 'var(--r-sm)',
                                paddingLeft: 'var(--space-2)',
                              }}
                            >
                              <input type="checkbox" checked={checked} onChange={() => togglePick(k)} />
                              <div>
                                <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>{c.name}</div>
                                <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-2)' }}>{c.title || '(no title)'}</div>
                              </div>
                              <span style={styles.badge(c.tier === 4 ? 'red' : c.tier === 3 ? 'amber' : c.tier === 2 ? 'navy' : 'gray')}>
                                {tierLabel}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {isOpen && candidates.length === 0 && (
                      <div style={{ padding: 'var(--space-3) var(--space-7)', fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontStyle: 'italic' }}>
                        No facilities contacts surfaced. Try the filter "All tiers" or revisit later.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-4)', gap: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
                Adding {picks.size} costs <strong>0 credits</strong> — they enter the pool flagged "Needs Enrichment".
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button style={styles.secondaryBtn} onClick={onCancel}>Close</button>
                <button
                  style={{ ...styles.primaryBtn, opacity: picks.size === 0 ? 0.5 : 1 }}
                  disabled={picks.size === 0}
                  onClick={onConfirmAdd}
                >
                  <Plus size={14} /> Add {picks.size} to pool
                </button>
              </div>
            </div>
          </>
        )}

        {!isRunning && results.length === 0 && (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-3)' }}>
            No net-new in-territory orgs surfaced. Apollo's database may not have recent matches in your 15-county footprint.
            <div style={{ marginTop: 'var(--space-4)' }}>
              <button style={styles.secondaryBtn} onClick={onCancel}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =================================================================
// === BATCH ENRICH MODAL ("Spend remaining credits" wizard) ===
// =================================================================
function BatchEnrichModal({ styles, prospects, clusters, pdRecords, apolloQuota, apolloCycle, isRunning, progress, onConfirm, onCancel }) {
  // Build the high-trip-county set so we can score on cluster relevance.
  const highTripCounties = useMemo(() => {
    const top = clusters.slice(0, 8).map(c => c.county);
    return new Set(top);
  }, [clusters]);

  // Candidates = unenriched prospects (no email or personal email), in-territory, alive
  const candidates = useMemo(() => {
    return prospects
      .filter(p =>
        p.outreachStatus !== 'Dead' &&
        p.outreachStatus !== 'Customer' &&
        (!p.email || /(gmail|yahoo|hotmail|aol|comcast)/i.test(p.email)) &&
        p.county
      )
      .map(p => ({
        prospect: p,
        score: scoreUnenrichedCandidate(p, { allProspects: prospects, pdRecords, highTripCounties }),
      }))
      .sort((a, b) => b.score - a.score);
  }, [prospects, pdRecords, highTripCounties]);

  const [picked, setPicked] = useState({});
  const remaining = apolloQuota?.remaining ?? null;
  const pickedIds = candidates.filter(c => picked[c.prospect.id]).map(c => c.prospect.id);
  const pickedCount = pickedIds.length;
  const overBudget = remaining != null && pickedCount > remaining;

  // Auto-pick the top N up to remaining-credits when the modal first opens
  useEffect(() => {
    if (remaining == null) return;
    const auto = {};
    candidates.slice(0, Math.min(remaining, 20)).forEach(c => { auto[c.prospect.id] = true; });
    setPicked(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const togglePick = (id) => {
    setPicked(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const tierColor = (t) => t >= 4 ? 'var(--ok)' : t === 3 ? 'var(--warn)' : t === 2 ? 'var(--info)' : 'var(--text-3)';

  return (
    <div className="shp-modal-overlay" style={styles.modalOverlay} onClick={isRunning ? undefined : onCancel}>
      <div style={{ ...styles.modalCard, maxWidth: '760px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>Spend remaining Apollo credits</div>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>
            Ranked by leverage: net-new accounts, multi-thread completion, cluster priority, decision-maker tier.
          </div>
        </div>

        <div style={{ marginTop: '14px', padding: '12px 14px', background: 'var(--bg-sunk)', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px' }}>
          <div style={{ fontSize: '13px' }}>
            <div><strong>Apollo cycle:</strong> {apolloCycle.cycle} · {daysUntilMonthEnd()} day{daysUntilMonthEnd() === 1 ? '' : 's'} until reset</div>
            {remaining != null && (
              <div style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }}>
                {remaining} of {apolloQuota.total} credits remaining{apolloCycle.creditsUsedThisCycle > 0 ? ` · ${apolloCycle.creditsUsedThisCycle} used this cycle` : ''}
              </div>
            )}
          </div>
          <div style={{ fontSize: '13px', textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: '20px', color: overBudget ? 'var(--danger)' : 'var(--ok)' }}>{pickedCount}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>selected · {pickedCount} credit{pickedCount === 1 ? '' : 's'}</div>
          </div>
        </div>

        {overBudget && (
          <div style={{ marginTop: '10px', padding: '10px 12px', background: 'var(--danger-soft)', borderRadius: '8px', fontSize: '12px', color: 'var(--danger)' }}>
            Selection ({pickedCount}) exceeds remaining credits ({remaining}). Trim selection or proceed knowing some enrichments will fail.
          </div>
        )}

        {isRunning ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Loader2 size={32} className="spin" style={{ color: 'var(--danger)', marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Enriching {progress.done} of {progress.total}…</div>
            <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '6px' }}>~350ms between calls (rate-limit etiquette).</div>
            <div style={{ marginTop: '16px', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`, height: '100%', background: 'var(--shp-red)', transition: 'width 0.3s' }} />
            </div>
          </div>
        ) : candidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-3)' }}>
            <CheckCircle2 size={20} color="#4ade80" style={{ marginBottom: '8px' }} />
            <div style={{ fontSize: '13px' }}>No unenriched candidates. Your pool is clean.</div>
          </div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1, marginTop: '14px', borderTop: '1px solid rgba(232, 236, 243, 0.08)' }}>
            {candidates.slice(0, 50).map(({ prospect: p, score }) => {
              const tier = classifyTier(p.title);
              const checked = !!picked[p.id];
              return (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid rgba(232, 236, 243, 0.04)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={checked} onChange={() => togglePick(p.id)} style={{ width: '16px', height: '16px', accentColor: 'var(--danger)' }} />
                  <div style={{ width: '32px', textAlign: 'center', fontSize: '14px', fontWeight: 700, color: score >= 12 ? 'var(--ok)' : score >= 8 ? 'var(--warn)' : 'var(--text-3)' }}>{score}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '13px' }}>{p.name || '(no name)'}</strong>
                      {tier > 0 && <span style={{ fontSize: '10px', color: tierColor(tier), fontWeight: 600 }}>T{tier}</span>}
                      {p.parentProspectId && <span style={{ fontSize: '10px', color: 'var(--info)' }}>peer</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>{p.title || '(no title)'} · {p.company} · {p.county}</div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button style={styles.secondaryBtn} onClick={onCancel} disabled={isRunning}>Close</button>
          <button style={styles.primaryBtn} onClick={() => onConfirm(pickedIds)} disabled={isRunning || pickedCount === 0}>
            <Sparkles size={14} /> Enrich {pickedCount > 0 ? `${pickedCount} ` : ''}now
          </button>
        </div>
      </div>
    </div>
  );
}

function PursueLaterModal({ styles, date, setDate, onSave, onCancel }) {
  return (
    <div className="shp-modal-overlay" style={styles.modalOverlay} onClick={onCancel}>
      <div className="shp-modal-card" style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Pursue Later</div>
        <div style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '20px' }}>
          When should I remind you to revisit this prospect? They'll appear on your Dashboard on this date.
        </div>
        <label style={styles.label}>Revisit Date</label>
        <input style={styles.input} type="date" value={date} onChange={e => setDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <button style={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.primaryBtn} onClick={onSave} disabled={!date}>
            <CheckCircle2 size={14} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ styles, prospect, onConfirm, onCancel }) {
  return (
    <div className="shp-modal-overlay" style={styles.modalOverlay} onClick={onCancel}>
      <div className="shp-modal-card" style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Delete from pool?</div>
        <div style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '20px', lineHeight: '1.6' }}>
          This will remove <strong style={{ color: 'var(--text)' }}>{prospect.name || prospect.company}</strong> from your prospect pool entirely. Pipedrive records (if any) are <strong>not</strong> affected — manage those in Pipedrive directly.
          <div style={{ marginTop: '10px', padding: '10px 12px', background: 'var(--danger-soft)', borderRadius: '6px', fontSize: '12px', color: 'var(--danger)' }}>
            This action can't be undone from the agent. Re-importing the seed list won't restore deletions.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <button style={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
          <button style={{ ...styles.primaryBtn, background: 'var(--danger)' }} onClick={onConfirm}>
            <X size={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ styles, toast }) {
  return (
    <div style={styles.toast}>
      {toast.type === 'error' ? <AlertCircle size={16} color="#ff6b85" /> : <CheckCircle2 size={16} color={toast.type === 'info' ? 'var(--info)' : 'var(--ok)'} />}
      {toast.msg}
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      /* === SHP DESIGN TOKENS (Phase 1: Foundation) ===
         Light theme is primary. Tokens are scoped to :root so every inline
         style elsewhere can pull them via var(--token-name). All colors are
         oklch for perceptual uniformity; neutrals tinted toward SHP red (hue
         ~25) for subconscious cohesion. */

      :root {
        /* Brand */
        --shp-red:        oklch(50% 0.18 25);   /* #C8102E equiv */
        --shp-red-hover:  oklch(45% 0.19 25);
        --shp-red-press:  oklch(40% 0.18 25);
        --shp-red-soft:   oklch(95% 0.04 25);   /* tinted bg for selected/hover states */
        --shp-red-on:     #ffffff;              /* text color on red surfaces */

        /* Surfaces — warm off-white tinted toward brand red */
        --bg:             oklch(98.5% 0.005 25);   /* page background */
        --bg-sunk:        oklch(96.5% 0.006 25);   /* slightly recessed (e.g. cluster row hover) */
        --surface:        oklch(100% 0 0);          /* card */
        --surface-2:      oklch(98% 0.004 25);      /* nested surface (modal, popover) */

        /* Borders — subtle, warm-tinted */
        --border:         oklch(91% 0.008 25);
        --border-strong:  oklch(83% 0.01 25);
        --border-subtle:  oklch(95% 0.005 25);

        /* Text */
        --text:           oklch(22% 0.012 25);   /* primary, near-black with warmth */
        --text-2:         oklch(38% 0.01 25);    /* secondary */
        --text-3:         oklch(54% 0.008 25);   /* tertiary / supportive */
        --text-on-red:    #ffffff;
        --text-link:      oklch(48% 0.13 250);   /* deliberately not red — keeps red as action color */

        /* Status — accessible against light surfaces */
        --ok:             oklch(48% 0.14 145);
        --ok-soft:        oklch(94% 0.05 145);
        --warn:           oklch(58% 0.14 70);
        --warn-soft:      oklch(95% 0.06 70);
        --danger:         oklch(48% 0.18 25);    /* aligns to brand red */
        --danger-soft:    oklch(95% 0.04 25);
        --info:           oklch(50% 0.10 250);
        --info-soft:      oklch(95% 0.03 250);

        /* Segment colors (consistent with badge logic) */
        --seg-k12:        oklch(45% 0.13 250);
        --seg-higher:     oklch(46% 0.18 305);
        --seg-localgov:   oklch(55% 0.14 70);
        --seg-healthcare: oklch(48% 0.18 25);
        --seg-other:      oklch(50% 0.01 25);

        /* Spacing — 4pt scale, semantic names */
        --space-1: 4px;
        --space-2: 8px;
        --space-3: 12px;
        --space-4: 16px;
        --space-5: 24px;
        --space-6: 32px;
        --space-7: 48px;
        --space-8: 64px;
        --space-9: 96px;

        /* Radii */
        --r-sm: 6px;
        --r-md: 10px;
        --r-lg: 14px;
        --r-xl: 20px;
        --r-pill: 999px;

        /* Type scale (rem-based, app-style fixed scale; not fluid) */
        --fs-12: 12px;
        --fs-13: 13px;
        --fs-14: 14px;
        --fs-15: 15px;
        --fs-16: 16px;
        --fs-18: 18px;
        --fs-22: 22px;
        --fs-28: 28px;
        --fs-32: 32px;
        --fs-40: 40px;

        /* Shadows — minimal, no glow */
        --shadow-1: 0 1px 2px oklch(20% 0.01 25 / 6%);
        --shadow-2: 0 2px 6px oklch(20% 0.01 25 / 8%), 0 1px 2px oklch(20% 0.01 25 / 4%);
        --shadow-3: 0 12px 32px oklch(20% 0.01 25 / 12%), 0 2px 6px oklch(20% 0.01 25 / 6%);

        /* Type families */
        --font-ui: 'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
        --font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, monospace;

        /* Motion */
        --ease: cubic-bezier(0.22, 1, 0.36, 1);   /* ease-out-quart */
        --t-fast: 120ms;
        --t-med: 180ms;
      }

      /* === BASE === */
      html, body {
        background: var(--bg);
        color: var(--text);
        font-family: var(--font-ui);
        font-size: var(--fs-14);
        line-height: 1.5;
      }

      /* === MOTION === */
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }

      /* === FORM ELEMENTS === */
      input, textarea, select, button {
        font-family: var(--font-ui);
      }
      input:focus, textarea:focus, select:focus {
        border-color: var(--shp-red) !important;
        outline: 2px solid color-mix(in oklch, var(--shp-red) 25%, transparent);
        outline-offset: 1px;
      }

      /* Buttons: subtle hover + press, never lift */
      button { transition: background var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease), opacity var(--t-fast) var(--ease); }
      button:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Code / mono */
      code, .mono { font-family: var(--font-mono); font-size: 0.92em; }

      /* Status menu items: no hover-lift, just bg change */
      [data-status-menu] button:hover { background: var(--bg-sunk) !important; }

      /* Numeric tabular figures for stat displays */
      .tnum { font-variant-numeric: tabular-nums; }

      /* Links */
      a { color: var(--text-link); text-decoration: none; }
      a:hover { text-decoration: underline; }

      /* Scrollbars: subtle, themed */
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: var(--border); border-radius: var(--r-pill); border: 2px solid var(--bg); }
      ::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }

      /* === RESPONSIVE LAYER ===
         Three breakpoints: mobile (<=720), tablet (721-1024), desktop (>1024).
         Token-level overrides keep every component responsive without
         touching their inline styles. */

      /* Show/hide helpers used by the Header / MobileNav split */
      .shp-show-mobile { display: none; }
      .shp-show-desktop { display: flex; }

      /* Mobile bottom-tab-bar baseline */
      .shp-mobile-nav { display: none; }

      @media (max-width: 720px) {
        :root {
          --space-5: 16px;
          --space-6: 20px;
          --fs-28: 22px;
          --fs-32: 26px;
        }
        .shp-show-mobile { display: flex; }
        .shp-show-desktop { display: none !important; }
        .shp-main {
          padding: var(--space-4) var(--space-3) calc(72px + env(safe-area-inset-bottom)) !important;
        }
        .shp-page-title { font-size: var(--fs-22) !important; }
        .shp-stats-grid { grid-template-columns: 1fr 1fr !important; gap: var(--space-3) !important; }
        .shp-stat-card { padding: var(--space-3) !important; }
        .shp-stat-value { font-size: var(--fs-22) !important; }
        .shp-card { padding: var(--space-4) !important; border-radius: var(--r-md) !important; }
        .shp-grid2 { grid-template-columns: 1fr !important; }
        .shp-grid3 { grid-template-columns: 1fr !important; }
        .shp-modal-card {
          width: 100% !important;
          max-width: 100% !important;
          border-radius: var(--r-lg) var(--r-lg) 0 0 !important;
          align-self: flex-end;
          padding: var(--space-5) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom)) !important;
        }
        .shp-modal-overlay { align-items: flex-end !important; }
        .shp-mobile-nav {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 60;
          background: var(--surface);
          border-top: 1px solid var(--border);
          padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
          box-shadow: 0 -2px 12px oklch(20% 0.01 25 / 6%);
        }
        .shp-mobile-nav-btn {
          background: transparent;
          border: none;
          color: var(--text-2);
          padding: 8px 4px;
          border-radius: var(--r-sm);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          font-family: var(--font-ui);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          min-height: 52px;
        }
        .shp-mobile-nav-btn[data-active="true"] { color: var(--shp-red); }
        .shp-mobile-nav-btn:hover { background: var(--bg-sunk); }

        /* Pipeline kanban: keep horizontal scroll, but tighter cards */
        .shp-pipeline-grid { gap: var(--space-2) !important; }

        /* Header: shrink to logo + connection chip; nav is bottom-fixed instead */
        .shp-header { padding: var(--space-3) var(--space-4) !important; }
      }

      @media (min-width: 721px) and (max-width: 1024px) {
        .shp-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        .shp-grid3 { grid-template-columns: repeat(2, 1fr) !important; }
      }

      /* Min tap target on touch — 44px per Apple HIG, 48px per Material */
      @media (pointer: coarse) {
        button, a[role="button"], input[type="button"], input[type="submit"] {
          min-height: 44px;
        }
        select, input[type="date"], input[type="text"], input[type="email"], input[type="tel"], textarea {
          min-height: 44px;
        }
      }
    `}</style>
  );
}

// =================================================================
// === HELPERS ===
// =================================================================
// =================================================================
// === APOLLO WEB UI PREFILL ========================================
// =================================================================
// Build a deep link to Apollo's web search UI with the user's criteria
// pre-filled. Apollo's SPA reads filters from hash-fragment query params,
// so we construct: https://app.apollo.io/#/people?personTitles[]=X&...
//
// Used as the free-tier workaround for the search API plan-limit: user
// clicks the button → reviews/refines in Apollo's UI → exports CSV →
// drops the CSV into Find → Import CSV. Full closed loop without paying.
function buildApolloSearchUrl({
  titles = [],
  segments = [],
  locations = APOLLO_LOCATION_STRINGS,
  keywordsExclude = [],
  emailRequired = true, // default: only return contacts where Apollo has an email
}) {
  const params = [];
  const push = (key, value) => {
    if (value == null || value === '') return;
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  };

  // Email availability filter. Apollo's email-status taxonomy on the search
  // UI uses `contactEmailStatusV2[]`. Values worth keeping:
  //   verified                — Apollo SMTP-confirmed
  //   extrapolated_verified   — pattern-derived, deliverable
  //   likely_to_engage        — high open/reply propensity
  // Excludes 'unverified' (low confidence) and 'unavailable' (no email at all).
  if (emailRequired) {
    push('contactEmailStatusV2[]', 'verified');
    push('contactEmailStatusV2[]', 'extrapolated_verified');
    push('contactEmailStatusV2[]', 'likely_to_engage');
  }

  // Person titles — Apollo accepts array-style params (key[]=...).
  for (const t of titles) push('personTitles[]', t);

  // Filter by ORG location ONLY, not person location. SHP cares that the
  // ORG/facility is in CFL North — the contact's personal address (LinkedIn
  // profile location) is irrelevant and often wrong (a facilities director
  // at City of Jacksonville might list "Atlanta, GA" as their personal
  // location).
  //
  // Apollo ANDs personLocations + organizationLocations when both are
  // present, so sending both over-restricts the result set. Org-only is
  // the right semantic.
  for (const loc of locations) push('organizationLocations[]', loc);

  // Segments → Apollo's q_organization_keyword_tags. Reuse the same mapping
  // the agent uses everywhere else for K-12 / Higher Ed / Local Gov.
  const SEG_KW = {
    'k-12 education': ['school district', 'public schools', 'k-12', 'county schools'],
    'higher education': ['college', 'university', 'community college', 'state college'],
    'local government': ['city of', 'county government', 'town of', 'public works'],
  };
  const orgKw = [];
  for (const s of segments) {
    const map = SEG_KW[(s || '').toLowerCase()];
    if (map) orgKw.push(...map);
  }
  for (const kw of orgKw) push('qOrganizationKeywordTags[]', kw);
  for (const kw of keywordsExclude) push('qOrganizationNotKeywordTags[]', kw);

  // IMPORTANT: don't sort by `recommendations_score`. Apollo's
  // recommendation engine relaxes filters when scoring, pulling in adjacent
  // counties / states / "similar" matches and ranking them ahead of strict
  // matches. Sort by something deterministic so our county filters bite.
  push('sortByField', 'organization_name');
  push('sortAscending', 'true');

  return `https://app.apollo.io/#/people?${params.join('&')}`;
}

// =================================================================
// === CSV IMPORT HELPERS ==========================================
// =================================================================
// Minimal CSV parser. Handles RFC-4180 essentials:
//   - quoted fields containing commas, newlines, and escaped quotes ("")
//   - mixed line endings (\r\n, \n)
//   - empty trailing rows
// Not for arbitrary streaming — fine for the few-hundred-row Apollo exports
// users typically import here.
function parseCsv(text) {
  const rows = [];
  let cur = [''];
  let inQuotes = false;
  let i = 0;
  const src = text.replace(/\r\n/g, '\n');

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cur[cur.length - 1] += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cur[cur.length - 1] += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cur.push(''); i++; continue; }
    if (ch === '\n') { rows.push(cur); cur = ['']; i++; continue; }
    cur[cur.length - 1] += ch; i++;
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map(h => (h || '').trim());
  const data = rows.slice(1)
    .filter(r => r.some(v => (v || '').trim() !== ''))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
      return obj;
    });
  return { headers, rows: data };
}

// The fields a Prospect entry needs. Each maps to one CSV column (or two for name).
const CSV_FIELDS = [
  { key: 'firstName',   label: 'First Name',  optional: true,  notes: 'Combined with Last Name if "Name" isn\'t mapped' },
  { key: 'lastName',    label: 'Last Name',   optional: true },
  { key: 'name',        label: 'Full Name',   optional: true,  notes: 'Overrides First+Last if mapped' },
  { key: 'title',       label: 'Job Title',   optional: true },
  { key: 'company',     label: 'Company',     optional: false, notes: 'Required' },
  { key: 'email',       label: 'Work Email',  optional: true },
  { key: 'phone',       label: 'Phone',       optional: true },
  { key: 'city',        label: 'City',        optional: true,  notes: 'Used to classify county' },
  { key: 'state',       label: 'State',       optional: true },
  { key: 'zip',         label: 'Zip Code',    optional: true,  notes: 'Fallback for county when city is missing' },
  { key: 'linkedinUrl', label: 'LinkedIn URL', optional: true },
];

// Guess which CSV header maps to each Prospect field based on common Apollo /
// CRM column names. Returns { [fieldKey]: csvHeaderName | null }.
function autoMapCsvColumns(headers) {
  const patterns = {
    firstName:   [/^first\s*name$/i, /^firstname$/i, /^given\s*name$/i],
    lastName:    [/^last\s*name$/i, /^lastname$/i, /^surname$/i, /^family\s*name$/i],
    name:        [/^full\s*name$/i, /^name$/i, /^contact\s*name$/i, /^person\s*name$/i],
    title:       [/^(job\s*)?title$/i, /^position$/i, /^role$/i],
    company:     [/^company( name)?$/i, /^organization$/i, /^account( name)?$/i, /^employer$/i],
    email:       [/^(work[ _-]+)?email([ _-]+address)?$/i, /^e[ _-]?mail$/i, /^primary email$/i],
    phone:       [/^(work[ _-]+)?(direct[ _-]+)?phone( number)?$/i, /^mobile( phone)?$/i, /^cell( phone)?$/i],
    city:        [/^city$/i, /^location$/i],
    state:       [/^state$/i, /^state\/province$/i, /^region$/i],
    zip:         [/^zip([ _-]+code)?$/i, /^postal([ _-]+code)?$/i, /^postcode$/i],
    linkedinUrl: [/^linkedin([ _-]+url)?$/i, /^linkedin[ _-]+profile$/i],
  };
  const out = {};
  for (const field of Object.keys(patterns)) {
    const found = headers.find(h => patterns[field].some(re => re.test(h.trim())));
    out[field] = found || null;
  }
  return out;
}

// Project a single CSV row through the mapping into a candidate Prospect shape.
// Returns null if the row is missing a required field (name or company).
function csvRowToProspect(row, mapping, idx) {
  const get = (field) => {
    const col = mapping[field];
    return col ? (row[col] || '').trim() : '';
  };
  // Name: prefer the "Full Name" mapping; otherwise combine First + Last.
  let name = get('name');
  if (!name) {
    const fn = get('firstName');
    const ln = get('lastName');
    name = [fn, ln].filter(Boolean).join(' ').trim();
  }
  const company = get('company');
  if (!name || !company) return null;

  return {
    name,
    title: get('title'),
    company,
    email: get('email').toLowerCase(),
    phone: get('phone'),
    city: get('city'),
    state: get('state') || 'FL',
    zip: get('zip'),
    linkedinUrl: get('linkedinUrl'),
    _csvRow: idx,
  };
}

// Guarantee the user's physical postal address appears in the signature
// (CAN-SPAM compliance). If the signature already mentions the address text
// somewhere, returns it untouched. Otherwise appends it on its own line.
function ensureAddressInSignature(signature, address) {
  const sig = (signature || '').trim();
  const addr = (address || '').trim();
  if (!addr) return sig;
  // Loose check: if any meaningful chunk of the address is already present,
  // assume the user has manually placed it and don't duplicate.
  const probe = addr.split(/[·,|]/)[0].trim().toLowerCase();
  if (probe && sig.toLowerCase().includes(probe)) return sig;
  return sig + (sig.endsWith('\n') ? '' : '\n\n') + addr;
}

function normalizeSeed(seed) {
  return seed.map(s => ({
    ...s,
    icpStatus: s.status === 'Ready' ? 'in' : s.status === 'Review Needed' ? 'unknown' : 'out',
    titleAltitude: classifyTitle(s.title || '').altitude,
  }));
}

// =================================================================
// === STYLE FACTORY ===
// =================================================================
function makeStyles(pdConnected, stagesLen) {
  // Phase 1 refresh: every value reads from CSS tokens defined in <GlobalStyles />.
  // No gradients, no glow shadows, no glassmorphism. SHP red used as a scalpel.
  return {
    container: {
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-ui)',
    },
    header: {
      borderBottom: '1px solid var(--border)',
      padding: 'var(--space-4) var(--space-6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--surface)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    },
    logo: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' },
    // Solid red mark, no gradient, no glow. Just a confident brand block.
    logoMark: {
      width: '36px',
      height: '36px',
      background: 'var(--shp-red)',
      color: 'var(--shp-red-on)',
      borderRadius: 'var(--r-sm)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: 'var(--fs-13)',
      letterSpacing: '0.04em',
    },
    logoText: { fontSize: 'var(--fs-15)', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)' },
    logoSub: {
      fontSize: 'var(--fs-12)',
      color: 'var(--text-3)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      marginTop: '2px',
      fontWeight: 500,
    },
    nav: {
      display: 'flex',
      gap: '2px',
      background: 'var(--bg-sunk)',
      padding: '3px',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border-subtle)',
    },
    navBtn: (active) => ({
      padding: '7px var(--space-3)',
      borderRadius: 'var(--r-sm)',
      fontSize: 'var(--fs-13)',
      fontWeight: 500,
      background: active ? 'var(--surface)' : 'transparent',
      color: active ? 'var(--text)' : 'var(--text-2)',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      boxShadow: active ? 'var(--shadow-1)' : 'none',
    }),
    pdBadge: (connected) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: 'var(--fs-12)',
      fontWeight: 600,
      padding: '5px 10px',
      borderRadius: 'var(--r-pill)',
      background: connected ? 'var(--ok-soft)' : 'var(--warn-soft)',
      color: connected ? 'var(--ok)' : 'var(--warn)',
      border: `1px solid ${connected ? 'color-mix(in oklch, var(--ok) 30%, transparent)' : 'color-mix(in oklch, var(--warn) 30%, transparent)'}`,
      cursor: 'pointer',
    }),
    main: { padding: 'var(--space-6)', maxWidth: '1400px', margin: '0 auto' },
    pageTitle: {
      fontSize: 'var(--fs-28)',
      fontWeight: 700,
      letterSpacing: '-0.02em',
      marginBottom: '6px',
      color: 'var(--text)',
    },
    pageSubtitle: { fontSize: 'var(--fs-14)', color: 'var(--text-3)', marginBottom: 'var(--space-5)' },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 'var(--space-4)',
      marginBottom: 'var(--space-5)',
    },
    statCard: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 'var(--space-5)',
    },
    statLabel: {
      fontSize: 'var(--fs-12)',
      color: 'var(--text-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: 600,
    },
    statValue: {
      fontSize: 'var(--fs-32)',
      fontWeight: 700,
      letterSpacing: '-0.02em',
      marginTop: 'var(--space-2)',
      color: 'var(--text)',
      fontVariantNumeric: 'tabular-nums',
    },
    statSub: { fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginTop: '4px' },
    card: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 'var(--space-5)',
      marginBottom: 'var(--space-4)',
    },
    sectionTitle: {
      fontSize: 'var(--fs-12)',
      fontWeight: 600,
      color: 'var(--text-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: 'var(--space-4)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    input: {
      width: '100%',
      background: 'var(--surface)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--r-md)',
      padding: '10px 14px',
      color: 'var(--text)',
      fontSize: 'var(--fs-14)',
      fontFamily: 'inherit',
      outline: 'none',
      transition: 'border-color var(--t-fast) var(--ease)',
      boxSizing: 'border-box',
    },
    label: {
      display: 'block',
      fontSize: 'var(--fs-12)',
      color: 'var(--text-2)',
      marginBottom: '6px',
      fontWeight: 500,
    },
    primaryBtn: {
      background: 'var(--shp-red)',
      color: 'var(--shp-red-on)',
      border: '1px solid var(--shp-red)',
      borderRadius: 'var(--r-md)',
      padding: '10px var(--space-4)',
      fontSize: 'var(--fs-14)',
      fontWeight: 600,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
    },
    secondaryBtn: {
      background: 'var(--surface)',
      color: 'var(--text)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--r-md)',
      padding: '9px var(--space-4)',
      fontSize: 'var(--fs-13)',
      fontWeight: 500,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
    },
    prospectCard: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      padding: 'var(--space-4)',
      marginBottom: 'var(--space-2)',
      transition: 'border-color var(--t-fast) var(--ease)',
    },
    // Light-theme badge palette. Soft tinted bg, saturated text. No side stripes.
    badge: (color) => {
      const map = {
        red:    { bg: 'var(--danger-soft)', text: 'var(--danger)', border: 'color-mix(in oklch, var(--danger) 30%, transparent)' },
        green:  { bg: 'var(--ok-soft)',     text: 'var(--ok)',     border: 'color-mix(in oklch, var(--ok) 30%, transparent)' },
        amber:  { bg: 'var(--warn-soft)',   text: 'var(--warn)',   border: 'color-mix(in oklch, var(--warn) 30%, transparent)' },
        navy:   { bg: 'var(--info-soft)',   text: 'var(--info)',   border: 'color-mix(in oklch, var(--info) 30%, transparent)' },
        purple: { bg: 'oklch(95% 0.04 305)', text: 'var(--seg-higher)', border: 'color-mix(in oklch, var(--seg-higher) 25%, transparent)' },
        gray:   { bg: 'var(--bg-sunk)', text: 'var(--text-2)', border: 'var(--border-strong)' },
      };
      const c = map[color] || map.navy;
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 9px',
        borderRadius: 'var(--r-pill)',
        fontSize: 'var(--fs-12)',
        fontWeight: 600,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      };
    },
    pipelineGrid: {
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.max(stagesLen, 1)}, minmax(180px, 1fr))`,
      gap: 'var(--space-3)',
      overflowX: 'auto',
      paddingBottom: 'var(--space-2)',
    },
    pipelineCol: {
      background: 'var(--bg-sunk)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 'var(--space-3)',
      minHeight: '320px',
      minWidth: '180px',
    },
    pipelineHeader: {
      fontSize: 'var(--fs-12)',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-2)',
      marginBottom: 'var(--space-3)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
    },
    pipelineCard: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      padding: '10px 12px',
      marginBottom: 'var(--space-2)',
      fontSize: 'var(--fs-12)',
      boxShadow: 'var(--shadow-1)',
    },
    toast: {
      position: 'fixed',
      bottom: 'var(--space-5)',
      right: 'var(--space-5)',
      background: 'var(--surface)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--r-md)',
      padding: '12px 18px',
      fontSize: 'var(--fs-13)',
      fontWeight: 500,
      color: 'var(--text)',
      boxShadow: 'var(--shadow-3)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      zIndex: 100,
      maxWidth: '420px',
    },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' },
    grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' },
    statusMenu: {
      position: 'absolute',
      top: '100%',
      right: 0,
      marginTop: '4px',
      background: 'var(--surface)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--r-md)',
      padding: '4px',
      minWidth: '220px',
      boxShadow: 'var(--shadow-3)',
      zIndex: 100,
    },
    statusMenuItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      padding: '8px 12px',
      background: 'transparent',
      border: 'none',
      color: 'var(--text)',
      fontSize: 'var(--fs-13)',
      fontFamily: 'inherit',
      cursor: 'pointer',
      borderRadius: 'var(--r-sm)',
      textAlign: 'left',
    },
    modalOverlay: {
      position: 'fixed',
      inset: 0,
      background: 'oklch(20% 0.01 25 / 35%)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 200,
    },
    modalCard: {
      background: 'var(--surface)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--r-lg)',
      padding: 'var(--space-6)',
      maxWidth: '460px',
      width: '90%',
      boxShadow: 'var(--shadow-3)',
      color: 'var(--text)',
    },
  };
}
