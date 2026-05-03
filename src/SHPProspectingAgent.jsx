import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Building2, Mail, CheckCircle2, Loader2, Sparkles, Target,
  ExternalLink, Filter, ArrowRight, Send, Edit3, Zap, TrendingUp,
  MapPin, Users, AlertCircle, Briefcase, Hash, Settings, Key,
  RefreshCw, X, Plus, Compass, BookOpen, MessageCircle, Copy,
  ChevronRight, ChevronDown,
} from 'lucide-react';
import {
  SHP_IDENTITY, DEFAULT_SIGNATURE, TERRITORY, classifyCounty, isInTerritory,
  classifyICP, classifyTitle, PAIN_LIBRARY, RESOURCE_CTAS, CUSTOMERS, pickProofPoints,
  PAIN_FUNNEL_TEMPLATES, UFC_TEMPLATES, REVERSING_RESPONSES,
  buildColdEmailPrompt, buildDealTitle, buildClusters, FOLLOW_UP_DAYS,
} from './strategy.js';
import seedData from './seed-prospects.js';

export default function SHPProspectingAgent() {
  const [view, setView] = useState('dashboard');

  // Pipedrive
  const [pdConnected, setPdConnected] = useState(false);
  const [pdMeta, setPdMeta] = useState({ stages: [], pipelines: [], userId: null, defaultPipelineId: null });
  const [isConnecting, setIsConnecting] = useState(false);

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
    sendMode: 'pipedrive', // 'pipedrive' (direct send via M365) | 'gmail' (legacy fallback)
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

  // Pipedrive records — pdRecords[prospectId] = {dealId, personId, orgId, sentAt}
  const [pdRecords, setPdRecords] = useState({});
  const [stageDeals, setStageDeals] = useState({});
  const [isPushing, setIsPushing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

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

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // === Settings persistence ===
  useEffect(() => {
    const saved = localStorage.getItem('shp_config_v3');
    if (saved) {
      try { setConfig(c => ({ ...c, ...JSON.parse(saved) })); } catch {}
    }
    const savedOverrides = localStorage.getItem('shp_prospect_overrides_v3');
    if (savedOverrides) {
      try { setOverrides(JSON.parse(savedOverrides)); } catch {}
    }
    autoConnect();
  }, []);

  // Persist overrides whenever they change
  useEffect(() => {
    if (Object.keys(overrides).length > 0) {
      localStorage.setItem('shp_prospect_overrides_v3', JSON.stringify(overrides));
    }
  }, [overrides]);

  const saveConfig = () => {
    localStorage.setItem('shp_config_v3', JSON.stringify(config));
    showToast('Settings saved');
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
    const r = await fetch('/api/pipedrive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, path, body }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || json?.message || `Pipedrive ${r.status}`);
    return json;
  };

  const autoConnect = async () => {
    setIsConnecting(true);
    try {
      const me = await pdRequest('GET', '/users/me');
      const pipelines = await pdRequest('GET', '/pipelines');
      const stagesResp = await pdRequest('GET', '/stages');

      const defaultPipeline = pipelines.data.find(p => p.selected) || pipelines.data[0];
      const pipelineStages = stagesResp.data
        .filter(s => s.pipeline_id === defaultPipeline.id)
        .sort((a, b) => a.order_nr - b.order_nr);

      setPdMeta({
        userId: me.data.id,
        userEmail: me.data.email,
        userName: me.data.name,
        pipelines: pipelines.data,
        defaultPipelineId: defaultPipeline.id,
        defaultPipelineName: defaultPipeline.name,
        stages: pipelineStages,
      });
      setPdConnected(true);

      const buckets = {};
      pipelineStages.forEach(s => { buckets[s.id] = []; });
      setStageDeals(buckets);

      await syncPipelineWith(defaultPipeline.id, pipelineStages);
    } catch (err) {
      console.error('Auto-connect failed:', err);
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

  // === Apollo search ===
  const runApolloSearch = async () => {
    setIsApolloSearching(true);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `Search Apollo.io for facilities decision-makers in CFL North Florida (these counties: ${TERRITORY.counties.join(', ')}).

Titles to target: ${apolloCriteria.titles}
Segments to target: ${apolloCriteria.segments}

HARD AUTO-SKIPS — DO NOT RETURN: Healthcare, hospitals, medical, industrial, warehouse, manufacturing, single-storefront retail, multi-site commercial property managers (CBRE, JLL, Cushman, etc.), residential, hospitality (hotels, resorts).

Return ONLY a JSON array (no preamble, no markdown) of up to 8 in-ICP, in-territory prospects:
[{"name":"Full Name","title":"Job Title","company":"Org Name","city":"City","email":"email or empty","phone":"phone or empty"}]

If Apollo unavailable, return realistic example data for one of the three ICP segments in CFL North.`
          }],
          mcp_servers: [{ type: 'url', url: 'https://mcp.apollo.io/mcp', name: 'apollo-mcp' }],
        }),
      });
      const data = await response.json();
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const cleaned = text.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      const parsed = match ? JSON.parse(match[0]) : [];

      // Process each result through territory + ICP classification
      const newProspects = parsed.map((p, i) => {
        const county = classifyCounty(p.city);
        const icp = classifyICP(p.company, p.title);
        const titleClass = classifyTitle(p.title);
        return {
          id: `apollo_${Date.now()}_${i}`,
          name: p.name || '',
          title: p.title || '',
          company: p.company || '',
          email: p.email || '',
          phone: p.phone || '',
          city: p.city || '',
          county: county || '',
          state: 'FL',
          zip: '',
          segment: icp.segment,
          icpStatus: icp.status,
          titleAltitude: titleClass.altitude,
          status: icp.status === 'in' ? 'Ready' : (icp.status === 'unknown' ? 'Review Needed' : 'Out of ICP'),
          source: 'Apollo',
          priority: 50 + (icp.status === 'in' ? 30 : 0) + (p.email ? 20 : 0),
        };
      });

      // Filter to keep only in-territory results
      const inTerritory = newProspects.filter(p => p.county);
      setProspects(prev => [...prev, ...inTerritory]);
      showToast(`Added ${inTerritory.length} prospects from Apollo (${parsed.length - inTerritory.length} filtered out)`);
    } catch (err) {
      showToast(`Apollo search unavailable — try Manual Add instead`, 'info');
    } finally {
      setIsApolloSearching(false);
    }
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

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1200,
          messages: [{
            role: 'user',
            content: `Research ${prospect.name}, ${prospect.title} at ${prospect.company} in ${prospect.city}, ${prospect.county || 'Florida'}. They're in the ${prospect.segment} segment. Focus on commercial door, hardware, and facility-management signals relevant to a Florida door & hardware distributor.

Return ONLY a JSON object (no preamble, no markdown):
{"companySnapshot":"1-2 sentences about the org","facilityProfile":"1-2 sentences on likely facility footprint and door volume","painSignals":["3 specific facility-side pain points relevant to ${prospect.segment}"],"openingHook":"ONE specific conversational email opener referencing something concrete","fitScore":85,"fitReasoning":"1 sentence on SHP fit"}`
          }],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        }),
      });
      const data = await response.json();
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const cleaned = text.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;

      if (parsed) {
        setResearchData(prev => ({ ...prev, [prospect.id]: parsed }));
        showToast('Research complete');
      } else throw new Error('parse fail');
    } catch (err) {
      // Fallback using strategy module pain libraries
      const segPains = PAIN_LIBRARY[prospect.segment]?.tactical || [];
      const fallback = {
        companySnapshot: `${prospect.company} operates in ${prospect.county || 'CFL North'} county as a ${prospect.segment} organization.`,
        facilityProfile: `Likely manages multiple buildings with the typical mix of high-traffic doors, mechanical hardware, and access control needs for the segment.`,
        painSignals: segPains.slice(0, 3),
        openingHook: `Saw ${prospect.company} in the ${prospect.county || 'CFL North'} area and wanted to introduce SHP.`,
        fitScore: 75,
        fitReasoning: `${prospect.segment} multi-building operator is a fit for SHP's ICP.`,
      };
      setResearchData(prev => ({ ...prev, [prospect.id]: fallback }));
      showToast('Research complete (offline mode)', 'info');
    } finally {
      setIsResearching(false);
    }
  };

  // === Cold email draft (v2 tone, resource-framed, NOT Sandler-pattern) ===
  const draftOutreach = async () => {
    if (!selectedProspect) return;
    const research = researchData[selectedProspect.id];
    if (!research) return;
    setIsDrafting(true);
    setView('compose');

    const prompt = buildColdEmailPrompt(selectedProspect, research, selectedProspect.segment, config.signature);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await response.json();
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const cleaned = text.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      if (parsed) {
        setDraftEmail({ subject: parsed.subject, body: parsed.body });
      } else throw new Error('parse fail');
    } catch (err) {
      // Fallback hand-crafted email — Anthony's voice, with proof points
      const firstName = (selectedProspect.name || '').split(' ')[0] || 'there';
      const ctaKey = selectedProspect.segment === 'K-12 Education' ? 'K12'
                   : selectedProspect.segment === 'Higher Education' ? 'HigherEd'
                   : selectedProspect.segment === 'Local Government' ? 'LocalGov' : 'default';
      const proofs = pickProofPoints(selectedProspect, 2);
      const proofLine = proofs.length > 0
        ? `We currently support ${proofs.map(p => p.name).join(' and ')} in the area, among others. `
        : '';
      setDraftEmail({
        subject: `quick intro from SHP — ${selectedProspect.company}`,
        body: `Hi ${firstName},\n\nI got your name while looking around for the right person at ${selectedProspect.company} to share some information with about Superior Hardware Products.\n\nI know you likely have someone for what we do, but I wanted to get you some information in case you need another arrow in your quiver. In short, we can handle everything related to your door openings — from mechanical to electrified to automatics. SHP can provide, service, and install anything related to doors or hardware. ${proofLine}\n\n${RESOURCE_CTAS[ctaKey]}\n\nLet me know if the timing is right for a conversation.\n\nBest Regards,\n\n${config.signature}`,
      });
    } finally {
      setIsDrafting(false);
    }
  };

  // === Push to Pipedrive ===
  const pushToPipedrive = async () => {
    if (!pdConnected) {
      showToast('Pipedrive not connected', 'error');
      setView('settings');
      return;
    }
    if (!selectedProspect) return;
    if (pdRecords[selectedProspect.id]?.dealId) {
      showToast('Already in Pipedrive', 'info');
      return;
    }
    setIsPushing(true);
    try {
      const orgResp = await pdRequest('POST', '/organizations', {
        name: selectedProspect.company,
        owner_id: pdMeta.userId,
      });
      const orgId = orgResp.data.id;

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

      const firstStage = pdMeta.stages[0];
      const dealResp = await pdRequest('POST', '/deals', {
        title: buildDealTitle(selectedProspect, selectedProspect.segment),
        person_id: personId,
        org_id: orgId,
        pipeline_id: pdMeta.defaultPipelineId,
        stage_id: firstStage.id,
        owner_id: pdMeta.userId,
      });
      const dealId = dealResp.data.id;

      const research = researchData[selectedProspect.id];
      if (research) {
        const noteContent = `<b>AI Research — Fit ${research.fitScore}/100 · ${selectedProspect.segment}</b><br><br><b>Company:</b> ${research.companySnapshot}<br><br><b>Facility profile:</b> ${research.facilityProfile}<br><br><b>Pain signals:</b><ul>${research.painSignals.map(p => `<li>${p}</li>`).join('')}</ul><b>SHP fit:</b> ${research.fitReasoning}<br><br><b>County:</b> ${selectedProspect.county || 'unknown'} · <b>Source:</b> ${selectedProspect.source || 'manual'}`;
        await pdRequest('POST', '/notes', {
          content: noteContent,
          deal_id: dealId, person_id: personId, org_id: orgId,
        });
      }

      const followUp = new Date();
      followUp.setDate(followUp.getDate() + FOLLOW_UP_DAYS);
      const dueDate = followUp.toISOString().split('T')[0];
      await pdRequest('POST', '/activities', {
        subject: `Day ${FOLLOW_UP_DAYS} resource follow-up — ${selectedProspect.name}`,
        type: 'email',
        due_date: dueDate,
        due_time: '09:00',
        deal_id: dealId, person_id: personId, org_id: orgId,
        user_id: pdMeta.userId,
        note: `Resource-framed follow-up. If no reply by today, share something useful (fire door inspection guide, ADA upgrade checklist, segment-specific resource). Don't pitch — stay in resource frame.`,
      });

      setPdRecords(prev => ({
        ...prev,
        [selectedProspect.id]: { orgId, personId, dealId, dealUrl: `https://app.pipedrive.com/deal/${dealId}` },
      }));
      showToast(`Created Pipedrive deal #${dealId}`);
      await syncPipeline();
    } catch (err) {
      showToast(`Pipedrive push failed: ${err.message}`, 'error');
    } finally {
      setIsPushing(false);
    }
  };

  // === Open Outlook web compose with email pre-filled ===
  // Anthony is on M365 with two-way Pipedrive sync, so Outlook-sent emails auto-log to deals.
  // No Smart BCC needed (sync handles it). One click: pre-fill → review → click Send in Outlook.
  const sendViaOutlook = () => {
    if (!selectedProspect?.email) {
      showToast('No email address — add one first', 'error');
      return;
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
    setPdRecords(prev => ({
      ...prev,
      [selectedProspect.id]: { ...prev[selectedProspect.id], sentAt: new Date().toISOString() },
    }));
    showToast('Opened in Outlook — review and click Send');
  };

  // === Open the deal in Pipedrive's web UI to compose there ===
  // Alt path: if user prefers Pipedrive's compose UI (which sends through M365 sync)
  const openInPipedrive = () => {
    if (!selectedProspect) return;
    const rec = pdRecords[selectedProspect.id];
    if (!rec?.dealId) {
      showToast('Push to Pipedrive first', 'info');
      return;
    }
    window.open(rec.dealUrl || `https://app.pipedrive.com/deal/${rec.dealId}`, '_blank', 'noopener,noreferrer');
    showToast('Opened deal in Pipedrive — click Email in the deal panel');
  };

  // Backwards-compatible alias for any UI still calling sendViaGmail
  const sendViaGmail = sendViaOutlook;


  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  };

  // === Layer overrides onto prospects (computed derived list) ===
  // Each prospect gets an `outreachStatus` and `revisitDate` from overrides if present, else defaults
  const prospectsWithOverrides = useMemo(() => {
    return prospects.map(p => {
      const o = overrides[p.id];
      return {
        ...p,
        outreachStatus: o?.outreachStatus || 'Active',
        revisitDate: o?.revisitDate || null,
      };
    });
  }, [prospects, overrides]);

  // === Filtered prospect list (memoized) ===
  const filteredProspects = useMemo(() => {
    return prospectsWithOverrides.filter(p => {
      if (filterOutreach !== 'all' && p.outreachStatus !== filterOutreach) return false;
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

  // Clusters: only Ready + Active (no Customers, Dead, or PursueLater in trip planning)
  const clusters = useMemo(() => buildClusters(
    prospectsWithOverrides.filter(p => p.status === 'Ready' && p.outreachStatus === 'Active')
  ), [prospectsWithOverrides]);

  // Pursue Later items whose revisit date has hit (today or earlier)
  const pursueLaterDue = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return prospectsWithOverrides.filter(p =>
      p.outreachStatus === 'PursueLater' && p.revisitDate && p.revisitDate <= today
    );
  }, [prospectsWithOverrides]);

  // === Stats ===
  const stats = useMemo(() => ({
    total: prospectsWithOverrides.length,
    ready: prospectsWithOverrides.filter(p => p.status === 'Ready' && p.outreachStatus === 'Active').length,
    customers: prospectsWithOverrides.filter(p => p.outreachStatus === 'Customer').length,
    pursueLater: prospectsWithOverrides.filter(p => p.outreachStatus === 'PursueLater').length,
    pushed: Object.keys(pdRecords).length,
    sent: Object.values(pdRecords).filter(r => r.sentAt).length,
    openDeals: Object.values(stageDeals).reduce((a, arr) => a + arr.length, 0),
    pursueLaterDueCount: pursueLaterDue.length,
  }), [prospectsWithOverrides, pdRecords, stageDeals, pursueLaterDue]);

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
      <div style={styles.main}>
        {view === 'dashboard' && <DashboardView styles={styles} stats={stats} pdConnected={pdConnected} pdMeta={pdMeta} setView={setView} clusters={clusters} fromName={config.fromName} pursueLaterDue={pursueLaterDue} researchProspect={researchProspect} researchData={researchData} pdRecords={pdRecords} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} />}
        {view === 'find' && <FindView styles={styles} apolloCriteria={apolloCriteria} setApolloCriteria={setApolloCriteria} runApolloSearch={runApolloSearch} isApolloSearching={isApolloSearching} manualForm={manualForm} setManualForm={setManualForm} addManualProspect={addManualProspect} prospects={filteredProspects} researchProspect={researchProspect} researchData={researchData} pdRecords={pdRecords} filterSegment={filterSegment} setFilterSegment={setFilterSegment} filterCounty={filterCounty} setFilterCounty={setFilterCounty} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterOutreach={filterOutreach} setFilterOutreach={setFilterOutreach} search={search} setSearch={setSearch} totalProspects={prospects.length} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} />}
        {view === 'clusters' && <ClustersView styles={styles} clusters={clusters} researchProspect={researchProspect} researchData={researchData} pdRecords={pdRecords} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} />}
        {view === 'research' && selectedProspect && <ResearchView styles={styles} prospect={selectedProspect} research={researchData[selectedProspect.id]} isResearching={isResearching} setView={setView} draftOutreach={draftOutreach} />}
        {view === 'compose' && selectedProspect && <ComposeView styles={styles} prospect={selectedProspect} setProspect={setSelectedProspect} draftEmail={draftEmail} setDraftEmail={setDraftEmail} isDrafting={isDrafting} draftOutreach={draftOutreach} pushToPipedrive={pushToPipedrive} sendViaOutlook={sendViaOutlook} openInPipedrive={openInPipedrive} pdRecords={pdRecords} pdConnected={pdConnected} isPushing={isPushing} config={config} setView={setView} followUpDays={FOLLOW_UP_DAYS} />}
        {view === 'pipeline' && <PipelineView styles={styles} pdConnected={pdConnected} pdMeta={pdMeta} stageDeals={stageDeals} syncPipeline={syncPipeline} isSyncing={isSyncing} setView={setView} />}
        {view === 'coach' && <CoachView styles={styles} coachTab={coachTab} setCoachTab={setCoachTab} coachSelectedSegment={coachSelectedSegment} setCoachSelectedSegment={setCoachSelectedSegment} copyToClipboard={copyToClipboard} />}
        {view === 'settings' && <SettingsView styles={styles} config={config} setConfig={setConfig} saveConfig={saveConfig} pdConnected={pdConnected} pdMeta={pdMeta} autoConnect={autoConnect} isConnecting={isConnecting} syncPipeline={syncPipeline} isSyncing={isSyncing} />}
      </div>
      {toast && <Toast styles={styles} toast={toast} />}
      {pursueLaterFor && <PursueLaterModal styles={styles} date={pursueLaterDate} setDate={setPursueLaterDate} onSave={savePursueLater} onCancel={() => setPursueLaterFor(null)} />}
      {deleteConfirm && <DeleteConfirmModal styles={styles} prospect={deleteConfirm} onConfirm={executeDelete} onCancel={() => setDeleteConfirm(null)} />}
      <GlobalStyles />
    </div>
  );
}

