// Fake demo patients. A real deployment would load these from the practice management system.
export const PATIENTS = [
  { id: 'P1001', name: 'Biscuit', species: 'Dog', breed: 'Labrador Retriever', sex: 'MN', age: '6 years', weight: '32 kg', owner: 'Jenny Walsh' },
  { id: 'P1002', name: 'Mochi', species: 'Cat', breed: 'Domestic Shorthair', sex: 'FS', age: '3 years', weight: '4.2 kg', owner: 'Tom Nguyen' },
  { id: 'P1003', name: 'Rocket', species: 'Dog', breed: 'Kelpie x', sex: 'M', age: '9 months', weight: '14 kg', owner: 'Priya Raman' },
  { id: 'P1004', name: 'Pepper', species: 'Dog', breed: 'Cavalier King Charles Spaniel', sex: 'FS', age: '11 years', weight: '9 kg', owner: 'Mark Ellis' },
  { id: 'P1005', name: 'Ziggy', species: 'Cat', breed: 'Ragdoll', sex: 'MN', age: '8 years', weight: '6 kg', owner: 'Sam Ortiz' },
];

// Sample dictations (fake) per template, with the patient they belong to.
export const SAMPLES = {
  consult_soap: { patient: 'P1001', text: "Um okay so Biscuit in today, Jenny says he's been scratching at his left ear since the weekend, getting worse. He ran out of his a pock well about ten days ago, normally on one and a half tabs once a day. Licking his feet a lot too. Eating and drinking fine. On exam temp 38.6, weight 33.4 kilos, heart rate 90, BCS 6 out of 9. Left ear canal red with brown discharge, pinna a bit ulcerated from scratching, eardrum visible. Right ear looks clear. Everything else normal. Did ear cytology on the left, plus plus cocci and plus plus plus malassezia. Cleaned the ear today and put neptra in the left ear. Restart apoquel one and a half tabs once daily. Talked about cytopoint as an option. Recheck in two weeks." },
  afast_tfast: { patient: 'P1003', text: "AFAST TFAST on Rocket, came in after being hit by a car about an hour ago. Scanned in right lateral. DH negative, SR small amount of fluid, I'd call it a half. CC negative. Didn't get a good hepato-renal view. TFAST, left chest tube site glide sign present, no pleural fluid. Right chest tube site same, glide present, no fluid. Pericardial sites, no pericardial effusion either side. Didn't do sub-xiphoid. Operator Dr Lee." },
  vaccination: { patient: 'P1002', text: "Mochi in for her F3 booster and health check. Tom says she's doing well, indoor cat, on Revolution monthly. Weight 4.3 kilos, temp 38.4. Teeth grade one tartar, mild. Heart and lungs normal, abdo palp normal. Gave F3 subcut, right hind. Discussed dental home care. Next vaccine due in twelve months." },
  recheck: { patient: 'P1004', text: "Pepper back for her two week recheck after the dental, had four extractions. Mark says she's eating well, back on normal food, no problems. Gums healing well, sites closed, no swelling. Finished the metacam. No further recheck needed, start brushing at home." },
  dental_ga: { patient: 'P1005', text: "Ziggy dental today. Premed methadone 0.3 milligrams per kilo IM and medetomidine. Induced with alfaxan to effect, maintained on iso. Grade three periodontal disease. Scale and polish, extracted 307 and 407, resorptive lesions. Recovery smooth, extubated, warm and comfortable. Sending home on onsior once daily for three days." },
  phone_call: { patient: 'P1002', text: "Phone call with Tom about Mochi. She vomited twice this morning, still eating a bit, bright. No diarrhoea. Advised to withhold food for a few hours then offer small bland meals, and to bring her in if vomiting continues past tonight or she goes off food." },
};
