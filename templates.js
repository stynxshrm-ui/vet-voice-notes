// Note templates. The LLM only extracts into the JSON shape below; public/render.js turns it into text
// and does any arithmetic (e.g. the AFAST score), so numbers are never "made up" by the model.
// Wording is our own; output style follows the usual vet History / Exam / Assessment / Plan layout.

const FLAG_TYPES = 'dose_unit|missing_weight|controlled_drug|euthanasia_consent|species_mismatch|other';

const CONSULT_SCHEMA = `{
  "title": "Short title, max 8 words (e.g. 'L otitis externa - consult')",
  "history": "Presenting complaint and history as dictated, concise clinical shorthand, or null",
  "vitals": {"temp": "string or null", "weight": "string or null", "bcs": "string or null", "hr": "string or null", "rr": "string or null", "mm_crt": "string or null"},
  "exam": [{"system": "e.g. Demeanour, EENT, Oral/Dental, CVS, Resp, Abdo, UG, MSK, Integ, Neuro, PLNs, Rectal", "finding": "as dictated"}],
  "assessment": ["problem / diagnosis / differential, as stated"],
  "plan": {
    "diagnostics": ["tests done or planned, with results if dictated"],
    "treatment": ["procedures or treatment given in clinic"],
    "medications": [{"drug": "string", "dose": "string or null", "route": "string or null", "frequency": "string or null", "duration": "string or null"}],
    "advice": ["advice or discussion with the client"],
    "recheck": "string or null"
  },
  "items_to_bill": ["billable items mentioned: consult, vaccines, procedures, tests, dispensed drugs, quotes given"],
  "flags": [{"type": "${FLAG_TYPES}", "note": "string"}],
  "unclear": ["string"]
}`;

const AFAST_SITE = '"0" | "1/2" | "1" | null';
const TFAST_SITE = '{"pleural_fluid": "absent|present|text or null", "pericardial_fluid": "absent|present|text or null", "pneumothorax": "absent|present|text or null", "b_lines": "WNL|increased|text or null"}';

const AFAST_SCHEMA = `{
  "title": "Short title, e.g. 'AFAST/TFAST - HBC trauma'",
  "operator": "string or null",
  "positioning": "string or null",
  "afast": {"DH": ${AFAST_SITE}, "SR": ${AFAST_SITE}, "CC": ${AFAST_SITE}, "HR": ${AFAST_SITE}},
  "afast_notes": "other abdominal findings as dictated, or null",
  "tfast": {"cts_left": ${TFAST_SITE}, "cts_right": ${TFAST_SITE}, "pcs_left": ${TFAST_SITE}, "pcs_right": ${TFAST_SITE}, "subxiphoid": ${TFAST_SITE}},
  "tfast_notes": "other thoracic findings as dictated, or null",
  "vet_interpretation": "interpretation ONLY if the vet stated one, else null",
  "flags": [{"type": "${FLAG_TYPES}", "note": "string"}],
  "unclear": ["string"]
}`;

export const TEMPLATES = [
  { id: 'consult_soap', name: 'Consult (SOAP)', category: 'Consults', schema: CONSULT_SCHEMA,
    instructions: 'A standard consultation. History = why the patient presented and relevant background (diet, meds, preventatives). Only include exam systems that were mentioned.' },
  { id: 'recheck', name: 'Recheck', category: 'Consults', schema: CONSULT_SCHEMA,
    instructions: 'A recheck / revisit. History = what is being rechecked and progress since last visit as reported by the owner. Keep it short. Put "no further recheck required" into plan.recheck if said.' },
  { id: 'vaccination', name: 'Vaccination / health check', category: 'Consults', schema: CONSULT_SCHEMA,
    instructions: 'Vaccination or annual health check. Record each vaccine given (name, route) in plan.treatment and in items_to_bill. Record parasite prevention status in history if mentioned.' },
  { id: 'dental_ga', name: 'Dental / GA procedure', category: 'Procedures', schema: CONSULT_SCHEMA,
    instructions: 'An anaesthetic or dental procedure. Put premed/induction/maintenance drugs in plan.medications, procedures performed (scale and polish, extractions with tooth numbers) in plan.treatment, dental grade and charting findings in exam under "Oral/Dental", recovery notes in assessment.' },
  { id: 'phone_call', name: 'Phone call', category: 'Comms', schema: CONSULT_SCHEMA,
    instructions: 'A phone call with the client; there is no physical exam, so leave vitals null and exam empty. History = what the client reported. Advice = what the vet told them.' },
  { id: 'afast_tfast', name: 'AFAST / TFAST ultrasound', category: 'Procedures', schema: AFAST_SCHEMA,
    instructions: `A point-of-care AFAST and/or TFAST scan.
AFAST views: DH (diaphragmatico-hepatic), SR (spleno-renal), CC (cysto-colic), HR (hepato-renal). Score each "0" (negative), "1/2" (soft positive / small amount), "1" (positive). If a view was not mentioned, use null. "Negative" or "no fluid" means "0". Do NOT add up the score - the app computes it.
TFAST views: chest tube site (CTS) left and right, pericardial site (PCS) left and right, sub-xiphoid. For each finding use what was said; a view that was not mentioned stays all null. "Glide sign present" means pneumothorax absent. Never assume a view is normal because it was not mentioned.` },
];

export const SUMMARY_TEMPLATE = { id: 'client_summary', name: 'Client summary' };

export const findTemplate = id => TEMPLATES.find(t => t.id === id);
export const publicTemplates = () => TEMPLATES.map(({ id, name, category }) => ({ id, name, category }));