// =================================================================
// === HEADER ===
// =================================================================
function Header({ styles, view, setView, pdConnected, isConnecting, userName }) {
  return (
    <div style={styles.header}>
      <div style={styles.logo}>
        <div style={styles.logoMark}>SHP</div>
        <div>
          <div style={styles.logoText}>Outbound Agent</div>
          <div style={styles.logoSub}>CFL North · v3</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={styles.pdBadge(pdConnected)} onClick={() => setView('settings')}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: pdConnected ? '#4ade80' : isConnecting ? '#fbbf24' : '#ff6b85' }} />
          {isConnecting ? 'Connecting…' : pdConnected ? `Pipedrive · ${userName || 'connected'}` : 'Pipedrive disconnected'}
        </div>
        <div style={styles.nav}>
          {[
            { id: 'dashboard', icon: TrendingUp, label: 'Dashboard' },
            { id: 'find', icon: Search, label: 'Find' },
            { id: 'clusters', icon: Compass, label: 'Clusters' },
            { id: 'pipeline', icon: Briefcase, label: 'Pipeline' },
            { id: 'coach', icon: BookOpen, label: 'Coach' },
            { id: 'settings', icon: Settings, label: 'Settings' },
          ].map(item => (
            <button key={item.id} style={styles.navBtn(view === item.id)} onClick={() => setView(item.id)}>
              <item.icon size={14} /> {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// =================================================================
// === DASHBOARD ===
// =================================================================
function DashboardView({ styles, stats, pdConnected, pdMeta, setView, clusters, fromName, pursueLaterDue, researchProspect, researchData, pdRecords, markCustomer, markDead, markActive, openPursueLater, confirmDelete }) {
  const topClusters = clusters.slice(0, 5);
  const firstName = (fromName || 'Anthony').split(' ')[0];
  return (
    <>
      <div style={styles.pageTitle}>Welcome back, {firstName}</div>
      <div style={styles.pageSubtitle}>{pdConnected ? `Connected to ${pdMeta.defaultPipelineName} · ${pdMeta.stages.length} stages` : 'Pipedrive disconnected — check Vercel env vars'}</div>

      {!pdConnected && (
        <div style={{ ...styles.card, borderColor: 'rgba(255, 107, 133, 0.3)', background: 'rgba(255, 107, 133, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <AlertCircle size={20} color="#ff6b85" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Pipedrive not connected</div>
              <div style={{ fontSize: '13px', color: '#a8b5c9' }}>Set PIPEDRIVE_API_TOKEN in Vercel project settings, then redeploy.</div>
            </div>
          </div>
        </div>
      )}

      <div style={styles.statsGrid}>
        <StatCard styles={styles} label="Active Pool" value={stats.ready} sub="In-ICP, ready for outreach" />
        <StatCard styles={styles} label="Customers" value={stats.customers} sub="Excluded from cold drafts" />
        <StatCard styles={styles} label="Pushed to PD" value={stats.pushed} sub={stats.pursueLaterDueCount > 0 ? `${stats.pursueLaterDueCount} pursue-later due` : 'This session'} />
        <StatCard styles={styles} label="Open Deals" value={stats.openDeals} sub={pdConnected ? `In ${pdMeta.defaultPipelineName}` : 'Not connected'} />
      </div>

      {pursueLaterDue.length > 0 && (
        <div style={{ ...styles.card, borderColor: 'rgba(251, 191, 36, 0.3)', background: 'rgba(251, 191, 36, 0.05)' }}>
          <div style={styles.sectionTitle}><RefreshCw size={14} /> Pursue Later — Revisit Time</div>
          <div style={{ fontSize: '13px', color: '#a8b5c9', marginBottom: '12px' }}>
            {pursueLaterDue.length} prospect{pursueLaterDue.length === 1 ? '' : 's'} {pursueLaterDue.length === 1 ? 'is' : 'are'} ready to revisit. Review and decide: re-activate, push the date, or mark dead.
          </div>
          {pursueLaterDue.slice(0, 5).map(p => (
            <ProspectRow key={p.id} styles={styles} prospect={p} researchData={researchData} pdRecords={pdRecords} researchProspect={researchProspect} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} />
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
        <div style={styles.grid3}>
          <ActionTile styles={styles} icon={Target} color="#ff6b85" title="Find Prospects" sub="Apollo search · Manual add · Filter pool" onClick={() => setView('find')} />
          <ActionTile styles={styles} icon={Compass} color="#fbbf24" title="View Clusters" sub={`${clusters.length} trip-worthy clusters`} onClick={() => setView('clusters')} />
          <ActionTile styles={styles} icon={BookOpen} color="#93b0d6" title="Sandler Coach" sub="Pain Funnel · UFC · Reversing" onClick={() => setView('coach')} />
        </div>
      </div>

      {topClusters.length > 0 && (
        <div style={styles.card}>
          <div style={styles.sectionTitle}><Compass size={14} /> Top Clusters by Trip Score</div>
          {topClusters.map(c => (
            <div key={c.county} style={{ padding: '10px 12px', borderBottom: '1px solid rgba(232, 236, 243, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{c.county} County</div>
                <div style={{ fontSize: '12px', color: '#7a8aa3' }}>
                  {c.size} prospects · {c.withEmail} with email · {Object.entries(c.bySegment).map(([s, n]) => `${n} ${s.replace(' Education', '').replace(' Government', ' Gov')}`).join(' · ')}
                </div>
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#fbbf24' }}>{c.tripScore}</div>
            </div>
          ))}
          <button style={{ ...styles.secondaryBtn, marginTop: '12px' }} onClick={() => setView('clusters')}>
            View all clusters <ArrowRight size={13} />
          </button>
        </div>
      )}

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Hash size={14} /> SHP Three Pillars</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {SHP_IDENTITY.pillars.map(p => (
            <div key={p} style={{ padding: '12px', background: 'rgba(200, 16, 46, 0.06)', borderLeft: '2px solid #C8102E', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}>
              {p}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function StatCard({ styles, label, value, sub }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statSub}>{sub}</div>
    </div>
  );
}

function ActionTile({ styles, icon: Icon, color, title, sub, onClick }) {
  return (
    <button style={{ ...styles.secondaryBtn, justifyContent: 'flex-start', padding: '20px', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }} onClick={onClick}>
      <Icon size={18} color={color} />
      <div style={{ fontWeight: 600, fontSize: '14px' }}>{title}</div>
      <div style={{ fontSize: '12px', color: '#7a8aa3', textAlign: 'left' }}>{sub}</div>
    </button>
  );
}

// =================================================================
// === FIND VIEW ===
// =================================================================
function FindView({ styles, apolloCriteria, setApolloCriteria, runApolloSearch, isApolloSearching, manualForm, setManualForm, addManualProspect, prospects, researchProspect, researchData, pdRecords, filterSegment, setFilterSegment, filterCounty, setFilterCounty, filterStatus, setFilterStatus, filterOutreach, setFilterOutreach, search, setSearch, totalProspects, markCustomer, markDead, markActive, openPursueLater, confirmDelete }) {
  const [findTab, setFindTab] = useState('pool');

  return (
    <>
      <div style={styles.pageTitle}>Find Prospects</div>
      <div style={styles.pageSubtitle}>{totalProspects} prospects in pool · {prospects.length} matching filters</div>

      <div style={{ ...styles.nav, marginBottom: '20px', display: 'inline-flex' }}>
        {[
          { id: 'pool', label: 'Browse Pool', count: totalProspects },
          { id: 'apollo', label: 'Apollo Search' },
          { id: 'manual', label: 'Manual Add' },
        ].map(t => (
          <button key={t.id} style={styles.navBtn(findTab === t.id)} onClick={() => setFindTab(t.id)}>
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {findTab === 'apollo' && (
        <div style={styles.card}>
          <div style={styles.sectionTitle}><Filter size={14} /> Apollo Search Criteria</div>
          <div style={{ marginBottom: '16px' }}>
            <label style={styles.label}>Job Titles</label>
            <input style={styles.input} value={apolloCriteria.titles} onChange={e => setApolloCriteria({ ...apolloCriteria, titles: e.target.value })} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={styles.label}>Segments</label>
            <input style={styles.input} value={apolloCriteria.segments} onChange={e => setApolloCriteria({ ...apolloCriteria, segments: e.target.value })} />
          </div>
          <div style={{ fontSize: '12px', color: '#7a8aa3', marginBottom: '14px', padding: '10px 12px', background: 'rgba(232, 236, 243, 0.04)', borderRadius: '6px' }}>
            Searches all 15 CFL North counties. Out-of-ICP results auto-filtered (healthcare, industrial, retail, multi-site CRE, residential, hospitality).
          </div>
          <button style={styles.primaryBtn} onClick={runApolloSearch} disabled={isApolloSearching}>
            {isApolloSearching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            {isApolloSearching ? 'Searching…' : 'Run Search'}
          </button>
        </div>
      )}

      {findTab === 'manual' && (
        <div style={styles.card}>
          <div style={styles.sectionTitle}><Plus size={14} /> Add a Prospect Manually</div>
          <div style={styles.grid2}>
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
            <div style={styles.sectionTitle}><Users size={14} /> Prospects ({prospects.length})</div>
            {prospects.slice(0, 50).map(p => (
              <ProspectRow key={p.id} styles={styles} prospect={p} researchData={researchData} pdRecords={pdRecords} researchProspect={researchProspect} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} />
            ))}
            {prospects.length > 50 && (
              <div style={{ textAlign: 'center', padding: '14px', fontSize: '12px', color: '#7a8aa3', fontStyle: 'italic' }}>
                Showing top 50 of {prospects.length}. Refine filters to narrow.
              </div>
            )}
            {prospects.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#7a8aa3', fontSize: '13px' }}>
                No prospects match your filters.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function ProspectRow({ styles, prospect, researchData, pdRecords, researchProspect, markCustomer, markDead, markActive, openPursueLater, confirmDelete }) {
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
    ? { ...styles.prospectCard, borderColor: 'rgba(34, 197, 94, 0.3)', background: 'rgba(34, 197, 94, 0.03)' }
    : isPursueLater
    ? { ...styles.prospectCard, borderColor: 'rgba(99, 130, 175, 0.3)' }
    : styles.prospectCard;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>{prospect.name || <span style={{ color: '#7a8aa3', fontStyle: 'italic' }}>(no contact name)</span>}</div>
            <span style={styles.badge(segmentBadgeColor(prospect.segment))}>{prospect.segment}</span>
            {isCustomer && <span style={styles.badge('green')}><CheckCircle2 size={10} /> Customer</span>}
            {isDead && <span style={styles.badge('gray')}>Dead</span>}
            {isPursueLater && <span style={styles.badge('navy')}>Pursue {prospect.revisitDate}</span>}
            {research && !isCustomer && !isDead && <span style={styles.badge('green')}><CheckCircle2 size={10} /> Fit {research.fitScore}</span>}
            {rec?.dealId && <span style={styles.badge('navy')}>PD #{rec.dealId}</span>}
            {rec?.sentAt && <span style={styles.badge('amber')}><Send size={10} /> Sent</span>}
          </div>
          <div style={{ fontSize: '12px', color: '#a8b5c9', marginBottom: '4px' }}>
            {prospect.title || <span style={{ fontStyle: 'italic' }}>(no title)</span>} · {prospect.company}
          </div>
          <div style={{ fontSize: '11px', color: '#7a8aa3', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <span><MapPin size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {prospect.city || '?'}, {prospect.county || '?'}</span>
            {prospect.email && <span><Mail size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {prospect.email}</span>}
            <span style={{ color: '#5a6b85' }}>· source: {prospect.source}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', position: 'relative' }}>
          {!isDead && !isCustomer && (
            <button style={styles.primaryBtn} onClick={() => researchProspect(prospect)}>
              {research ? 'Open' : 'Research'} <ArrowRight size={14} />
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
                <button style={{ ...styles.statusMenuItem, color: '#ff6b85' }} onClick={() => { confirmDelete(prospect); setMenuOpen(false); }}>
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
function ClustersView({ styles, clusters, researchProspect, researchData, pdRecords, markCustomer, markDead, markActive, openPursueLater, confirmDelete }) {
  const [expanded, setExpanded] = useState({});

  return (
    <>
      <div style={styles.pageTitle}>Clusters</div>
      <div style={styles.pageSubtitle}>Geographic pockets of in-ICP prospects ranked by trip score (size + reachable contacts).</div>

      {clusters.length === 0 ? (
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '40px', color: '#7a8aa3' }}>
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
                <div style={{ fontSize: '13px', color: '#a8b5c9', marginTop: '4px' }}>
                  {cluster.size} prospects · {cluster.withEmail} reachable by email · {Object.entries(cluster.bySegment).map(([s, n]) => `${n} ${s}`).join(' · ')}
                </div>
              </div>
              {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </div>
            {isOpen && (
              <div style={{ marginTop: '16px', borderTop: '1px solid rgba(232, 236, 243, 0.08)', paddingTop: '16px' }}>
                {cluster.prospects.slice(0, 20).map(p => (
                  <ProspectRow key={p.id} styles={styles} prospect={p} researchData={researchData} pdRecords={pdRecords} researchProspect={researchProspect} markCustomer={markCustomer} markDead={markDead} markActive={markActive} openPursueLater={openPursueLater} confirmDelete={confirmDelete} />
                ))}
                {cluster.prospects.length > 20 && (
                  <div style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#7a8aa3', fontStyle: 'italic' }}>
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
  return (
    <>
      <button style={{ ...styles.secondaryBtn, marginBottom: '16px' }} onClick={() => setView('find')}>← Back</button>
      <div style={styles.pageTitle}>{prospect.name || 'Unnamed contact'}</div>
      <div style={styles.pageSubtitle}>{prospect.title} · {prospect.company} · {prospect.city}, {prospect.county}</div>

      {isResearching ? (
        <div style={{ ...styles.card, textAlign: 'center', padding: '60px' }}>
          <Loader2 size={32} className="spin" style={{ color: '#ff6b85', marginBottom: '16px' }} />
          <div style={{ fontSize: '15px', fontWeight: 500 }}>Researching {prospect.company}…</div>
        </div>
      ) : research && (
        <>
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div style={styles.sectionTitle}><Sparkles size={14} /> AI Research</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '12px', color: '#7a8aa3' }}>Fit Score</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: research.fitScore > 75 ? '#4ade80' : '#fbbf24' }}>{research.fitScore}</div>
              </div>
            </div>

            <Section label="Company">{research.companySnapshot}</Section>
            <Section label="Facility Profile">{research.facilityProfile}</Section>

            <div style={{ marginBottom: '20px' }}>
              <SectionLabel>Pain Signals</SectionLabel>
              {research.painSignals.map((p, i) => (
                <div key={i} style={{ fontSize: '13px', lineHeight: '1.6', padding: '8px 12px', background: 'rgba(200, 16, 46, 0.06)', borderLeft: '2px solid #C8102E', borderRadius: '4px', marginBottom: '6px' }}>{p}</div>
              ))}
            </div>

            <Section label="Why This Fits SHP">{research.fitReasoning}</Section>

            <div style={{ padding: '16px', background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.15)', borderRadius: '10px' }}>
              <div style={{ fontSize: '11px', color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 600 }}>Suggested Opening</div>
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
  return <div style={{ fontSize: '11px', color: '#7a8aa3', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 500 }}>{children}</div>;
}

// =================================================================
// === COMPOSE VIEW ===
// =================================================================
function ComposeView({ styles, prospect, setProspect, draftEmail, setDraftEmail, isDrafting, draftOutreach, pushToPipedrive, sendViaOutlook, openInPipedrive, pdRecords, pdConnected, isPushing, config, setView, followUpDays }) {
  return (
    <>
      <button style={{ ...styles.secondaryBtn, marginBottom: '16px' }} onClick={() => setView('research')}>← Back</button>
      <div style={styles.pageTitle}>Review & Send</div>
      <div style={styles.pageSubtitle}>To: {prospect.email || <span style={{ color: '#fbbf24' }}>no email — add manually</span>}</div>

      {isDrafting ? (
        <div style={{ ...styles.card, textAlign: 'center', padding: '60px' }}>
          <Loader2 size={32} className="spin" style={{ color: '#ff6b85', marginBottom: '16px' }} />
          <div style={{ fontSize: '15px', fontWeight: 500 }}>Writing personalized email…</div>
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
            <button style={styles.secondaryBtn} onClick={draftOutreach}><Sparkles size={13} /> Regenerate</button>
          </div>

          <div style={styles.card}>
            <div style={styles.sectionTitle}><Briefcase size={14} /> Two-Step Send</div>
            <SendStep styles={styles} num="1" title="Push to Pipedrive" sub={`Creates Person + Org + Deal + Day ${followUpDays} resource follow-up activity`} done={!!pdRecords[prospect.id]?.dealId} disabled={!pdConnected} loading={isPushing} onClick={pushToPipedrive} btnLabel={pdRecords[prospect.id]?.dealId ? 'View Deal' : 'Push to PD'} icon={Briefcase} />
            <SendStep styles={styles} num="2" title="Open in Outlook to send" sub="Pre-fills Outlook web compose with this draft. Review one more time, click Send. M365↔Pipedrive sync auto-logs the email to the deal." done={!!pdRecords[prospect.id]?.sentAt} disabled={!prospect.email} loading={false} onClick={sendViaOutlook} btnLabel="Open in Outlook" icon={Send} />

            {pdRecords[prospect.id]?.dealId && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(232, 236, 243, 0.06)' }}>
                <div style={{ fontSize: '11px', color: '#7a8aa3', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Alternative</div>
                <button style={{ ...styles.secondaryBtn, fontSize: '12px' }} onClick={openInPipedrive}>
                  <ExternalLink size={12} /> Open deal in Pipedrive (compose there instead)
                </button>
              </div>
            )}

            <div style={{ marginTop: '14px', padding: '10px 12px', background: 'rgba(34, 197, 94, 0.06)', borderRadius: '8px', fontSize: '12px', color: '#4ade80', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>M365↔Pipedrive sync handles logging.</strong> Once you send from Outlook, the email auto-appears in the deal timeline. No Smart BCC required.
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
      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: done ? '#4ade80' : 'rgba(232, 236, 243, 0.1)', color: done ? '#0a1628' : '#a8b5c9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>{num}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: '12px', color: '#7a8aa3' }}>{sub}</div>
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
          <div style={styles.pageTitle}>Pipeline</div>
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
            <Briefcase size={32} style={{ color: '#7a8aa3', marginBottom: '12px' }} />
            <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '6px' }}>Pipedrive not connected</div>
            <button style={styles.primaryBtn} onClick={() => setView('settings')}><Key size={14} /> Settings</button>
          </div>
        </div>
      ) : (
        <div style={styles.pipelineGrid}>
          {pdMeta.stages.map(stage => (
            <div key={stage.id} style={styles.pipelineCol}>
              <div style={styles.pipelineHeader}>
                <span>{stage.name}</span>
                <span style={{ background: 'rgba(232, 236, 243, 0.08)', padding: '2px 8px', borderRadius: '10px', fontSize: '11px' }}>{(stageDeals[stage.id] || []).length}</span>
              </div>
              {(stageDeals[stage.id] || []).map(deal => (
                <div key={deal.id} style={styles.pipelineCard}>
                  <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '3px' }}>{deal.title}</div>
                  <div style={{ fontSize: '11px', color: '#7a8aa3', marginBottom: '6px' }}>{deal.org_name || ''}{deal.person_name ? ` · ${deal.person_name}` : ''}</div>
                  <a href={`https://app.pipedrive.com/deal/${deal.id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '10px', color: '#93b0d6', display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}>
                    <ExternalLink size={9} /> Open in PD
                  </a>
                </div>
              ))}
              {(stageDeals[stage.id] || []).length === 0 && (
                <div style={{ fontSize: '11px', color: '#5a6b85', textAlign: 'center', padding: '20px 8px', fontStyle: 'italic' }}>No deals</div>
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
      <div style={styles.pageTitle}>Sandler Coach</div>
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
                  <div style={{ fontSize: '15px', fontWeight: 700, color: level === 'level1' ? '#4ade80' : level === 'level2' ? '#fbbf24' : '#ff6b85' }}>{t.title}</div>
                  <div style={{ fontSize: '12px', color: '#a8b5c9', marginTop: '2px' }}>{t.purpose}</div>
                </div>
                <button style={{ ...styles.secondaryBtn, padding: '6px 12px', fontSize: '12px' }} onClick={() => copyToClipboard(t.questions.join('\n'))}>
                  <Copy size={11} /> Copy
                </button>
              </div>
              {t.questions.map((q, i) => (
                <div key={i} style={{ padding: '10px 12px', background: 'rgba(232, 236, 243, 0.04)', borderRadius: '6px', marginBottom: '6px', fontSize: '13px', lineHeight: '1.5' }}>
                  {q}
                </div>
              ))}
            </div>
          ))}

          <div style={{ ...styles.card, background: 'rgba(99, 130, 175, 0.08)', borderColor: 'rgba(99, 130, 175, 0.2)' }}>
            <div style={{ fontSize: '13px', color: '#93b0d6', display: 'flex', gap: '10px' }}>
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
              <pre style={{ background: 'rgba(10, 22, 40, 0.5)', padding: '14px', borderRadius: '8px', fontSize: '12px', lineHeight: '1.6', whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
                {template}
              </pre>
            </div>
          ))}
        </>
      )}

      {coachTab === 'reversing' && (
        <>
          <div style={{ ...styles.card, background: 'rgba(99, 130, 175, 0.08)', borderColor: 'rgba(99, 130, 175, 0.2)', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#93b0d6' }}>
              When a prospect replies with a vague brush-off, don't accept it at face value. Reverse it back to surface the real signal.
            </div>
          </div>
          {Object.entries(REVERSING_RESPONSES).map(([key, r]) => (
            <div key={key} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', color: '#fbbf24', fontWeight: 600 }}>When they say:</div>
                <button style={{ ...styles.secondaryBtn, padding: '6px 12px', fontSize: '12px' }} onClick={() => copyToClipboard(r.reversal)}>
                  <Copy size={11} /> Copy reversal
                </button>
              </div>
              <div style={{ fontSize: '14px', fontStyle: 'italic', color: '#c8d4e8', marginBottom: '14px', padding: '10px 12px', background: 'rgba(245, 158, 11, 0.06)', borderLeft: '2px solid #fbbf24', borderRadius: '4px' }}>
                "{r.pattern}"
              </div>
              <div style={{ fontSize: '13px', color: '#4ade80', fontWeight: 600, marginBottom: '6px' }}>You reverse with:</div>
              <div style={{ fontSize: '14px', padding: '12px', background: 'rgba(34, 197, 94, 0.06)', borderLeft: '2px solid #4ade80', borderRadius: '4px', marginBottom: '10px', lineHeight: '1.6' }}>
                {r.reversal}
              </div>
              <div style={{ fontSize: '12px', color: '#a8b5c9', fontStyle: 'italic' }}>
                <strong>Why it works:</strong> {r.why}
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
function SettingsView({ styles, config, setConfig, saveConfig, pdConnected, pdMeta, autoConnect, isConnecting, syncPipeline, isSyncing }) {
  return (
    <>
      <div style={styles.pageTitle}>Settings</div>
      <div style={styles.pageSubtitle}>Pipedrive token is set on the server (Vercel env vars). Other settings save to your browser.</div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Key size={14} /> Pipedrive Connection</div>
        <div style={{ padding: '14px', background: pdConnected ? 'rgba(34, 197, 94, 0.06)' : 'rgba(255, 107, 133, 0.06)', border: `1px solid ${pdConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 107, 133, 0.15)'}`, borderRadius: '10px', fontSize: '13px', marginBottom: '20px' }}>
          {pdConnected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#4ade80', fontWeight: 600 }}><CheckCircle2 size={14} /> Connected as {pdMeta.userName} ({pdMeta.userEmail})</div>
              <div style={{ color: '#a8b5c9', fontSize: '12px' }}>Pipeline: <strong>{pdMeta.defaultPipelineName}</strong></div>
              <div style={{ color: '#a8b5c9', fontSize: '12px', marginTop: '4px' }}>Stages: {pdMeta.stages.map(s => s.name).join(' → ')}</div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#ff6b85', fontWeight: 600 }}><AlertCircle size={14} /> Not connected</div>
              <div style={{ color: '#a8b5c9', fontSize: '12px' }}>Set <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>PIPEDRIVE_API_TOKEN</code> in Vercel project settings, then redeploy.</div>
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
        <div style={styles.grid2}>
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
          <div style={{ fontSize: '11px', color: '#7a8aa3', marginTop: '6px' }}>This exact text gets pasted at the bottom of every cold email draft. Edit freely.</div>
        </div>
        <button style={{ ...styles.primaryBtn, marginTop: '16px' }} onClick={saveConfig}>
          <CheckCircle2 size={14} /> Save Settings
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><Send size={14} /> Send Configuration</div>
        <div style={{ padding: '14px', background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.15)', borderRadius: '10px', fontSize: '13px', marginBottom: '16px', color: '#a8b5c9', lineHeight: '1.6' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', color: '#4ade80', fontWeight: 600 }}>
            <CheckCircle2 size={14} /> Microsoft 365 ↔ Pipedrive sync
          </div>
          When you click <strong>Open in Outlook</strong> on a draft, the email pre-fills in Outlook web. After you click Send in Outlook, your M365 ↔ Pipedrive sync auto-logs the email to the deal timeline. <strong>No Smart BCC required.</strong>
        </div>
        <div>
          <label style={styles.label}>Smart BCC (optional — only if you want belt-and-suspenders logging)</label>
          <input style={{ ...styles.input, fontFamily: 'monospace' }} placeholder="leave blank if M365 sync handles logging — or paste your Pipedrive Smart BCC address" value={config.smartBcc || ''} onChange={e => setConfig({ ...config, smartBcc: e.target.value })} />
          <div style={{ fontSize: '11px', color: '#7a8aa3', marginTop: '6px' }}>Find this in Pipedrive → Settings → Tools → BCC. Most users with M365 sync don't need it.</div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionTitle}><AlertCircle size={14} /> How it works</div>
        <div style={{ fontSize: '13px', color: '#c8d4e8', lineHeight: '1.7' }}>
          <div style={{ marginBottom: '10px' }}><strong>1. Find:</strong> Browse your seed pool (602 prospects), search Apollo for new ones, or add manually.</div>
          <div style={{ marginBottom: '10px' }}><strong>2. Research:</strong> Claude pulls company snapshot, facility profile, segment-specific pain signals, and an opening hook.</div>
          <div style={{ marginBottom: '10px' }}><strong>3. Draft:</strong> Anthony's voice — humble, peer-tone, "arrow in the quiver" framing — with contextually-relevant SHP customer references when they fit.</div>
          <div style={{ marginBottom: '10px' }}><strong>4. Review:</strong> Edit the draft in the agent. Regenerate if it's off.</div>
          <div style={{ marginBottom: '10px' }}><strong>5. Push to Pipedrive:</strong> Creates Person + Org + Deal + Day 14 follow-up activity.</div>
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
function PursueLaterModal({ styles, date, setDate, onSave, onCancel }) {
  return (
    <div style={styles.modalOverlay} onClick={onCancel}>
      <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Pursue Later</div>
        <div style={{ fontSize: '13px', color: '#a8b5c9', marginBottom: '20px' }}>
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
    <div style={styles.modalOverlay} onClick={onCancel}>
      <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Delete from pool?</div>
        <div style={{ fontSize: '13px', color: '#a8b5c9', marginBottom: '20px', lineHeight: '1.6' }}>
          This will remove <strong style={{ color: '#e8ecf3' }}>{prospect.name || prospect.company}</strong> from your prospect pool entirely. Pipedrive records (if any) are <strong>not</strong> affected — manage those in Pipedrive directly.
          <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(255, 107, 133, 0.08)', borderRadius: '6px', fontSize: '12px', color: '#ff6b85' }}>
            This action can't be undone from the agent. Re-importing the seed list won't restore deletions.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <button style={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
          <button style={{ ...styles.primaryBtn, background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }} onClick={onConfirm}>
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
      {toast.type === 'error' ? <AlertCircle size={16} color="#ff6b85" /> : <CheckCircle2 size={16} color={toast.type === 'info' ? '#93b0d6' : '#4ade80'} />}
      {toast.msg}
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      input:focus, textarea:focus, select:focus { border-color: rgba(200, 16, 46, 0.4) !important; }
      button:hover:not(:disabled) { transform: translateY(-1px); }
      button:active:not(:disabled) { transform: translateY(0); }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      code { font-family: 'SF Mono', Monaco, monospace; }
      /* Override the global hover lift for items inside the status dropdown */
      [data-status-menu] button:hover { transform: none !important; background: rgba(232, 236, 243, 0.08) !important; }
    `}</style>
  );
}

// =================================================================
// === HELPERS ===
// =================================================================
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
  return {
    container: { minHeight: '100vh', background: 'linear-gradient(180deg, #0a1628 0%, #0f1d35 100%)', color: '#e8ecf3', fontFamily: '"Inter", -apple-system, sans-serif' },
    header: { borderBottom: '1px solid rgba(232, 236, 243, 0.08)', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(10, 22, 40, 0.6)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 },
    logo: { display: 'flex', alignItems: 'center', gap: '12px' },
    logoMark: { width: '36px', height: '36px', background: 'linear-gradient(135deg, #C8102E 0%, #8b0a1f 100%)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px', letterSpacing: '0.5px', boxShadow: '0 4px 12px rgba(200, 16, 46, 0.3)' },
    logoText: { fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em' },
    logoSub: { fontSize: '11px', color: '#7a8aa3', letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: '2px' },
    nav: { display: 'flex', gap: '4px', background: 'rgba(232, 236, 243, 0.04)', padding: '4px', borderRadius: '10px' },
    navBtn: (active) => ({ padding: '8px 16px', borderRadius: '7px', fontSize: '13px', fontWeight: 500, background: active ? 'rgba(200, 16, 46, 0.15)' : 'transparent', color: active ? '#ff6b85' : '#a8b5c9', border: 'none', cursor: 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px' }),
    pdBadge: (connected) => ({ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, padding: '5px 10px', borderRadius: '6px', background: connected ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)', color: connected ? '#4ade80' : '#fbbf24', border: `1px solid ${connected ? 'rgba(34, 197, 94, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`, cursor: 'pointer' }),
    main: { padding: '32px', maxWidth: '1400px', margin: '0 auto' },
    pageTitle: { fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '6px' },
    pageSubtitle: { fontSize: '14px', color: '#7a8aa3', marginBottom: '24px' },
    statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' },
    statCard: { background: 'rgba(232, 236, 243, 0.03)', border: '1px solid rgba(232, 236, 243, 0.08)', borderRadius: '12px', padding: '20px' },
    statLabel: { fontSize: '12px', color: '#7a8aa3', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 },
    statValue: { fontSize: '32px', fontWeight: 700, letterSpacing: '-0.02em', marginTop: '8px' },
    statSub: { fontSize: '12px', color: '#5a6b85', marginTop: '4px' },
    card: { background: 'rgba(232, 236, 243, 0.03)', border: '1px solid rgba(232, 236, 243, 0.08)', borderRadius: '14px', padding: '24px', marginBottom: '16px' },
    sectionTitle: { fontSize: '13px', fontWeight: 600, color: '#a8b5c9', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' },
    input: { width: '100%', background: 'rgba(10, 22, 40, 0.6)', border: '1px solid rgba(232, 236, 243, 0.1)', borderRadius: '8px', padding: '10px 14px', color: '#e8ecf3', fontSize: '14px', fontFamily: 'inherit', outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' },
    label: { display: 'block', fontSize: '12px', color: '#a8b5c9', marginBottom: '6px', fontWeight: 500 },
    primaryBtn: { background: 'linear-gradient(135deg, #C8102E 0%, #a30d26 100%)', color: 'white', border: 'none', borderRadius: '9px', padding: '11px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(200, 16, 46, 0.25)', transition: 'all 0.15s' },
    secondaryBtn: { background: 'rgba(232, 236, 243, 0.06)', color: '#e8ecf3', border: '1px solid rgba(232, 236, 243, 0.12)', borderRadius: '9px', padding: '10px 18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s' },
    prospectCard: { background: 'rgba(232, 236, 243, 0.03)', border: '1px solid rgba(232, 236, 243, 0.08)', borderRadius: '10px', padding: '16px', marginBottom: '8px', transition: 'all 0.15s' },
    badge: (color) => {
      const colors = {
        red: { bg: 'rgba(200, 16, 46, 0.15)', text: '#ff6b85', border: 'rgba(200, 16, 46, 0.3)' },
        green: { bg: 'rgba(34, 197, 94, 0.12)', text: '#4ade80', border: 'rgba(34, 197, 94, 0.25)' },
        amber: { bg: 'rgba(245, 158, 11, 0.12)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.25)' },
        navy: { bg: 'rgba(99, 130, 175, 0.12)', text: '#93b0d6', border: 'rgba(99, 130, 175, 0.25)' },
        purple: { bg: 'rgba(168, 85, 247, 0.12)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.25)' },
        gray: { bg: 'rgba(156, 163, 175, 0.12)', text: '#9ca3af', border: 'rgba(156, 163, 175, 0.25)' },
      }[color] || { bg: 'rgba(99, 130, 175, 0.12)', text: '#93b0d6', border: 'rgba(99, 130, 175, 0.25)' };
      return { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, textTransform: 'uppercase', letterSpacing: '0.04em' };
    },
    pipelineGrid: { display: 'grid', gridTemplateColumns: `repeat(${Math.max(stagesLen, 1)}, 1fr)`, gap: '12px' },
    pipelineCol: { background: 'rgba(232, 236, 243, 0.03)', border: '1px solid rgba(232, 236, 243, 0.08)', borderRadius: '12px', padding: '14px', minHeight: '320px' },
    pipelineHeader: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#a8b5c9', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    pipelineCard: { background: 'rgba(10, 22, 40, 0.6)', border: '1px solid rgba(232, 236, 243, 0.06)', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px', fontSize: '12px' },
    toast: { position: 'fixed', bottom: '24px', right: '24px', background: 'rgba(10, 22, 40, 0.95)', border: '1px solid rgba(232, 236, 243, 0.15)', borderRadius: '10px', padding: '12px 18px', fontSize: '13px', fontWeight: 500, backdropFilter: 'blur(12px)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 100, maxWidth: '420px' },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
    grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
    statusMenu: { position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'rgba(10, 22, 40, 0.98)', border: '1px solid rgba(232, 236, 243, 0.12)', borderRadius: '10px', padding: '6px', minWidth: '210px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)', zIndex: 100 },
    statusMenuItem: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: '#e8ecf3', fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' },
    modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
    modalCard: { background: 'linear-gradient(180deg, #0f1d35 0%, #0a1628 100%)', border: '1px solid rgba(232, 236, 243, 0.15)', borderRadius: '14px', padding: '28px', maxWidth: '460px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' },
  };
}
