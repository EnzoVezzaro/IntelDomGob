// Aggregator: registers every institution plugin in the registry. Adding a new
// institution is as simple as creating its folder + importing/registering it here.
// No other file in the app imports concrete institutions directly.

import { registerInstitution } from "./registry";
import { senateService } from "./senate";
import { chamberService } from "./chamber";
import { presidencyService } from "./presidency";
import { judiciaryService } from "./judiciary";
import { dgcpService } from "./dgcp";
import { datosService } from "./datos";
import { consultoriaService } from "./consultoria";
import { comprasService } from "./compras";

let registered = false;

/** Idempotently register all institution plugins. Safe to call multiple times. */
export function registerAllInstitutions(): void {
  if (registered) return;
  registerInstitution(senateService);
  registerInstitution(chamberService);
  registerInstitution(presidencyService);
  registerInstitution(judiciaryService);
  registerInstitution(dgcpService);
  registerInstitution(datosService);
  registerInstitution(consultoriaService);
  registerInstitution(comprasService);
  registered = true;
}

export * from "./registry";
export * from "./types";
export { senateApi, senateService } from "./senate";
export { chamberService } from "./chamber";
export { chamberApi, getComisiones, getComisionTipos, getComisionesByTipo, getIniciativaCount, getIniciativaGrupos, getIniciativaMaterias, getIniciativasFiltered, getGruposParlamentarios, getSesiones, getLegislador } from "./chamber";
export { searchExpedientes, searchSenadoConcepts } from "./senate/dspace";
export { presidencyService } from "./presidency";
export { judiciaryService } from "./judiciary";
export { dgcpService } from "./dgcp";
export { datosService } from "./datos";
export { consultoriaService } from "./consultoria";
export { comprasService } from "./compras";
