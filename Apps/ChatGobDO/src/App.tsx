import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  BookOpen,
  Layers,
  ShieldCheck,
  Scale,
  Clock,
  Activity,
  ExternalLink,
  Sparkles,
  Bookmark,
  Trash2,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  FileText,
  RefreshCw,
  Info,
  Sliders,
  ChevronRight,
  Database,
  Settings as SettingsIcon,
  X,
  Radio,
  Landmark,
  Newspaper,
  MessageSquare
} from "lucide-react";
import { AgentStage, Source, SearchResult, SavedTopic } from "./types";

// Standard DR Government URLs reference
import { CATEGORY_LABELS, DR_PORTALS as DR_PORTALS_LEGACY } from "./portals";

// Dynamically-discovered institution plugins (from the backend registry).
interface InstitutionDescriptor {
  id: string;
  name: string;
  description?: string;
  url: string;
  enabledByDefault: boolean;
  hasLegislative: boolean;
}

export default function App() {
  const [institutions, setInstitutions] = useState<InstitutionDescriptor[]>([]);
  const [query, setQuery] = useState("");
  const [selectedInstitutions, setSelectedInstitutions] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchResult[]>([]);
  const [savedWatchlists, setSavedWatchlists] = useState<SavedTopic[]>([]);
  const [activeResult, setActiveResult] = useState<SearchResult | null>(null);
  const [activeTab, setActiveTab] = useState<"sources" | "brief" | "evidence" | "timeline" | "validation" | "citations">("sources");
  const [currentStageIdx, setCurrentStageIdx] = useState(-1);
  const [evidenceFilter, setEvidenceFilter] = useState("");
  const [apiError, setApiError] = useState<{ error: string; message: string } | null>(null);

  // Context-grounded chat (below the Audit Evidence Packet)
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the chat to the latest message.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"ai" | "search" | "theme">("ai");
  const [theme, setTheme] = useState<"default" | "dark" | "dominican">("default");
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("gemini-3.1-flash-lite");
  const [apiKey, setApiKey] = useState("");
  const [responseLang, setResponseLang] = useState("es");

  // Search settings (SearXNG parameters)
  const [searchLang, setSearchLang] = useState("es");
  const [searchCategory, setSearchCategory] = useState("general");
  const [searchMaxResults, setSearchMaxResults] = useState(8);
  const [searchSafe, setSearchSafe] = useState(false);
  const [searchTimeRange, setSearchTimeRange] = useState("");
  const [searchEngines, setSearchEngines] = useState("");

  // Portal URL Tree state
  const [urlTree, setUrlTree] = useState<any[] | null>(null);
  const [urlTreeLoading, setUrlTreeLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  // Selected trees (portal refId or section key). Empty = use all.
  const [selectedTrees, setSelectedTrees] = useState<Set<string>>(new Set());

  // Dynamically load the institution registry from the backend so the UI never
  // needs a code change when institutions are added/removed.
  useEffect(() => {
    fetch("/api/institutions")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.institutions)) setInstitutions(data.institutions);
      })
      .catch((e) => console.error("Failed to load institutions", e));
  }, []);

  // Model catalogue per provider
  const PROVIDER_MODELS: Record<string, string[]> = {
    gemini: [
      "gemini-3.1-pro",
      "gemini-3.5-flash",
      "gemini-3-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-1.5-pro",
      "gemini-1.5-flash"
    ],
    openai: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo",
      "gpt-4",
      "gpt-3.5-turbo",
      "o1",
      "o1-mini",
      "o3-mini"
    ],
    anthropic: [
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307"
    ]
  };

  // Watchlist custom creation state
  const [isCreatingWatch, setIsCreatingWatch] = useState(false);
  const [newWatchTitle, setNewWatchTitle] = useState("");
  const [newWatchKeywords, setNewWatchKeywords] = useState("");

  // Agent Pipeline States
  const [agentStages, setAgentStages] = useState<AgentStage[]>([
    { name: "planner", label: "Planner", status: "idle", description: "Decomposing query, assessing legal scope..." },
    { name: "institution", label: "Institution", status: "idle", description: "Filtering relevant governmental targets..." },
    { name: "search", label: "Search", status: "idle", description: "Launching targeted Google Search grounding..." },
    { name: "retrieval", label: "Retrieval", status: "idle", description: "Extracting official pages and candidate files..." },
    { name: "evidence", label: "Evidence", status: "idle", description: "Harvesting objective facts, articles, and dates..." },
    { name: "validation", label: "Validation", status: "idle", description: "Resolving conflicts, checking authority rank..." },
    { name: "refinement", label: "Refinement", status: "idle", description: "Assembling high-density legal synthesis..." },
    { name: "response", label: "Response", status: "idle", description: "Formulating timeline, citations, and briefs..." }
  ]);

  // Load state from LocalStorage on mount
  useEffect(() => {
    try {
      const storedSettings = localStorage.getItem("dr_gov_intel_settings");
      if (storedSettings) {
        const s = JSON.parse(storedSettings);
        setProvider(s.provider ?? "gemini");
        setModel(s.model ?? "gemini-3.1-flash-lite");
        setApiKey(s.apiKey ?? "");
        setResponseLang(s.responseLang ?? "es");
        setSearchLang(s.searchLang ?? "es");
        setSearchCategory(s.searchCategory ?? "general");
        setSearchMaxResults(s.searchMaxResults ?? 8);
        setSearchSafe(s.searchSafe ?? false);
        setSearchTimeRange(s.searchTimeRange ?? "");
        setSearchEngines(s.searchEngines ?? "");
        setTheme(s.theme ?? "default");
      }

      const storedHistory = localStorage.getItem("dr_gov_intel_history");
      if (storedHistory) {
        const parsed = JSON.parse(storedHistory).map((r: any, i: number) => ({ ...r, id: r.id || `r_${r.timestamp}_${i}` }));
        setSearchHistory(parsed);
        if (parsed.length > 0) {
          setActiveResult(parsed[0]);
        }
      }

      const storedWatch = localStorage.getItem("dr_gov_intel_watchlist");
      if (storedWatch) {
        setSavedWatchlists(JSON.parse(storedWatch));
      } else {
        // Seed default watchlists
        const defaultWatch: SavedTopic[] = [
          {
            id: "w1",
            title: "Reforma Fiscal y Presupuesto",
            keywords: ["reforma fiscal", "paquete impositivo", "presupuesto nacional"],
            lastChecked: "2026-07-16T10:00:00Z",
            status: "Monitoreando",
            alertsCount: 2
          },
          {
            id: "w2",
            title: "Ley de Drogas 50-88",
            keywords: ["ley 50-88", "sustancias controladas", "reforma penal"],
            lastChecked: "2026-07-15T15:30:00Z",
            status: "Estable",
            alertsCount: 0
          },
          {
            id: "w3",
            title: "Compras Públicas - DGCP",
            keywords: ["compras gubernamentales", "licitaciones", "ley 340-06"],
            lastChecked: "2026-07-16T08:15:00Z",
            status: "Actualización Reciente",
            alertsCount: 1
          }
        ];
        setSavedWatchlists(defaultWatch);
        localStorage.setItem("dr_gov_intel_watchlist", JSON.stringify(defaultWatch));
      }
    } catch (e) {
      console.error("Error reading localStorage:", e);
    }
  }, []);

  // Apply theme to <html> so global CSS can target it
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-default", "theme-dark", "theme-dominican");
    root.classList.add(`theme-${theme}`);
  }, [theme]);

  // Save history to LocalStorage
  const saveToHistory = (newHistory: SearchResult[]) => {
    try {
      const normalized = newHistory.map((r, i) => ({ ...r, id: (r as any).id || `r_${(r as any).timestamp}_${i}` }));
      setSearchHistory(normalized);
      localStorage.setItem("dr_gov_intel_history", JSON.stringify(normalized));
    } catch (e) {
      console.error("Error saving history:", e);
    }
  };

  // Toggle institutions selection
  const handleToggleInstitution = (instName: string) => {
    setSelectedInstitutions(prev =>
      prev.includes(instName) ? prev.filter(i => i !== instName) : [...prev, instName]
    );
  };

  // Core backend call to /api/query. Returns the intel response WITHOUT touching
  // the main UI (no history, no active tab switch). Used both by the normal
  // console search and by background watchlist checks, so each flow controls
  // its own side effects.
  const runIntelQuery = async (searchQuery: string, institutions: string[] = []): Promise<any> => {
    const response = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: searchQuery,
        institutions,
        model: model || undefined,
        apiKey: apiKey || undefined,
        responseLang,
        search: {
          lang: searchLang,
          category: searchCategory,
          maxResults: searchMaxResults,
          safe: searchSafe,
          timeRange: searchTimeRange || undefined,
          engines: searchEngines || undefined
        }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || data.error || "Failed to process government query");
    }
    return data;
  };

  // Context-grounded chat: user asks follow-ups about the active AUDIT EVIDENCE
  // PACKET; the backend answers strictly from the retrieved result.
  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading || !activeResult) return;
    const history = chatMessages;
    const next = [...history, { role: "user" as const, content: text }];
    setChatMessages(next);
    setChatInput("");
    setChatLoading(true);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: activeResult,
          message: text,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          apiKey: apiKey || undefined,
          model: model || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || data.error || "Chat failed");
      setChatMessages([...next, { role: "assistant" as const, content: data.reply || "Sin respuesta." }]);
    } catch (e: any) {
      setChatMessages([...next, { role: "assistant" as const, content: `⚠️ ${e.message || "Error al contactar el asistente."}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Run the retrieval query
  const handleRunQuery = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setApiError(null);
    setCurrentStageIdx(0);

    // Reset stages
    setAgentStages(stages =>
      stages.map((stage, index) => ({
        ...stage,
        status: index === 0 ? "running" : "idle"
      }))
    );

    // Dynamic timer to simulate reasoning stage advancements for the user
    const stageInterval = setInterval(() => {
      setCurrentStageIdx(prevIdx => {
        const nextIdx = prevIdx + 1;
        if (nextIdx < agentStages.length) {
          setAgentStages(stages =>
            stages.map((stage, idx) => {
              if (idx === prevIdx) return { ...stage, status: "completed" };
              if (idx === nextIdx) return { ...stage, status: "running" };
              return stage;
            })
          );
          return nextIdx;
        } else {
          clearInterval(stageInterval);
          return prevIdx;
        }
      });
    }, 1200);

    try {
      // Determine target institutions: any selection in the Árbol de URLs
      // (portal OR section) restricts the search to those portals only. Then
      // the "Fijar Instituciones" selection is also respected. Anything
      // selected => the server filters results BEFORE the AI sees them.
      let effectiveInstitutions = selectedInstitutions;
      if (selectedTrees.size > 0) {
        const selectedRefs = new Set<string>();
        for (const k of selectedTrees) {
          // Section keys look like "refId:category:label" — resolve to portal refId.
          const refId = k.includes(":") ? k.split(":")[0] : k;
          selectedRefs.add(refId);
        }
        // Resolve selected trees to institution names via the dynamic registry.
        const matched = institutions.filter((p) => selectedRefs.has(p.id));
        if (matched.length > 0) {
          effectiveInstitutions = matched.map((p) => p.name);
        }
      }

      const data = await runIntelQuery(searchQuery, effectiveInstitutions);

      // Query completed successfully. Set all stages to completed
      clearInterval(stageInterval);
      setAgentStages(stages => stages.map(stage => ({ ...stage, status: "completed" })));
      setCurrentStageIdx(-1);

      // Save result and select it
      const resultWithId = { ...data, id: `r_${data.timestamp}_0` };
      const updatedHistory = [resultWithId, ...searchHistory.filter(h => h.query.toLowerCase() !== searchQuery.toLowerCase())].slice(0, 30);
      saveToHistory(updatedHistory);
      setActiveResult(resultWithId);
      setChatMessages([]);
      setActiveTab("brief");
      setQuery("");

    } catch (err: any) {
      clearInterval(stageInterval);
      setAgentStages(stages => stages.map(stage => stage.status === "running" ? { ...stage, status: "failed" } : stage));
      setCurrentStageIdx(-1);
      
      const isMissingKey = err.message.includes("GEMINI_API_KEY") || err.message.includes("Missing API Key");
      setApiError({
        error: isMissingKey ? "Missing API Key Configuration" : "Retrieval Loop Interrupted",
        message: err.message || "An unexpected error occurred during multi-agent analysis."
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Saved Watchlist triggers
  const handleAddWatchlist = () => {
    if (!newWatchTitle.trim()) return;
    const kw = newWatchKeywords.split(",").map(k => k.trim()).filter(Boolean);
    const newItem: SavedTopic = {
      id: "w_" + Date.now(),
      title: newWatchTitle,
      keywords: kw.length > 0 ? kw : [newWatchTitle.toLowerCase()],
      lastChecked: new Date().toISOString(),
      status: "Monitoreando",
      alertsCount: 0
    };
    const updated = [newItem, ...savedWatchlists];
    setSavedWatchlists(updated);
    localStorage.setItem("dr_gov_intel_watchlist", JSON.stringify(updated));
    setNewWatchTitle("");
    setNewWatchKeywords("");
    setIsCreatingWatch(false);
  };

  const handleDeleteWatchlist = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedWatchlists.filter(w => w.id !== id);
    setSavedWatchlists(updated);
    localStorage.setItem("dr_gov_intel_watchlist", JSON.stringify(updated));
  };

  // Background check for a single watchlist item. Runs the same intel query but
  // does NOT touch the main console/search UI — it updates only that watchlist
  // card in the background and persists the result for later review.
  const handleTriggerWatchCheck = async (topic: SavedTopic) => {
    // Mark as verifying (without affecting the rest of the UI)
    setSavedWatchlists((prev) =>
      prev.map((w) => (w.id === topic.id ? { ...w, status: "Verificando…" } : w))
    );

    try {
      const terms = [topic.title, ...topic.keywords].filter(Boolean);
      const q = `Últimos acontecimientos, leyes y reglamentos respecto a: ${terms.join(", ")}`;
      const data = await runIntelQuery(q, topic.institutionFilter || []);

      const updated = savedWatchlists.map((w) =>
        w.id === topic.id
          ? {
              ...w,
              lastChecked: new Date().toISOString(),
              status: "Actualizado",
              alertsCount: (data?.response?.citations?.length || data?.sources?.length) ? 1 : 0,
              lastResult: data,
            }
          : w
      );
      setSavedWatchlists(updated);
      localStorage.setItem("dr_gov_intel_watchlist", JSON.stringify(updated));
    } catch (err: any) {
      const updated = savedWatchlists.map((w) =>
        w.id === topic.id ? { ...w, status: "Error" } : w
      );
      setSavedWatchlists(updated);
      localStorage.setItem("dr_gov_intel_watchlist", JSON.stringify(updated));
    }
  };

  const handleDeleteHistory = (timestamp: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = searchHistory.filter(h => h.timestamp !== timestamp);
    saveToHistory(updated);
    if (activeResult?.timestamp === timestamp) {
      setActiveResult(updated.length > 0 ? updated[0] : null);
    }
  };

  // Build / fetch the portal URL tree
  const handleLoadUrlTree = async (refresh = false) => {
    setUrlTreeLoading(true);
    try {
      // If institutions are selected in "Fijar Instituciones", process only those;
      // otherwise process all sources.
      const portalParam = selectedInstitutions.length > 0
        ? `&portals=${encodeURIComponent(selectedInstitutions.join(","))}`
        : "";
      const resp = await fetch(`/api/url-tree${refresh ? "?refresh=1" : ""}${portalParam}`);
      const data = await resp.json();
      if (data.portals) {
        setUrlTree(data.portals);
        setSelectedTrees(new Set());
      }
    } catch (e) {
      console.error("URL tree load failed", e);
    } finally {
      setUrlTreeLoading(false);
    }
  };

  // Reset the URL tree whenever the institution selection changes.
  useEffect(() => {
    setUrlTree(null);
    setExpandedNodes(new Set());
  }, [selectedInstitutions]);

  const toggleNode = (key: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleTreeSel = (key: string) => {
    setSelectedTrees(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Resolve which portals/sections are active: if any selected, use only those.
  const activeTreeKeys = selectedTrees.size > 0 ? selectedTrees : null;

  // Render a categorized portal tree (department -> category -> urls) with selectors
  const renderUrlTree = (portals: any[]) => {
    return portals.map((portal) => {
      const portalOpen = expandedNodes.has(portal.refId) || expandedNodes.has("all");
      const portalSel = activeTreeKeys ? activeTreeKeys.has(portal.refId) : true;
      return (
        <div key={portal.refId} className={`border p-2 ${portalSel ? "border-[#141414] bg-[#E4E3E0]/30" : "border-[#141414]/40"}`}>
          <div className="flex items-center justify-between w-full">
            <label className="flex items-center gap-2 cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={portalSel}
                onChange={() => toggleTreeSel(portal.refId)}
                className="h-3.5 w-3.5 accent-[#E94E31]"
              />
              <span className="text-[10px] font-black uppercase tracking-wider text-[#141414]">{portal.name}</span>
            </label>
            <button onClick={() => toggleNode(portal.refId)} className="text-[9px] font-mono text-slate-500 px-1">
              {portalOpen ? "−" : "+"} {portal.total}
            </button>
          </div>
          {portalOpen && (
            <div className="border-t border-[#141414]/15 pt-1 mt-1 space-y-2">
              {portal.sections.map((sec: any) => {
                const secKey = `${portal.refId}:${sec.category}:${sec.label}`;
                const secOpen = expandedNodes.has(secKey);
                const secSel = activeTreeKeys ? activeTreeKeys.has(secKey) : true;
                const catLabel = (CATEGORY_LABELS as Record<string, string>)[sec.category] || sec.category;
                return (
                  <div key={secKey}>
                    <div className="flex items-center justify-between w-full">
                      <label className="flex items-center gap-2 cursor-pointer flex-1 py-0.5">
                        <input
                          type="checkbox"
                          checked={secSel}
                          onChange={() => toggleTreeSel(secKey)}
                          className="h-3 w-3 accent-[#E94E31]"
                        />
                        <span className="text-[10px] font-bold text-[#E94E31]">
                          {catLabel} · {sec.label}
                        </span>
                      </label>
                      <button onClick={() => toggleNode(secKey)} className="text-[9px] font-mono text-slate-500 px-1">
                        {secOpen ? "−" : "+"} {sec.count}
                      </button>
                    </div>
                    {secOpen && (
                      <div className="pl-5 space-y-0.5 mt-0.5">
                        {sec.urls.map((u: any) => (
                          <a
                            key={u.url}
                            href={u.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-[10px] text-[#141414] hover:text-[#E94E31] hover:underline break-all leading-snug"
                            title={u.title || u.url}
                          >
                            {u.title ? u.title : u.url.replace(/^https?:\/\//, "")}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };


  // Helper to render customized confidence badge
  const getConfidenceBadge = (level: "High" | "Medium" | "Low") => {
    const colors = {
      High: "bg-[#141414] text-white border-brand-accent",
      Medium: "bg-[#141414] text-[#E4E3E0] border-[#141414]/55",
      Low: "bg-white text-brand-accent border-brand-accent"
    };
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-black uppercase tracking-widest border-2 shadow-[2px_2px_0px_0px_#141414] ${colors[level] || colors.Medium}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${level === "High" ? "bg-[#E94E31]" : level === "Medium" ? "bg-amber-400" : "bg-red-500"}`} />
        CONFIANZA: {level}
      </span>
    );
  };

  // Inline Markdown parser and custom styled element builder
  function parseMarkdown(text: string) {
    if (!text) return null;
    const lines = text.split("\n");
    return lines.map((line, idx) => {
      if (line.startsWith("### ")) {
        return <h4 key={idx} className="text-xs font-black uppercase tracking-wider text-[#141414] mt-5 mb-2 font-display">{line.replace("### ", "")}</h4>;
      }
      if (line.startsWith("## ")) {
        return <h3 key={idx} className="text-sm font-black uppercase text-[#141414] mt-6 mb-2 pb-1 border-b border-[#141414] font-display">{line.replace("## ", "")}</h3>;
      }
      if (line.startsWith("# ")) {
        return <h2 key={idx} className="text-base font-black uppercase text-[#E94E31] mt-7 mb-3 font-display">{line.replace("# ", "")}</h2>;
      }
      if (line.startsWith("> ")) {
        return <blockquote key={idx} className="border-l-4 border-[#141414] pl-4 py-2 my-4 text-[#141414] italic font-serif bg-white/40 text-xs leading-relaxed">{line.replace("> ", "")}</blockquote>;
      }
      if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        const cleanLine = line.trim().replace(/^[-*]\s+/, "");
        return (
          <li key={idx} className="ml-5 list-disc text-xs text-[#141414] mb-1.5 leading-relaxed">
            {renderInlineMarkdown(cleanLine)}
          </li>
        );
      }
      if (/^\d+\.\s+/.test(line.trim())) {
        const cleanLine = line.trim().replace(/^\d+\.\s+/, "");
        return (
          <li key={idx} className="ml-5 list-decimal text-xs text-[#141414] mb-1.5 leading-relaxed font-sans">
            {renderInlineMarkdown(cleanLine)}
          </li>
        );
      }
      if (!line.trim()) {
        return <div key={idx} className="h-3" />;
      }
      return <p key={idx} className="text-xs text-[#141414] mb-2 leading-relaxed font-sans">{renderInlineMarkdown(line)}</p>;
    });
  }

  function renderInlineMarkdown(text: string) {
    const boldRegex = /\*\*(.*?)\*\*/g;
    let match;
    let lastIndex = 0;
    const elements: React.ReactNode[] = [];
    let keyIdx = 0;

    const processLinks = (str: string) => {
      const linkRegex = /\[(.*?)\]\((.*?)\)/g;
      let lMatch;
      let lLastIndex = 0;
      const innerElements: React.ReactNode[] = [];

      while ((lMatch = linkRegex.exec(str)) !== null) {
        if (lMatch.index > lLastIndex) {
          innerElements.push(str.substring(lLastIndex, lMatch.index));
        }
        innerElements.push(
          <a
            key={`link-${keyIdx++}`}
            href={lMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#E94E31] hover:text-[#141414] underline font-bold inline-flex items-center gap-0.5"
          >
            {lMatch[1]}
            <ExternalLink className="h-3 w-3 inline" />
          </a>
        );
        lLastIndex = linkRegex.lastIndex;
      }
      if (lLastIndex < str.length) {
        innerElements.push(str.substring(lLastIndex));
      }
      return innerElements.length > 0 ? innerElements : [str];
    };

    while ((match = boldRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        elements.push(...processLinks(text.substring(lastIndex, match.index)));
      }
      elements.push(
        <strong key={`bold-${keyIdx++}`} className="font-extrabold text-[#141414]">
          {match[1]}
        </strong>
      );
      lastIndex = boldRegex.lastIndex;
    }
    if (lastIndex < text.length) {
      elements.push(...processLinks(text.substring(lastIndex)));
    }

    return elements.length > 0 ? elements : text;
  }

  // Filter evidence based on input search
  const filteredEvidence = activeResult?.evidence.filter(ev =>
    ev.fact.toLowerCase().includes(evidenceFilter.toLowerCase()) ||
    ev.institution.toLowerCase().includes(evidenceFilter.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex flex-col text-[#141414] antialiased font-sans pb-12">
      
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-[#141414]/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-[#141414] w-full max-w-lg p-6 shadow-[8px_8px_0px_0px_#141414]">
            <div className="flex items-center justify-between mb-6 border-b-2 border-[#141414] pb-4">
              <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                <SettingsIcon className="h-6 w-6 text-[#E94E31]" />
                Configuración
              </h2>
              <button onClick={() => setIsSettingsOpen(false)} className="p-1 hover:bg-[#E4E3E0]">
                <X className="h-6 w-6" />
              </button>
            </div>
            
            {/* Tab Navigation */}
            <div className="flex border-2 border-[#141414] mb-5">
              <button
                onClick={() => setSettingsTab("ai")}
                className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest transition-colors ${
                  settingsTab === "ai" ? "bg-[#141414] text-white" : "bg-white text-[#141414] hover:bg-[#E4E3E0]"
                }`}
              >
                IA / Modelo
              </button>
              <button
                onClick={() => setSettingsTab("search")}
                className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest border-l-2 border-[#141414] transition-colors ${
                  settingsTab === "search" ? "bg-[#141414] text-white" : "bg-white text-[#141414] hover:bg-[#E4E3E0]"
                }`}
              >
                Búsqueda
              </button>
              <button
                onClick={() => setSettingsTab("theme")}
                className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest border-l-2 border-[#141414] transition-colors ${
                  settingsTab === "theme" ? "bg-[#141414] text-white" : "bg-white text-[#141414] hover:bg-[#E4E3E0]"
                }`}
              >
                Tema
              </button>
            </div>

            <div className="space-y-4">
              {settingsTab === "ai" && (
                <>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Proveedor de IA</label>
                    <select
                      value={provider}
                      onChange={(e) => {
                        const p = e.target.value;
                        setProvider(p);
                        setModel(PROVIDER_MODELS[p][0]);
                      }}
                      className="w-full p-2 border-2 border-[#141414] text-sm"
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Modelo</label>
                    <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full p-2 border-2 border-[#141414] text-sm">
                      {(PROVIDER_MODELS[provider] || []).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-1">API Key</label>
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full p-2 border-2 border-[#141414] text-sm" placeholder="••••••••••••••••" />
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Idioma de respuesta</label>
                    <select value={responseLang} onChange={(e) => setResponseLang(e.target.value)} className="w-full p-2 border-2 border-[#141414] text-sm">
                      <option value="es">Español</option>
                      <option value="en">English</option>
                      <option value="fr">Français</option>
                      <option value="pt">Português</option>
                      <option value="it">Italiano</option>
                      <option value="de">Deutsch</option>
                    </select>
                  </div>
                </>
              )}

              {settingsTab === "search" && (
                <>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Idioma (SearXNG)</label>
                    <select value={searchLang} onChange={(e) => setSearchLang(e.target.value)} className="w-full p-2 border-2 border-[#141414] text-sm">
                      <option value="es">Español</option>
                      <option value="en">Inglés</option>
                      <option value="fr">Francés</option>
                      <option value="pt">Portugués</option>
                      <option value="it">Italiano</option>
                      <option value="de">Alemán</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Categoría</label>
                    <select value={searchCategory} onChange={(e) => setSearchCategory(e.target.value)} className="w-full p-2 border-2 border-[#141414] text-sm">
                      <option value="general">General</option>
                      <option value="news">Noticias</option>
                      <option value="science">Ciencia</option>
                      <option value="files">Archivos</option>
                      <option value="images">Imágenes</option>
                      <option value="videos">Videos</option>
                      <option value="it">Tecnología</option>
                      <option value="social media">Redes Sociales</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Máx. resultados por consulta: {searchMaxResults}</label>
                    <input
                      type="range"
                      min={3}
                      max={20}
                      value={searchMaxResults}
                      onChange={(e) => setSearchMaxResults(Number(e.target.value))}
                      className="w-full accent-[#E94E31]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Rango de tiempo</label>
                    <select value={searchTimeRange} onChange={(e) => setSearchTimeRange(e.target.value)} className="w-full p-2 border-2 border-[#141414] text-sm">
                      <option value="">Cualquiera</option>
                      <option value="day">Último día</option>
                      <option value="week">Última semana</option>
                      <option value="month">Último mes</option>
                      <option value="year">Último año</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Motores (separados por coma, opcional)</label>
                    <input
                      type="text"
                      value={searchEngines}
                      onChange={(e) => setSearchEngines(e.target.value)}
                      placeholder="Ej. google, bing, duckduckgo, wikipedia"
                      className="w-full p-2 border-2 border-[#141414] text-sm font-mono"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={searchSafe}
                      onChange={(e) => setSearchSafe(e.target.checked)}
                      className="h-4 w-4 accent-[#E94E31]"
                    />
                    <span className="text-xs font-black uppercase">Búsqueda segura (filtrar contenido)</span>
                  </label>
                </>
              )}

              {settingsTab === "theme" && (
                <div className="space-y-3">
                  <p className="text-xs font-black uppercase text-slate-500 mb-2">Selecciona un tema visual</p>
                  {([
                    { id: "default", name: "Por defecto", desc: "Claro brutalista actual", swatch: ["#E4E3E0", "#141414", "#E94E31"] },
                    { id: "dark", name: "Oscuro", desc: "Fondo negro, acento naranja", swatch: ["#141414", "#E4E3E0", "#E94E31"] },
                    { id: "dominican", name: "Dominicano", desc: "Azul y rojo RD sobre claro", swatch: ["#002D62", "#CE1126", "#FFFFFF"] },
                  ] as const).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={`w-full flex items-center justify-between p-3 border-2 transition-all ${
                        theme === t.id
                          ? "border-[#141414] bg-[#E4E3E0] shadow-[3px_3px_0px_0px_#E94E31]"
                          : "border-slate-300 hover:border-[#141414]"
                      }`}
                    >
                      <div className="text-left">
                        <p className="text-sm font-black uppercase tracking-tight">{t.name}</p>
                        <p className="text-[10px] text-slate-500 uppercase">{t.desc}</p>
                      </div>
                      <div className="flex gap-1">
                        {t.swatch.map((c, i) => (
                          <span key={i} className="h-5 w-5 border border-[#141414]" style={{ background: c }} />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <button 
                onClick={() => {
                  localStorage.setItem("dr_gov_intel_settings", JSON.stringify({
                    provider, model, apiKey, responseLang,
                    searchLang, searchCategory, searchMaxResults,
                    searchSafe, searchTimeRange, searchEngines, theme
                  }));
                  setIsSettingsOpen(false);
                }}
                className="w-full bg-[#141414] text-white py-3 font-black uppercase hover:bg-[#E94E31] transition-colors"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brutalist Top Professional Header */}
      <header className="bg-[#E4E3E0] border-b-2 border-[#141414] sticky top-0 z-40 px-6 py-5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 relative bg-[#141414] border-2 border-[#141414] shadow-[3px_3px_0px_0px_#E94E31] overflow-hidden">
                {/* Dominican-flag emblem: four cantons divided by a white cross.
                    Colors adapt per theme via .flag-* classes in index.css. */}
                <div className="flag-canton-blue absolute top-0 left-0 w-1/2 h-1/2" />
                <div className="flag-canton-red absolute top-0 right-0 w-1/2 h-1/2" />
                <div className="flag-canton-red absolute bottom-0 left-0 w-1/2 h-1/2" />
                <div className="flag-canton-blue absolute bottom-0 right-0 w-1/2 h-1/2" />
                <div className="flag-cross absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[6px]" />
                <div className="flag-cross absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[6px]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="status-label text-xs">GOVERNMENT INTELLIGENCE PLATFORM</span>
                  <span className="bg-[#E94E31] text-[#E4E3E0] text-[10px] px-2 py-0.5 font-black uppercase tracking-wider">
                    v{import.meta.env.APP_VERSION}
                  </span>
                </div>
                <h1 className="text-3xl font-black tracking-tighter uppercase leading-none mt-1">
                  {import.meta.env.APP_NAME} <span className="text-[#E94E31]">RAG</span>
                </h1>
              </div>
            </div>

          {/* Dynamic Active Agent dots pipeline preview */}
          <div className="flex flex-col items-end gap-1 bg-white/40 p-3 border border-[#141414] shadow-[3px_3px_0px_0px_#141414]">
            <span className="text-[10px] uppercase font-black tracking-widest text-[#141414]/70 mb-1">
              Multi-Agent Processing Stream
            </span>
            <div className="flex items-center space-x-3">
              {[
                { label: "PLAN", active: isSearching || currentStageIdx >= 0 },
                { label: "INST", active: isSearching && currentStageIdx >= 1 },
                { label: "SRCH", active: isSearching && currentStageIdx >= 2 },
                { label: "VALD", active: isSearching && currentStageIdx >= 5 },
                { label: "RESP", active: isSearching && currentStageIdx >= 7 },
              ].map((dot, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <div className="flex flex-col items-center">
                    <span className={`w-3.5 h-3.5 rounded-full border border-[#141414] flex items-center justify-center ${
                      dot.active ? "bg-[#E94E31]" : "bg-white/40"
                    }`}>
                      {dot.active && <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
                    </span>
                    <span className="text-[8px] font-black font-mono mt-0.5">{dot.label}</span>
                  </div>
                  {index < 4 && <div className="w-3 h-px bg-[#141414]/40" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Framework Layout */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Sidebar Control Hub (4 cols) */}
        <section className="lg:col-span-4 flex flex-col gap-8">
          
          {/* Query Settings: Target Institutions selection */}
          <div className="bg-white border-2 border-[#141414] p-5 shadow-[4px_4px_0px_0px_#141414] rounded-none">
            <div className="flex items-center justify-between mb-4 border-b-2 border-[#141414] pb-2.5">
              <h2 className="text-xs font-black uppercase tracking-widest text-[#141414] flex items-center gap-2">
                <Sliders className="h-4 w-4 text-[#E94E31]" />
                Fijar Instituciones
              </h2>
              <span className="text-[10px] font-black text-white bg-[#141414] px-2 py-0.5">
                {selectedInstitutions.length === 0 ? "DINÁMICO" : `${selectedInstitutions.length} SELEC`}
              </span>
            </div>
            <p className="text-xs text-[#141414] mb-4 font-sans leading-relaxed">
              El Agente Planificador selecciona los portales de manera autónoma. Active casillas debajo para restringir la búsqueda a instituciones prioritarias:
            </p>
            <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
              {institutions.length === 0 ? (
                <p className="text-[10px] font-mono text-slate-400">Cargando instituciones…</p>
              ) : (
                institutions.map((inst) => {
                  const isSelected = selectedInstitutions.includes(inst.name);
                  return (
                    <button
                      key={inst.id}
                      onClick={() => handleToggleInstitution(inst.name)}
                      className={`flex items-center justify-between text-left px-3 py-2 rounded-none text-xs transition-all border ${
                        isSelected
                          ? "bg-[#141414] border-[#141414] text-white font-bold"
                          : "bg-white/50 hover:bg-white border-slate-300 text-slate-800"
                      }`}
                    >
                      <span className="truncate mr-2 font-mono">{inst.name}</span>
                      {inst.hasLegislative && (
                        <span className="text-[8px] font-black uppercase bg-[#E94E31] text-white px-1 mr-1">SIL</span>
                      )}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="rounded-none border-[#141414] text-[#E94E31] focus:ring-0 h-3 w-3 pointer-events-none accent-[#E94E31]"
                      />
                    </button>
                  );
                })
              )}
            </div>
            {selectedInstitutions.length > 0 && (
              <button
                onClick={() => setSelectedInstitutions([])}
                className="mt-4 text-center w-full text-xs text-[#E94E31] hover:text-[#141414] font-black uppercase tracking-wider"
              >
                [ Restaurar Selección Dinámica ]
              </button>
            )}
          </div>

          {/* Watchlists Monitoring Panel */}
          <div className="bg-white border-2 border-[#141414] p-5 shadow-[4px_4px_0px_0px_#141414] rounded-none">
            <div className="flex items-center justify-between mb-4 border-b-2 border-[#141414] pb-2.5">
              <h2 className="text-xs font-black uppercase tracking-widest text-[#141414] flex items-center gap-2">
                <Bookmark className="h-4 w-4 text-[#E94E31]" />
                Monitoreo Legislativo
              </h2>
              <button
                onClick={() => setIsCreatingWatch(!isCreatingWatch)}
                className="text-[10px] font-black text-white bg-[#E94E31] hover:bg-[#141414] px-2 py-0.5 uppercase tracking-wider"
              >
                {isCreatingWatch ? "Cerrar -" : "Nuevo +"}
              </button>
            </div>

            {/* Create Watchlist Form */}
            {isCreatingWatch && (
              <div className="bg-[#E4E3E0] border-2 border-[#141414] p-4 mb-4 flex flex-col gap-3">
                <div>
                  <label className="block text-[10px] font-black text-[#141414] uppercase mb-1">Nombre del Tema / Ley</label>
                  <input
                    type="text"
                    value={newWatchTitle}
                    onChange={(e) => setNewWatchTitle(e.target.value)}
                    placeholder="Ej. Ley de Ciberseguridad"
                    className="w-full text-xs px-2.5 py-2 bg-white border-2 border-[#141414] rounded-none focus:outline-none focus:ring-0"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-[#141414] uppercase mb-1">Palabras clave (comas)</label>
                  <input
                    type="text"
                    value={newWatchKeywords}
                    onChange={(e) => setNewWatchKeywords(e.target.value)}
                    placeholder="Ej. ciberseguridad, delitos"
                    className="w-full text-xs px-2.5 py-2 bg-white border-2 border-[#141414] rounded-none focus:outline-none focus:ring-0"
                  />
                </div>
                <button
                  onClick={handleAddWatchlist}
                  className="w-full bg-[#141414] text-white hover:bg-[#E94E31] text-xs font-black uppercase tracking-widest py-2 transition-colors border-2 border-[#141414]"
                >
                  Agregar Monitoreo
                </button>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {savedWatchlists.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-[#141414]/30">
                  <Bookmark className="h-6 w-6 text-slate-400 mx-auto mb-1.5" />
                  <p className="text-xs">Sin temas guardados</p>
                </div>
              ) : (
                savedWatchlists.map((item) => (
                  <div
                    key={item.id}
                    className="group border-2 border-[#141414] p-3.5 bg-white hover:bg-[#E4E3E0]/20 transition-all shadow-[2px_2px_0px_0px_#141414]"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[8px] font-mono font-black text-[#141414]/50 block mb-0.5 uppercase">WATCHLIST_ID: {item.id}</span>
                        <h3 className="text-xs font-black text-[#141414] font-display uppercase tracking-tight">
                          {item.title}
                        </h3>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {item.keywords.map((kw, idx) => (
                            <span key={idx} className="bg-white border border-[#141414] text-[#141414] text-[9px] px-1.5 py-0.5 font-mono">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteWatchlist(item.id, e)}
                        className="text-slate-400 hover:text-red-600 p-0.5 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-col gap-2 mt-3 pt-2.5 border-t border-[#141414]">
                      {item.lastResult?.response?.summary && (
                        <p className="text-[9px] leading-relaxed text-slate-700 line-clamp-3 border-l-2 border-[#E94E31] pl-2">
                          {item.lastResult.response.summary}
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[9px] font-mono">
                        <div className="flex items-center gap-1 text-slate-600">
                          <Activity className="h-3 w-3 text-[#E94E31]" />
                          <span>Revisado: {new Date(item.lastChecked).toLocaleDateString("es-DO", { month: 'short', day: 'numeric' })}</span>
                          {item.status === "Actualizado" && (
                            <span className="ml-1 bg-[#E94E31] text-white px-1 py-0.5 font-black uppercase">OK</span>
                          )}
                          {item.status === "Error" && (
                            <span className="ml-1 bg-red-600 text-white px-1 py-0.5 font-black uppercase">ERR</span>
                          )}
                          {item.alertsCount ? (
                            <span className="ml-1 bg-[#141414] text-white px-1 py-0.5 font-black">NUEVO</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {item.lastResult && (
                            <button
                              onClick={() => {
                                setActiveResult({ ...item.lastResult, id: (item.lastResult as any).id || `r_watch_${item.id}` });
                                setActiveTab("brief");
                                const cleared = savedWatchlists.map((w) =>
                                  w.id === item.id ? { ...w, alertsCount: 0 } : w
                                );
                                setSavedWatchlists(cleared);
                                localStorage.setItem("dr_gov_intel_watchlist", JSON.stringify(cleared));
                              }}
                              className="text-[#141414] hover:text-[#E94E31] font-black uppercase"
                            >
                              Ver resultado
                            </button>
                          )}
                          <button
                            onClick={() => handleTriggerWatchCheck(item)}
                            disabled={item.status === "Verificando…"}
                            className="flex items-center gap-1 text-[#E94E31] hover:text-black font-black uppercase disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3 w-3 ${item.status === "Verificando…" ? "animate-spin" : ""}`} />
                            <span>Verificar</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Query History Log */}
          <div className="bg-white border-2 border-[#141414] p-5 shadow-[4px_4px_0px_0px_#141414] rounded-none flex-1 flex flex-col min-h-64">
            <div className="flex items-center justify-between mb-3 border-b-2 border-[#141414] pb-2.5">
              <h2 className="text-xs font-black uppercase tracking-widest text-[#141414] flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#E94E31]" />
                Historial de Análisis
              </h2>
              {searchHistory.length > 0 && (
                <button
                  onClick={() => {
                    saveToHistory([]);
                    setActiveResult(null);
                  }}
                  className="text-[10px] text-[#E94E31] hover:underline font-black uppercase"
                >
                  Limpiar
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto max-h-72 flex flex-col gap-2 pr-1">
              {searchHistory.length === 0 ? (
                <div className="text-center py-10 my-auto text-slate-400">
                  <Database className="h-8 w-8 mx-auto mb-2 text-[#141414]/30" />
                  <p className="text-xs">Historial vacío.</p>
                </div>
              ) : (
                searchHistory.map((item) => {
                  const isActive = (activeResult as any)?.id === (item as any).id;
                  return (
                    <div
                      key={item.timestamp}
                      onClick={() => {
                        setActiveResult(item);
                        setActiveTab("brief");
                      }}
                      className={`group flex items-center justify-between text-left p-3 rounded-none text-xs cursor-pointer transition-all border ${
                        isActive
                          ? "bg-[#141414] text-white border-[#141414] font-bold shadow-[2px_2px_0px_0px_#E94E31]"
                          : "bg-[#E4E3E0]/20 hover:bg-[#E4E3E0]/40 border-slate-300 text-slate-800"
                      }`}
                    >
                      <div className="truncate flex-1 mr-2">
                        <p className="truncate uppercase tracking-tight font-black">{item.query}</p>
                        <span className={`text-[9px] font-mono block ${isActive ? "text-[#E94E31]" : "text-slate-500"}`}>
                          {new Date(item.timestamp).toLocaleTimeString("es-DO", { hour: '2-digit', minute: '2-digit' })} - CONF: {item.response.confidenceLevel}
                        </span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteHistory(item.timestamp, e)}
                        className={`hover:text-red-500 ${isActive ? "text-slate-400" : "text-slate-500"}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick links to original sources */}
          <div className="bg-[#141414] text-white border-2 border-[#141414] p-5 shadow-[4px_4px_0px_0px_#E94E31] rounded-none">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#E94E31] mb-3 flex items-center gap-1.5">
              <BookOpen className="h-4 w-4" />
              Bóvedas de Leyes y Decretos
            </h3>
            <p className="text-[10px] text-slate-300 mb-4 leading-relaxed">
              Consulte de forma directa los motores y repositorios legislativos oficiales dominicanos:
            </p>
            <div className="grid grid-cols-1 gap-2">
              {institutions.length === 0
                ? Object.values(DR_PORTALS_LEGACY).map((portal) => (
                    <a key={portal.name} href={portal.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between p-2.5 bg-black hover:bg-[#E94E31]/95 hover:text-white transition-all border border-[#141414] text-xs text-[#E4E3E0]">
                      <div>
                        <span className="font-bold block text-xs uppercase tracking-tight">{portal.name}</span>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    </a>
                  ))
                : institutions.map((inst) => (
                    <a
                      key={inst.id}
                      href={inst.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2.5 bg-black hover:bg-[#E94E31]/95 hover:text-white transition-all border border-[#141414] text-xs text-[#E4E3E0]"
                    >
                      <div>
                        <span className="text-[8px] font-mono font-black text-slate-400 uppercase tracking-widest">{inst.id}</span>
                        <span className="font-bold block text-xs uppercase tracking-tight">{inst.name}</span>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    </a>
                  ))}
            </div>
          </div>

          {/* Portal URL Tree panel */}
          <div className="bg-white border-2 border-[#141414] p-5 shadow-[4px_4px_0px_0px_#141414] rounded-none">
            <div className="flex items-center justify-between mb-4 border-b-2 border-[#141414] pb-2.5">
              <h2 className="text-xs font-black uppercase tracking-widest text-[#141414] flex items-center gap-2">
                <Database className="h-4 w-4 text-[#E94E31]" />
                Árbol de URLs
              </h2>
              <div className="flex items-center gap-2">
                {urlTree && (
                  <button
                    onClick={() => handleLoadUrlTree(true)}
                    disabled={urlTreeLoading}
                    className="text-[10px] font-black text-[#E94E31] hover:text-[#141414] uppercase disabled:opacity-50"
                  >
                    Refrescar
                  </button>
                )}
                <button
                  onClick={() => handleLoadUrlTree(false)}
                  disabled={urlTreeLoading}
                  className="text-[10px] font-black text-white bg-[#141414] hover:bg-[#E94E31] px-2 py-0.5 uppercase tracking-wider disabled:opacity-50"
                >
                  {urlTreeLoading ? "Construyendo..." : urlTree ? "Recargar" : "Construir"}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-600 mb-3 leading-relaxed font-sans">
              {selectedInstitutions.length > 0
                ? `Procesa solo: ${selectedInstitutions.join(", ")}.`
                : "Procesa todas las fuentes. Para acotar, seleccione instituciones en \"Fijar Instituciones\"."}
            </p>
            {urlTreeLoading && (
              <div className="flex items-center gap-2 py-4 text-[10px] font-mono uppercase">
                <div className="h-3 w-3 border-2 border-[#141414] border-t-[#E94E31] rounded-full animate-spin" />
                Recorriendo portales...
              </div>
            )}
            {!urlTreeLoading && !urlTree && (
              <p className="text-[10px] text-slate-500 italic">Aún no se ha generado el árbol. Pulse "Construir".</p>
            )}
            {urlTree && (
              <div className="max-h-96 overflow-y-auto pr-1 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => toggleNode("all")}
                    className="text-[10px] font-black text-[#E94E31] hover:text-[#141414] uppercase"
                  >
                    {expandedNodes.has("all") ? "[ Colapsar todo ]" : "[ Expandir todo ]"}
                  </button>
                  <button
                    onClick={() => setSelectedTrees(new Set())}
                    className="text-[10px] font-black text-[#141414] hover:text-[#E94E31] uppercase"
                  >
                    {selectedTrees.size > 0 ? `[ Quitar selección (${selectedTrees.size}) ]` : "[ Todos activos ]"}
                  </button>
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed">
                  Marque árboles para usar solo los seleccionados. Si ninguno está marcado, se usan todos.
                </p>
                {renderUrlTree(urlTree)}
              </div>
            )}
          </div>

        </section>

        {/* Right Content Column (8 cols) */}
        <section className="lg:col-span-8 flex flex-col gap-8">
          
          {/* Main Question Input Area */}
          <div className="bg-white border-2 border-[#141414] p-6 shadow-[6px_6px_0px_0px_#141414] rounded-none">
            <span className="status-label text-[10px]">RE retrieval & synthesis core</span>
            <h2 className="text-xl font-black uppercase tracking-tight text-[#141414] mt-1 mb-2 flex items-center gap-2">
              <Search className="h-5 w-5 text-[#E94E31]" />
              Consola del Auditor de Evidencia
            </h2>
              <p className="text-xs text-[#141414] mb-5 leading-relaxed">
                Formule su consulta sobre diferentes organismos del Estado Dominicano. El sistema ejecutará una secuencia de <strong className="font-bold">8 agentes analíticos</strong> que recuperan fuentes oficiales en vivo en los poderes <strong className="font-bold">Legislativo</strong>, <strong className="font-bold">Ejecutivo</strong> y <strong className="font-bold">Judicial</strong>, así como en portales de transparencia y datos abiertos.
              </p>

            <div className="relative mb-4">
              <textarea
                rows={3}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ej. ¿Qué reformas propone la DGCP para modernizar la Ley 340-06 de Compras Públicas?"
                className="w-full text-sm italic font-serif px-4 py-3 bg-[#E4E3E0]/20 border-2 border-[#141414] rounded-none focus:outline-none focus:ring-0 resize-none leading-relaxed text-[#141414]"
                disabled={isSearching}
              />
              <button
                onClick={() => handleRunQuery(query)}
                disabled={isSearching || !query.trim()}
                className="absolute right-3.5 bottom-3.5 px-4 py-2 bg-[#E94E31] text-white hover:bg-[#141414] font-black uppercase text-xs tracking-wider border-2 border-[#141414] shadow-[2px_2px_0px_0px_#141414] transition-all disabled:opacity-40"
              >
                CONSULTAR
              </button>
            </div>

            {/* Suggestions Chips */}
            <div className="flex flex-col gap-2 border-t border-[#141414]/15 pt-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Búsquedas Sugeridas:</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { text: "Ley de Drogas 50-88 escalas de posesión y penas dominicana", label: "LEY 50-88 DROGAS" },
                  { text: "Proyecto de modernización Ley 340-06 de compras públicas dominicana", label: "LEY 340-06 COMPRAS" },
                  { text: "Propuestas y debates del Proyecto de Reforma Fiscal", label: "REFORMA FISCAL" },
                  { text: "Sentencias del Tribunal Constitucional sobre acceso a la información pública", label: "INFORMACIÓN PÚBLICA" }
                ].map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setQuery(s.text);
                    }}
                    disabled={isSearching}
                    className="text-[11px] font-black uppercase tracking-widest bg-white hover:bg-[#E4E3E0] text-[#141414] border-2 border-[#141414] px-3 py-1.5 transition-all"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Pipeline stages running (Shown only when loading) */}
          {isSearching && (
            <div className="bg-white border-2 border-[#141414] p-6 shadow-[6px_6px_0px_0px_#E94E31] rounded-none">
              <div className="flex items-center justify-between mb-4 pb-3 border-b-2 border-[#141414]">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-[#E94E31] animate-pulse" />
                  <h3 className="text-sm font-black uppercase tracking-wider font-display text-[#141414]">BUCLE DE RAZONAMIENTO Y VERIFICACIÓN DE FUENTES</h3>
                </div>
                <span className="text-[10px] bg-[#141414] text-white font-mono px-2 py-0.5 animate-pulse">PROCESS ACTIVE</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {agentStages.map((stage, idx) => {
                  const isRunning = stage.status === "running";
                  const isCompleted = stage.status === "completed";
                  const isFailed = stage.status === "failed";

                  return (
                    <div
                      key={stage.name}
                      className={`border-2 p-3 rounded-none text-xs transition-all flex flex-col justify-between ${
                        isRunning
                          ? "bg-[#E94E31]/10 border-[#141414] text-black shadow-[3px_3px_0px_0px_#141414]"
                          : isCompleted
                          ? "bg-[#E4E3E0]/30 border-[#141414]/30 text-slate-500"
                          : isFailed
                          ? "bg-red-100 border-red-600 text-red-950"
                          : "bg-white border-slate-200 text-slate-400"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5 border-b border-[#141414]/10 pb-1">
                          <span className="font-black uppercase tracking-wider text-[11px]">{stage.label}</span>
                          {isRunning && <span className="h-2 w-2 rounded-full bg-[#E94E31] animate-ping" />}
                          {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-black" />}
                          {isFailed && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                        </div>
                        <p className={`text-[10px] leading-relaxed font-mono ${isRunning ? "text-black" : "text-slate-400"}`}>
                          {stage.description}
                        </p>
                      </div>
                      
                      <div className="mt-3 text-[8px] font-mono uppercase tracking-widest font-black">
                        {isRunning ? "[ ACTIVO ]" : isCompleted ? "[ LISTO ]" : isFailed ? "[ ERROR ]" : "[ COLA ]"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* API Keys Configuration error or Alert */}
          {apiError && (
            <div className="bg-white border-2 border-red-600 p-6 shadow-[6px_6px_0px_0px_#141414] rounded-none">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-[#E94E31] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-base font-black text-red-600 uppercase tracking-tight mb-2 font-display">{apiError.error}</h3>
                  <p className="text-xs text-slate-800 leading-relaxed mb-4">{apiError.message}</p>
                  
                  {apiError.error.includes("API Key") && (
                    <div className="bg-[#E4E3E0] border-2 border-[#141414] p-4 text-xs">
                      <p className="font-black uppercase tracking-wider text-[#141414] mb-2">Instrucciones para Añadir la API Key:</p>
                       <ol className="list-decimal list-inside space-y-1 text-slate-800 font-mono">
                         <li>Haga clic en el ícono de engranaje en la parte inferior derecha.</li>
                         <li>Seleccione su proveedor y modelo de IA.</li>
                         <li>Registre su <code className="bg-white px-1.5 py-0.5 font-bold">API Key</code>.</li>
                         <li>Guarde los cambios y vuelva a consultar.</li>
                       </ol>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Query Results Viewer */}
          {isSearching ? (
            <div className="bg-white border-2 border-[#141414] shadow-[8px_8px_0px_0px_#141414] rounded-none overflow-hidden flex flex-col">
              <div className="bg-[#141414] text-white p-6 border-b-2 border-[#141414]">
                <span className="text-[9px] font-mono font-black tracking-widest text-[#E94E31] uppercase block mb-1 animate-pulse">AUDIT EVIDENCE PACKET</span>
                <h2 className="text-xl font-black text-[#E4E3E0] font-serif italic tracking-tight">Procesando consulta...</h2>
              </div>
              <div className="p-10 flex flex-col items-center justify-center text-center gap-4">
                <div className="h-12 w-12 border-4 border-[#141414] border-t-[#E94E31] rounded-full animate-spin" />
                <p className="text-xs font-mono uppercase tracking-widest text-[#141414]">Recuperando y sintetizando evidencia</p>
              </div>
            </div>
          ) : activeResult ? (
            <>
            <div className="bg-white border-2 border-[#141414] shadow-[8px_8px_0px_0px_#141414] rounded-none overflow-hidden flex flex-col">
              
              {/* Result Meta Header */}
              <div className="bg-[#141414] text-white p-6 border-b-2 border-[#141414]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/20 pb-4 mb-4">
                  <div>
                    <span className="text-[9px] font-mono font-black tracking-widest text-[#E94E31] uppercase block mb-1">AUDIT EVIDENCE PACKET</span>
                    <h2 className="text-xl font-black text-[#E4E3E0] font-serif italic tracking-tight">"{activeResult.query}"</h2>
                  </div>
                  <div className="flex-shrink-0">
                    {getConfidenceBadge(activeResult.response.confidenceLevel)}
                  </div>
                </div>
              
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[10px] font-mono text-slate-300">
                  <div className="bg-black/40 p-2 border border-white/10">
                    <span className="text-[#E94E31] font-bold block uppercase tracking-wider">REGISTRO DE FECHA</span>
                    <span>{new Date(activeResult.timestamp).toLocaleString("es-DO")}</span>
                  </div>
                  <div className="bg-black/40 p-2 border border-white/10">
                    <span className="text-[#E94E31] font-bold block uppercase tracking-wider">DOCS ANALIZADOS</span>
                    <span>{activeResult.retrieval.documentsAnalyzed.length} Portales oficiales</span>
                  </div>
                  <div className="bg-black/40 p-2 border border-white/10">
                    <span className="text-[#E94E31] font-bold block uppercase tracking-wider">PUNTOS DE EVIDENCIA</span>
                    <span>{activeResult.evidence.length} Declaraciones</span>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs (Brutalist style) */}
              <div className="bg-[#E4E3E0] border-b-2 border-[#141414] p-1.5 flex flex-nowrap gap-1 overflow-x-auto">
                {[
                  { id: "sources", label: "FUENTES", icon: Radio },
                  { id: "brief", label: "EXECUTIVE BRIEF", icon: FileText },
                  { id: "evidence", label: "EVIDENCE MATRIX", icon: Layers },
                  { id: "timeline", label: "TIMELINE", icon: TrendingUp },
                  { id: "validation", label: "VALIDATION", icon: ShieldCheck },
                  { id: "citations", label: "CITATIONS", icon: BookOpen }
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex items-center gap-1.5 px-3.5 py-2 font-black text-[11px] uppercase tracking-widest transition-all border-2 whitespace-nowrap flex-shrink-0 ${
                        isActive
                          ? "bg-[#141414] text-white border-[#141414] shadow-[2px_2px_0px_0px_#E94E31]"
                          : "bg-white hover:bg-[#E4E3E0] text-[#141414] border-[#141414]"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tab Contents */}
              <div className="p-6 flex-1 min-h-[400px]">
                 
                {/* 0. Sources Tab — two parallel streams */}
                {activeTab === "sources" && (
                  <div className="space-y-8">
                    {/* FLUJO A: Congreso Nacional (primary) */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Landmark className="h-5 w-5 text-[#141414]" />
                        <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider">FLUJO A · ACTIVIDAD DEL CONGRESO NACIONAL</h4>
                        <span className="ml-auto text-[10px] font-mono bg-[#141414] text-white px-2 py-0.5">
                          {activeResult.sources?.congress?.length || 0} fuentes oficiales
                        </span>
                      </div>

                      {/* Leyes / Iniciativas (SIL) — primary congressional output, grouped by origin */}
                      {activeResult.sources?.laws?.length ? (
                        <div className="mb-4 border-2 border-[#E94E31] bg-[#E94E31]/5 shadow-[4px_4px_0px_0px_#E94E31]">
                          <div className="bg-[#E94E31] text-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                            <Scale className="h-3.5 w-3.5" /> Leyes / Iniciativas Legislativas (SIL)
                          </div>
                          {(() => {
                            const laws = activeResult.sources!.laws!;
                            const bulletins = activeResult.sources!.bulletins || [];
                            const groups: Record<string, typeof laws> = {};
                            for (const l of laws) {
                              const inst = (l.url || "").includes("senado")
                                ? "Senado de la República"
                                : "Cámara de Diputados";
                              (groups[inst] ||= []).push(l);
                            }
                            // Always show both chambers — even when empty
                            const chambers = ["Senado de la República", "Cámara de Diputados"];
                            return chambers.map((inst) => {
                              const items = groups[inst] || [];
                              // Boletines/Actas (Senado DSpace) se muestran como más
                              // filas del Senado, sin título propio.
                              const isSenado = inst === "Senado de la República";
                              const totalCount = items.length + (isSenado ? bulletins.length : 0);
                              return (
                                <div key={inst}>
                                  <div className="bg-[#141414] text-white/90 px-3 py-1 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                    <span className="text-[8px] font-black uppercase bg-white text-[#141414] px-1 mr-1">SIL</span>
                                    {inst}
                                    {totalCount > 0 && <span className="ml-auto text-[8px] font-mono bg-white/20 px-1">{totalCount}</span>}
                                  </div>
                                  {totalCount > 0 ? (
                                    <ul className="divide-y divide-[#141414]/15">
                                      {items.map((l, i) => (
                                        <li key={`law-${i}`} className="px-3 py-2.5 flex items-start gap-3">
                                          <span className="text-[10px] font-mono font-black text-[#E94E31] mt-0.5 whitespace-nowrap">{l.numero}</span>
                                          <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <span className="text-xs font-black text-[#141414] uppercase">{l.tipo}</span>
                                              {l.estado && <span className="text-[9px] font-mono bg-[#141414] text-white px-1.5 py-0.5">{l.estado}</span>}
                                              {l.materia && <span className="text-[9px] font-mono bg-[#E94E31] text-white px-1.5 py-0.5">{l.materia}</span>}
                                            </div>
                                            <p className="text-xs text-slate-700 leading-snug mt-0.5 line-clamp-2">{l.descripcion}</p>
                                            {l.fechaDeposito && <span className="text-[9px] font-mono text-slate-400 mt-0.5 block">{l.fechaDeposito}</span>}
                                          </div>
                                          <a href={l.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex-shrink-0 inline-flex p-1.5 bg-[#141414] hover:bg-[#E94E31] text-white transition-colors">
                                            <ExternalLink className="h-3.5 w-3.5" />
                                          </a>
                                        </li>
                                      ))}
                                      {isSenado && (
                                        bulletins.map((b, i) => (
                                          <li key={`bul-${i}`} className="px-3 py-2.5 flex items-start gap-3">
                                            <span className="text-[10px] font-mono font-black text-[#E94E31] mt-0.5 whitespace-nowrap">{b.tipo || "Doc"}</span>
                                            <div className="min-w-0">
                                              <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="text-xs font-black text-[#141414] uppercase">Senado</span>
                                                {b.date && <span className="text-[9px] font-mono bg-[#141414] text-white px-1.5 py-0.5">{b.date}</span>}
                                              </div>
                                              <p className="text-xs text-slate-700 leading-snug mt-0.5 line-clamp-2">{b.title}</p>
                                              {b.snippet && <span className="text-[9px] font-mono text-slate-400 mt-0.5 block line-clamp-1">{b.snippet}</span>}
                                            </div>
                                            <a href={b.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex-shrink-0 inline-flex p-1.5 bg-[#141414] hover:bg-[#E94E31] text-white transition-colors">
                                              <ExternalLink className="h-3.5 w-3.5" />
                                            </a>
                                          </li>
                                        ))
                                      )}
                                    </ul>
                                  ) : (
                                    <div className="px-3 py-2 text-[10px] text-slate-400 italic">No hay iniciativas SIL para esta consulta.</div>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      ) : (
                        // Even with zero laws, show both chambers with empty state
                        <div className="mb-4 border-2 border-[#E94E31]/30 bg-[#E94E31]/5">
                          <div className="bg-[#E94E31] text-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                            <Scale className="h-3.5 w-3.5" /> Leyes / Iniciativas Legislativas (SIL)
                          </div>
                          {["Senado de la República", "Cámara de Diputados"].map((inst) => (
                            <div key={inst}>
                              <div className="bg-[#141414] text-white/90 px-3 py-1 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                <span className="text-[8px] font-black uppercase bg-white text-[#141414] px-1 mr-1">SIL</span>
                                {inst}
                              </div>
                              <div className="px-3 py-2 text-[10px] text-slate-400 italic">No hay iniciativas SIL para esta consulta.</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeResult.sources?.congress?.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {activeResult.sources.congress.map((s, i) => (
                            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="group block border-2 border-[#141414] bg-white p-3 hover:bg-[#E4E3E0] transition-colors shadow-[3px_3px_0px_0px_#141414]">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[9px] font-mono font-black uppercase tracking-wider text-[#141414] bg-[#E4E3E0] px-1.5 py-0.5">{s.institution}</span>
                                <ExternalLink className="h-3.5 w-3.5 text-[#141414] group-hover:text-[#E94E31]" />
                              </div>
                              <h5 className="text-xs font-black text-[#141414] mt-1.5 leading-snug">{s.title}</h5>
                              {s.snippet && <p className="text-[10px] text-slate-600 mt-1 line-clamp-2 font-sans">{s.snippet}</p>}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 font-mono border-2 border-dashed border-[#141414]/30 p-4">No se recuperaron noticias oficiales del Congreso para esta consulta.</p>
                      )}
                    </section>

                    {/* FLUJO B: Tribunal Constitucional */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Scale className="h-5 w-5 text-[#141414]" />
                        <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider">FLUJO B · ACTIVIDAD DEL TRIBUNAL CONSTITUCIONAL</h4>
                        <span className="ml-auto text-[10px] font-mono bg-[#141414] text-white px-2 py-0.5">
                          {activeResult.sources?.tribunal?.length || 0} fuentes
                        </span>
                      </div>
                      {activeResult.sources?.tribunal?.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {activeResult.sources.tribunal.map((s, i) => (
                            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="group block border-2 border-[#141414] bg-white p-3 hover:bg-[#E4E3E0] transition-colors shadow-[3px_3px_0px_0px_#141414]">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[9px] font-mono font-black uppercase tracking-wider text-[#141414] bg-[#E4E3E0] px-1.5 py-0.5">{s.institution || "Tribunal Constitucional"}</span>
                                <ExternalLink className="h-3.5 w-3.5 text-[#141414] group-hover:text-[#E94E31]" />
                              </div>
                              <h5 className="text-xs font-black text-[#141414] mt-1.5 leading-snug">{s.title}</h5>
                              {s.snippet && <p className="text-[10px] text-slate-600 mt-1 line-clamp-2 font-sans">{s.snippet}</p>}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 font-mono border-2 border-dashed border-[#141414]/30 p-4">No se recuperaron decisiones o comunicados del Tribunal Constitucional para esta consulta.</p>
                      )}
                    </section>

                    {/* FLUJO C: Datos Abiertos */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Database className="h-5 w-5 text-[#141414]" />
                        <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider">FLUJO C · DATOS ABIERTOS</h4>
                        <span className="ml-auto text-[10px] font-mono bg-[#141414] text-white px-2 py-0.5">
                          {activeResult.sources?.datos?.length || 0} datasets
                        </span>
                      </div>
                      {activeResult.sources?.datos?.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {activeResult.sources.datos.map((s, i) => (
                            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="group block border-2 border-[#141414] bg-white p-3 hover:bg-[#E4E3E0] transition-colors shadow-[3px_3px_0px_0px_#141414]">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[9px] font-mono font-black uppercase tracking-wider text-[#141414] bg-[#E4E3E0] px-1.5 py-0.5">{s.institution || "Datos Abiertos RD"}</span>
                                <ExternalLink className="h-3.5 w-3.5 text-[#141414] group-hover:text-[#E94E31]" />
                              </div>
                              <h5 className="text-xs font-black text-[#141414] mt-1.5 leading-snug">{s.title}</h5>
                              {s.snippet && <p className="text-[10px] text-slate-600 mt-1 line-clamp-2 font-sans">{s.snippet}</p>}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 font-mono border-2 border-dashed border-[#141414]/30 p-4">No se recuperaron datasets de Datos Abiertos para esta consulta.</p>
                      )}
                    </section>

                    {/* FLUJO D: Noticias (quaternary) */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Newspaper className="h-5 w-5 text-[#141414]" />
                        <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider">FLUJO D · COBERTURA EN NOTICIAS / MEDIOS</h4>
                        <span className="ml-auto text-[10px] font-mono bg-[#141414] text-white px-2 py-0.5">
                          {activeResult.sources?.news?.length || 0} notas
                        </span>
                      </div>
                      {activeResult.sources?.news?.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {activeResult.sources.news.map((s, i) => (
                            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="group block border-2 border-[#141414] bg-white p-3 hover:bg-[#E4E3E0] transition-colors shadow-[3px_3px_0px_0px_#141414]">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[9px] font-mono font-black uppercase tracking-wider text-[#141414] bg-[#E4E3E0] px-1.5 py-0.5">{s.source || s.institution || "Medio"}</span>
                                <ExternalLink className="h-3.5 w-3.5 text-[#141414] group-hover:text-[#E94E31]" />
                              </div>
                              <h5 className="text-xs font-bold text-[#141414] mt-1.5 leading-snug">{s.title}</h5>
                              {s.snippet && <p className="text-[10px] text-slate-600 mt-1 line-clamp-2 font-sans">{s.snippet}</p>}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 font-mono border-2 border-dashed border-[#141414]/30 p-4">No se recuperaron noticias para esta consulta.</p>
                      )}
                    </section>

                    {/* FLUJOS F+ : un FLUJO por cada institución / plugin */}
                    {/* Senado y Diputados ya aparecen en FLUJO A (Congreso Nacional). */}
                    {institutions
                      .filter((inst) => inst.id !== "senate" && inst.id !== "chamber")
                      .map((inst) => {
                      const items = activeResult.sources?.perInstitution?.[inst.id] || [];
                      if (items.length === 0) return null;
                      return (
                        <section key={inst.id}>
                          <div className="flex items-center gap-2 mb-3">
                            <Landmark className="h-5 w-5 text-[#141414]" />
                            <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider break-words">
                              FLUJO · {inst.name}
                            </h4>
                            <span className="ml-auto text-[10px] font-mono bg-[#141414] text-white px-2 py-0.5">
                              {items.length} resultados
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {items.map((s, i) => (
                              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="group block border-2 border-[#141414] bg-white p-3 hover:bg-[#E4E3E0] transition-colors shadow-[3px_3px_0px_0px_#141414]">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-[9px] font-mono font-black uppercase tracking-wider text-[#141414] bg-[#E4E3E0] px-1.5 py-0.5">{s.institution}</span>
                                  <ExternalLink className="h-3.5 w-3.5 text-[#141414] group-hover:text-[#E94E31]" />
                                </div>
                                <h5 className="text-xs font-black text-[#141414] mt-1.5 leading-snug">{s.title}</h5>
                                {s.snippet && <p className="text-[10px] text-slate-600 mt-1 line-clamp-2 font-sans">{s.snippet}</p>}
                              </a>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}

                {/* 1. Brief Tab */}
                {activeTab === "brief" && (
                  <div className="space-y-6">
                    <div className="bg-[#E94E31]/10 border-2 border-[#141414] p-5 shadow-[4px_4px_0px_0px_#141414]">
                      <h4 className="text-xs font-black text-[#141414] uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-[#E94E31]" />
                        SÍNTESIS EJECUTIVA DE LOS AGENTES
                      </h4>
                      <p className="text-sm text-[#141414] leading-relaxed font-sans font-semibold">
                        {activeResult.response.summary}
                      </p>
                    </div>

                    <div className="space-y-3">
                      <span className="status-label text-[10px]">INFORME ESTRUCTURADO Y ANÁLISIS JURÍDICO</span>
                      <div className="bg-white border-2 border-[#141414] p-6 font-sans leading-relaxed shadow-[4px_4px_0px_0px_#141414] max-h-[640px] overflow-y-auto">
                        {parseMarkdown(activeResult.response.detailedAnalysis)}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Evidence Tab */}
                {activeTab === "evidence" && (
                  <div className="space-y-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#141414]/15 pb-3">
                      <div>
                        <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider">MATRIZ DE EVIDENCIA EXTRAÍDA</h4>
                        <p className="text-[10px] text-slate-500 font-mono">Primacía del Congreso Nacional (Senado y Diputados). Hechos atómicos con trazabilidad directa a leyes, iniciativas y comunicados oficiales.</p>
                      </div>
                      
                      <div className="relative w-full md:w-72">
                        <input
                          type="text"
                          value={evidenceFilter}
                          onChange={(e) => setEvidenceFilter(e.target.value)}
                          placeholder="Filtrar por hecho o institución..."
                          className="w-full text-xs pl-9 pr-3 py-2 bg-[#E4E3E0]/20 border-2 border-[#141414] focus:outline-none focus:ring-0 font-mono"
                        />
                        <Search className="h-4 w-4 text-[#141414] absolute left-3 top-2.5" />
                      </div>
                    </div>

                    <div className="border-2 border-[#141414] overflow-x-auto shadow-[4px_4px_0px_0px_#141414]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-[#E4E3E0] border-b-2 border-[#141414] text-[9px] uppercase tracking-widest text-[#141414] font-black">
                            <th className="p-3 font-black">DECLARACIÓN / HECHO CLAVE</th>
                            <th className="p-3 font-black">INSTITUCIÓN</th>
                            <th className="p-3 font-black">PUBLICACIÓN</th>
                            <th className="p-3 font-black text-center">ENLACE</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#141414]/20 font-sans">
                          {filteredEvidence.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="text-center p-8 text-slate-500 font-mono">
                                Ninguna evidencia coincide con los filtros aplicados.
                              </td>
                            </tr>
                          ) : (
                            filteredEvidence.map((ev, idx) => (
                              <tr key={idx} className="hover:bg-[#E4E3E0]/10 transition-colors">
                                <td className="p-3 text-[#141414] leading-relaxed font-medium">{ev.fact}</td>
                                <td className="p-3 text-[#141414] font-bold uppercase tracking-tight whitespace-nowrap">{ev.institution}</td>
                                <td className="p-3 text-slate-600 font-mono text-[10px] whitespace-nowrap">{ev.date || "N/A"}</td>
                                <td className="p-3 text-center">
                                  {ev.sourceUrl ? (
                                    <a
                                      href={ev.sourceUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex p-1.5 bg-[#141414] hover:bg-[#E94E31] text-white transition-colors"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  ) : (
                                    <span className="text-slate-400 font-mono">-</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. Timeline Tab */}
                {activeTab === "timeline" && (
                  <div className="space-y-5">
                    <div>
                      <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider">HITO CRONOLÓGICO Y LEGISLATIVO</h4>
                      <p className="text-[10px] text-slate-500 font-mono">Evolución en el tiempo extraída y secuenciada desde las fuentes.</p>
                    </div>

                    <div className="relative border-l-4 border-[#141414] ml-6 pl-6 space-y-6 py-2">
                      {activeResult.response.timeline.length === 0 ? (
                        <p className="text-xs text-slate-500 italic font-mono">No se detectaron hitos cronológicos claros para esta consulta.</p>
                      ) : (
                        activeResult.response.timeline.map((event, idx) => (
                          <div key={idx} className="relative">
                            {/* Brutalist Node square */}
                            <span className="absolute -left-[35px] top-1 h-5 w-5 bg-white border-2 border-[#141414] flex items-center justify-center shadow-[2px_2px_0px_0px_#141414]">
                              <span className="h-2 w-2 bg-[#E94E31]" />
                            </span>
                            
                            <div className="bg-white border-2 border-[#141414] p-4 shadow-[3px_3px_0px_0px_#141414] rounded-none">
                              <span className="inline-block bg-[#141414] text-[#E4E3E0] text-[9px] px-2 py-0.5 font-mono font-black uppercase mb-1.5">
                                {event.date}
                              </span>
                              <h5 className="text-xs font-black text-[#141414] uppercase tracking-tight">{event.event}</h5>
                              {event.detail && (
                                <p className="text-[11px] text-slate-700 mt-1 leading-relaxed font-sans">
                                  {event.detail}
                                </p>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* 4. Validation Auditor Tab */}
                {activeTab === "validation" && (
                  <div className="space-y-5">
                    <div>
                      <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider">INFORMES DE AUDITORÍA Y CONSISTENCIA</h4>
                      <p className="text-[10px] text-slate-500 font-mono">Resultado del Agente Validador comparando contradicciones y jerarquía.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Left: General consistency stats */}
                      <div className="bg-white border-2 border-[#141414] p-5 shadow-[4px_4px_0px_0px_#141414] flex flex-col justify-between">
                        <div>
                          <h5 className="text-xs font-black uppercase tracking-wider text-[#141414] mb-3">Métricas de Jerarquía</h5>
                          <div className="space-y-2.5 text-xs font-mono">
                            <div className="flex items-center justify-between border-b border-[#141414]/15 pb-2">
                              <span className="text-slate-500">Fuentes Redundantes:</span>
                              <span className="text-[#141414] font-black">{activeResult.validation.duplicateSourcesRemoved} filtradas</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-[#141414]/15 pb-2">
                              <span className="text-slate-500">Cohesión Narrativa:</span>
                              <span className="text-[#E94E31] font-black">{activeResult.refinement.coherenceScore} / 100</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-[#141414]/15 pb-2">
                              <span className="text-slate-500">Compresión de Texto:</span>
                              <span className="text-[#141414] font-black">{activeResult.refinement.textLengthReduced} caracteres</span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-[#E94E31]/10 border-2 border-[#141414] p-3 mt-5 flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 text-[#E94E31] mt-0.5 flex-shrink-0" />
                          <p className="text-[10px] text-[#141414] font-mono leading-relaxed">
                            <strong>AUDIT_STATUS:</strong> {activeResult.validation.statusMessage}
                          </p>
                        </div>
                      </div>

                      {/* Right: Contradictions logged */}
                      <div className="bg-white border-2 border-[#141414] p-5 shadow-[4px_4px_0px_0px_#141414]">
                        <h5 className="text-xs font-black uppercase tracking-wider text-[#141414] mb-3 flex items-center gap-1.5">
                          <ShieldCheck className="h-4.5 w-4.5 text-[#E94E31]" />
                          Análisis de Contradicciones Activas
                        </h5>
                        
                        {activeResult.validation.conflictingStatements.length === 0 ? (
                          <div className="h-40 flex flex-col justify-center items-center text-center text-slate-500 bg-[#E4E3E0]/15 border-2 border-dashed border-slate-300">
                            <CheckCircle2 className="h-8 w-8 text-[#141414] mb-2" />
                            <p className="text-xs px-4 font-mono leading-normal">
                              Cero contradicciones detectadas. Los portales oficiales y la Gaceta Oficial están alineados.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {activeResult.validation.conflictingStatements.map((log, idx) => (
                              <div key={idx} className="bg-[#E4E3E0]/20 border border-[#141414] p-3 text-xs leading-relaxed text-[#141414] font-sans">
                                {log}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Citations Tab */}
                {activeTab === "citations" && (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between border-b border-[#141414]/15 pb-2">
                      <div>
                        <h4 className="text-sm font-black text-[#141414] uppercase tracking-wider">FUENTES Y CITACIONES VERIFICADAS</h4>
                        <p className="text-[10px] text-slate-500 font-mono">Trazabilidad completa con las URLs oficiales consultadas por los agentes.</p>
                      </div>
                      <span className="text-xs font-black text-white bg-[#141414] px-2.5 py-1">
                        {activeResult.response.citations.length} FUENTES
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {activeResult.response.citations.map((cite, idx) => (
                        <div
                          key={idx}
                          className="bg-white border-2 border-[#141414] p-4.5 shadow-[4px_4px_0px_0px_#141414] rounded-none flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <span className="bg-[#141414] text-white text-[9px] px-2 py-0.5 font-mono font-black uppercase">
                                {cite.institution || "Portal DR"}
                              </span>
                              {cite.date && (
                                <span className="text-[9px] text-[#141414]/60 font-mono font-bold">{cite.date}</span>
                              )}
                            </div>
                            <h5 className="text-xs font-extrabold text-[#141414] leading-snug font-display mb-2 uppercase">
                              {cite.title}
                            </h5>
                            <p className="text-[10px] text-slate-700 leading-relaxed mb-4 font-serif italic">
                              "{cite.snippet || "Material de archivo oficial validado por la inteligencia del estado dominicano."}"
                            </p>
                          </div>

                          <div className="pt-2.5 border-t border-[#141414]/15 flex items-center justify-between font-mono">
                            <span className="text-[9px] text-slate-500 truncate max-w-[150px]">
                              {new URL(cite.url).hostname}
                            </span>
                            <a
                              href={cite.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] font-black text-[#E94E31] hover:text-black flex items-center gap-0.5 uppercase"
                            >
                              IR AL PORTAL ↗
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>

            </div>

            {/* Context-grounded Chat — interrogate the AUDIT EVIDENCE PACKET */}
            <div className="mt-6 bg-white border-2 border-[#141414] shadow-[8px_8px_0px_0px_#141414] rounded-none overflow-hidden flex flex-col">
              <div className="bg-[#141414] text-white p-4 border-b-2 border-[#141414] flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-[#E94E31]" />
                <span className="text-[10px] font-mono font-black tracking-widest text-[#E94E31] uppercase">CHAT SOBRE EL PAQUETE DE EVIDENCIA</span>
                <span className="text-[9px] font-mono text-slate-400 ml-auto">Responde usando solo los resultados recuperados</span>
              </div>

              <div className="p-4 max-h-[420px] overflow-y-auto space-y-3 bg-[#E4E3E0]/30">
                {chatMessages.length === 0 && (
                  <p className="text-[11px] text-[#141414]/60 font-mono italic text-center py-6">
                    Haga una pregunta sobre esta evidencia (ej. "¿Qué comisiones ven este proyecto?" o "Resume las leyes citadas").
                  </p>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] px-3.5 py-2.5 text-[12px] leading-relaxed border-2 ${
                        m.role === "user"
                          ? "bg-[#141414] text-white border-[#141414] rounded-none"
                          : "bg-white text-[#141414] border-[#141414] rounded-none shadow-[2px_2px_0px_0px_#E94E31]"
                      }`}
                    >
                      <p className="font-sans whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border-2 border-[#141414] px-3.5 py-2.5 rounded-none shadow-[2px_2px_0px_0px_#E94E31]">
                      <div className="h-3.5 w-3.5 border-2 border-[#141414] border-t-[#E94E31] rounded-full animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t-2 border-[#141414] p-3 flex items-center gap-2 bg-white">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                  placeholder="Pregunte sobre esta evidencia…"
                  disabled={chatLoading || !activeResult}
                  className="flex-1 text-xs px-3 py-2.5 bg-[#E4E3E0]/20 border-2 border-[#141414] focus:outline-none focus:ring-0 font-sans"
                />
                <button
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatInput.trim() || !activeResult}
                  className="px-4 py-2.5 bg-[#E94E31] text-white hover:bg-[#141414] font-black uppercase text-[10px] tracking-wider border-2 border-[#141414] shadow-[2px_2px_0px_0px_#141414] transition-all disabled:opacity-40"
                >
                  ENVIAR
                </button>
              </div>
            </div>

            {chatMessages.length > 0 && (
              <button
                onClick={() => setChatMessages([])}
                className="mt-2 text-center w-full text-[10px] text-[#E94E31] hover:text-[#141414] font-black uppercase tracking-wider"
              >
                [ Limpiar conversación ]
              </button>
            )}
            </>
          ) : (
            !isSearching && !apiError && (
              <div className="bg-white border-2 border-[#141414] shadow-[6px_6px_0px_0px_#141414] p-10 text-center rounded-none">
                <div className="h-16 w-16 bg-[#141414] text-[#E4E3E0] flex items-center justify-center mx-auto mb-4 border-2 border-[#141414] shadow-[3px_3px_0px_0px_#E94E31]">
                  <BookOpen className="h-7 w-7 text-[#E94E31]" />
                </div>
                <h3 className="text-lg font-black text-[#141414] font-display uppercase tracking-tight mb-2">CONSOLA EN ESPERA</h3>
                <p className="text-xs text-[#141414]/80 max-w-md mx-auto leading-relaxed">
                  Ingrese una pregunta arriba para activar el bucle de búsqueda multi-agente en vivo. Las respuestas serán sintetizadas directamente desde leyes y portales oficiales dominicanos de forma transparente.
                </p>
              </div>
            )
          )}

        </section>

      </main>

      {/* Footer Branding */}
      <footer className="bg-[#E4E3E0] border-t-2 border-[#141414] py-8 px-6 text-center text-xs text-[#141414] mt-12 font-mono">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="font-bold">© {new Date().getFullYear()} INTEL.DOM.GOB RAG · Government Intelligence Platform RD. LOCAL STATELESS COMPLIANCE.</p>
          <div className="flex items-center gap-2">
            <p className="text-[10px] bg-[#141414] text-white px-2 py-1 uppercase tracking-widest font-black">
              {model ? `${model} // search grounding` : "SELECT MODEL // search grounding"}
            </p>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-1 border-2 border-[#141414] bg-white hover:bg-[#E4E3E0] transition-colors"
              aria-label="Abrir configuración"
            >
              <SettingsIcon className="h-5 w-5 text-[#141414]" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
