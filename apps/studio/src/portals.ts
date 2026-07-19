export interface PortalSection {
  category: "news" | "legislative_action" | "laws" | "decrees" | "resolutions" | "transparency" | "agendas" | "acts" | "data" | "other";
  label: string;
  // The most important entry pages to search for this section.
  seeds: string[];
  // If true, seeds are JSON API endpoints (the crawler fetches JSON, not HTML).
  isApi?: boolean;
  // For API sections: keyword to probe (the live query keyword replaces this at runtime).
  apiKeyword?: string;
}

export interface DRPortal {
  name: string;
  url: string;
  type: string;
  refId: string;
  // Categorized, curated entry points (the most important pages to search).
  sections: PortalSection[];
}

// Research is split by category. For each department we select the highest-value
// pages per category rather than blindly crawling the whole site.
export const DR_PORTALS: DRPortal[] = [
  {
    name: "Cámara de Diputados",
    url: "https://www.camaradediputados.gob.do",
    type: "Legislative",
    refId: "CD-DOM-LE",
    sections: [
      {
        category: "legislative_action",
        label: "Iniciativas Legislativas",
        seeds: ["https://www.diputadosrd.gob.do/sil/iniciativa"]
      },
      {
        category: "legislative_action",
        label: "Sesiones del Pleno",
        seeds: ["https://camaradediputados.gob.do/sesiones-del-pleno/"]
      },
      {
        category: "legislative_action",
        label: "Debates de Sesiones",
        seeds: ["https://camaradediputados.gob.do/debates-de-sesiones/"]
      },
      {
        category: "legislative_action",
        label: "Vistas Públicas",
        seeds: ["https://camaradediputados.gob.do/vistas-publicas/"]
      },
      {
        category: "agendas",
        label: "Órdenes del Día (Pleno)",
        seeds: ["https://camaradediputados.gob.do/ordenes-del-dia-del-pleno/", "https://camaradediputados.gob.do/orden-del-dia-conocida-por-el-pleno/"]
      },
      {
        category: "agendas",
        label: "Agenda de Comisiones",
        seeds: ["https://camaradediputados.gob.do/agenda-comisiones/"]
      },
      {
        category: "acts",
        label: "Actas",
        seeds: ["https://camaradediputados.gob.do/actas/"]
      },
      {
        category: "acts",
        label: "Asistencia",
        seeds: ["https://camaradediputados.gob.do/asistencia/"]
      },
      {
        category: "acts",
        label: "Asistencia de Comisiones",
        seeds: ["https://camaradediputados.gob.do/asistencia-comisiones/"]
      },
      {
        category: "news",
        label: "Noticias",
        seeds: ["https://camaradediputados.gob.do/noticias/"]
      },
      {
        category: "transparency",
        label: "Transparencia",
        seeds: ["https://camaradediputados.gob.do/transparencia/"]
      }
    ]
  },
  {
    name: "Senado de la República",
    url: "https://www.senadord.gob.do",
    type: "Legislative",
    refId: "SEN-DOM-LE",
    sections: [
      {
        category: "legislative_action",
        label: "Iniciativas Legislativas",
        seeds: ["https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/"]
      },
      {
        category: "legislative_action",
        label: "Iniciativas Aprobadas",
        seeds: ["https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-aprobadas/"]
      },
      {
        category: "legislative_action",
        label: "Proyectos Perimidos",
        seeds: ["https://www.senadord.gob.do/secretaria-general-legislativa/proyectos-perimidos/"]
      },
      {
        category: "agendas",
        label: "Orden del Día",
        seeds: ["https://www.senadord.gob.do/secretaria-general-legislativa/orden-del-dia/"]
      },
      {
        category: "agendas",
        label: "Orden del Día Pleno",
        seeds: ["https://www.senadord.gob.do/secretaria-general-legislativa/orden-del-dia-pleno/"]
      },
      {
        category: "acts",
        label: "Actas de Sesiones",
        seeds: ["https://www.senadord.gob.do/elaboracion-de-actas/actas-de-sesiones/"]
      },
      {
        category: "other",
        label: "Comisiones",
        seeds: ["https://www.senadord.gob.do/comisiones/lista-de-comisiones/", "https://www.senadord.gob.do/comisiones/agenda-semanal-de-comisiones/"]
      },
      {
        category: "news",
        label: "Noticias",
        seeds: ["https://www.senadord.gob.do/noticias/"]
      }
    ]
  },
  {
    name: "Diputados SIL (API)",
    url: "https://www.diputadosrd.gob.do",
    type: "Legislative",
    refId: "SIL-DOM-LE",
    sections: [
      {
        category: "laws",
        label: "Iniciativas / Leyes (API)",
        isApi: true,
        apiKeyword: "test",
        seeds: ["https://www.diputadosrd.gob.do/sil/api/iniciativa/getIniciativas?page=1&keyword=test&periodoId=0"]
      },
      {
        category: "legislative_action",
        label: "Comisiones (API)",
        isApi: true,
        apiKeyword: "test",
        seeds: ["https://www.diputadosrd.gob.do/sil/api/comision/comisiones?page=1&keyword=test&periodoId=0"]
      },
      {
        category: "agendas",
        label: "Sesiones (API)",
        isApi: true,
        apiKeyword: "test",
        seeds: ["https://www.diputadosrd.gob.do/sil/api/sesion/sesiones?page=1&keyword=test&periodoId=0"]
      },
      {
        category: "other",
        label: "Grupos Parlamentarios",
        seeds: ["https://www.diputadosrd.gob.do/sil/gruposparlamentarios"]
      },
      {
        category: "other",
        label: "Sesión (detalle)",
        seeds: ["https://www.diputadosrd.gob.do/sil/sesion"]
      }
    ]
  },
  {
    name: "Presidencia de la República",
    url: "https://www.presidencia.gob.do",
    type: "Executive",
    refId: "PRES-DOM-EX",
    sections: [
      {
        category: "news",
        label: "Noticias",
        seeds: ["https://www.presidencia.gob.do/noticias"]
      },
      {
        category: "decrees",
        label: "Decretos / Gaceta",
        seeds: ["https://www.presidencia.gob.do/gaceta-oficial"]
      },
      {
        category: "other",
        label: "Transparencia",
        seeds: ["https://www.presidencia.gob.do/transparencia"]
      }
    ]
  },
  {
    name: "Consultoría Jurídica",
    url: "https://www.consultoria.gov.do",
    type: "Executive",
    refId: "CJ-DOM-EX",
    sections: [
      {
        category: "news",
        label: "Noticias",
        seeds: ["https://www.consultoria.gov.do/News/NewsConsult"]
      },
      {
        category: "other",
        label: "Consulta Jurídica",
        seeds: ["https://www.consultoria.gov.do/consulta/"]
      }
    ]
  },
  {
    name: "Tribunal Constitucional",
    url: "https://www.tribunalconstitucional.gob.do",
    type: "Judicial",
    refId: "TC-DOM-JU",
    sections: [
      {
        category: "news",
        label: "Sala de Prensa",
        seeds: ["https://www.tribunalconstitucional.gob.do/sala-de-prensa/noticias/"]
      },
      {
        category: "laws",
        label: "Jurisprudencia / Decisiones",
        seeds: ["https://www.tribunalconstitucional.gob.do/jurisprudencia", "https://www.tribunalconstitucional.gob.do/decisiones"]
      },
      {
        category: "laws",
        label: "Sentencias (Búsqueda)",
        seeds: ["https://www.tribunalconstitucional.gob.do/consultas/secretar%C3%ADa/sentencias?searchString=<KEYTERM>&size=50&criteriay=all&filtery=all"]
      },
      {
        category: "other",
        label: "Const. e Instrumentos",
        seeds: ["https://www.tribunalconstitucional.gob.do/const"]
      }
    ]
  },
  {
    name: "Contrataciones Públicas (DGCP)",
    url: "https://www.dgcp.gob.do",
    type: "Transparency",
    refId: "DGCP-DOM-TR",
    sections: [
      {
        category: "laws",
        label: "Leyes",
        seeds: ["https://www.dgcp.gob.do/new_dgcp/documentos/ley/"]
      },
      {
        category: "decrees",
        label: "Leyes y Decretos",
        seeds: ["https://www.dgcp.gob.do/new_dgcp/documentos/politicas_normas_y_procedimientos/leyes_y_decretos/"]
      },
      {
        category: "resolutions",
        label: "Resoluciones de Políticas",
        seeds: ["https://www.dgcp.gob.do/new_dgcp/documentos/politicas_normas_y_procedimientos/resoluciones_de_politicas/"]
      },
      {
        category: "news",
        label: "Noticias",
        seeds: ["https://www.dgcp.gob.do/noticias/"]
      },
      {
        category: "transparency",
        label: "Publicaciones",
        seeds: ["https://www.dgcp.gob.do/publicacion/"]
      }
    ]
  },
  {
    name: "Datos Abiertos RD",
    url: "https://datos.gob.do",
    type: "Transparency",
    refId: "DAT-DOM-TR",
    sections: [
      {
        category: "data",
        label: "Catálogo de Datasets",
        seeds: ["https://datos.gob.do/dataset", "https://datos.gob.do/group"]
      }
    ]
  }
];

// Human-readable category labels (used in UI + prompts).
export const CATEGORY_LABELS: Record<string, string> = {
  news: "Noticias",
  legislative_action: "Acción Legislativa",
  laws: "Leyes",
  decrees: "Decretos",
  resolutions: "Resoluciones",
  transparency: "Transparencia",
  agendas: "Órdenes del Día",
  acts: "Actas",
  data: "Datos Abiertos",
  other: "Otros"
};
